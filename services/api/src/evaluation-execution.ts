import { randomUUID } from 'node:crypto';
import type { SqliteRuntimeStore } from '../../../packages/persistence/src/sqlite-runtime.ts';
import { SoloEvaluationRunner, type SoloCampaignRecord } from '../../../packages/evaluation/src/solo-runner.ts';
import type { WalletTransactionResult } from './managed-identity.ts';

export type EvaluationFeeRecord = {
  schema: 'arena-evaluation-fee-v2'; campaignId: string; owner: string; amountUsdc: string;
  escrowAddress: string; approvalIdempotencyKey: string; depositIdempotencyKey: string; settlementIdempotencyKey: string;
  state: 'PENDING' | 'HELD' | 'RELEASED' | 'REFUNDED' | 'PAYMENT_FAILED' | 'SETTLEMENT_FAILED';
  approval?: WalletTransactionResult; deposit?: WalletTransactionResult; settlement?: WalletTransactionResult; error?: string;
};

export interface EvaluationFeePort {
  holdEvaluationFee(input: { userId: string; escrowAddress: string; campaignId: string; amountUsdc: string; approvalIdempotencyKey: string; depositIdempotencyKey: string }): Promise<{ approval: WalletTransactionResult; deposit: WalletTransactionResult }>;
}

export interface EvaluationSettlementPort {
  release(campaignId: string, idempotencyKey?: string): Promise<WalletTransactionResult>;
  refund(campaignId: string, idempotencyKey?: string): Promise<WalletTransactionResult>;
}

export class EvaluationExecutionService {
  private readonly runtime: SqliteRuntimeStore;
  private readonly fees: EvaluationFeePort;
  private readonly settlement: EvaluationSettlementPort;
  private readonly runner: SoloEvaluationRunner;
  private readonly escrowAddress: string;
  private readonly feeUsdc: string;
  private readonly settlementOperations = new Map<string, { target: 'RELEASED' | 'REFUNDED'; operation: Promise<void> }>();
  readonly model: string;

  constructor(options: { runtime: SqliteRuntimeStore; fees: EvaluationFeePort; settlement: EvaluationSettlementPort; runner: SoloEvaluationRunner; operatorAddress: string; escrowAddress: string; feeUsdc: string; model?: string }) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(options.operatorAddress)) throw new TypeError('evaluation operator address is invalid');
    if (!/^0x[0-9a-fA-F]{40}$/.test(options.escrowAddress)) throw new TypeError('evaluation escrow address is invalid');
    if (!/^\d+(?:\.\d{1,6})?$/.test(options.feeUsdc) || Number(options.feeUsdc) <= 0) throw new TypeError('evaluation fee is invalid');
    if (!options.model?.trim()) throw new TypeError('evaluation model is required');
    this.runtime = options.runtime; this.fees = options.fees; this.settlement = options.settlement; this.runner = options.runner;
    this.escrowAddress = options.escrowAddress.toLowerCase(); this.feeUsdc = options.feeUsdc; this.model = options.model.trim();
  }

  async start(userId: string, owner: string, campaignId: string): Promise<SoloCampaignRecord> {
    const campaign = this.requireOwned(owner, campaignId);
    let fee = this.getFee(campaignId);
    if (fee && (fee.owner !== owner || fee.amountUsdc !== this.feeUsdc || fee.escrowAddress !== this.escrowAddress)) throw new Error('evaluation fee binding conflict');
    if (!fee) {
      fee = { schema: 'arena-evaluation-fee-v2', campaignId, owner, amountUsdc: this.feeUsdc, escrowAddress: this.escrowAddress, approvalIdempotencyKey: randomUUID(), depositIdempotencyKey: randomUUID(), settlementIdempotencyKey: randomUUID(), state: 'PENDING' };
      this.runtime.putIfAbsent('evaluation-fees-v2', campaignId, fee);
      fee = this.getFee(campaignId)!;
    }
    if (fee.state === 'PAYMENT_FAILED') {
      fee = { ...fee, state: 'PENDING', error: undefined };
      this.runtime.put('evaluation-fees-v2', campaignId, fee);
    }
    if (fee.state === 'PENDING') {
      try {
        const held = await this.fees.holdEvaluationFee({ userId, escrowAddress: fee.escrowAddress, campaignId, amountUsdc: fee.amountUsdc, approvalIdempotencyKey: fee.approvalIdempotencyKey, depositIdempotencyKey: fee.depositIdempotencyKey });
        fee = { ...fee, state: 'HELD', ...held, error: undefined };
        this.runtime.put('evaluation-fees-v2', campaignId, fee);
      } catch (error) {
        fee = { ...fee, state: 'PAYMENT_FAILED', error: error instanceof Error ? error.message : 'evaluation fee failed' };
        this.runtime.put('evaluation-fees-v2', campaignId, fee);
        throw error;
      }
    }
    if (!['HELD', 'RELEASED', 'REFUNDED'].includes(fee.state)) throw new Error('evaluation fee is unavailable');
    return this.advanceSafely(campaign, fee);
  }

  async advance(owner: string, campaignId: string): Promise<SoloCampaignRecord> {
    const campaign = this.requireOwned(owner, campaignId);
    const fee = this.getFee(campaignId);
    if (!fee || !['HELD', 'RELEASED', 'REFUNDED', 'SETTLEMENT_FAILED'].includes(fee.state)) throw new Error('evaluation fee not held');
    return this.advanceSafely(campaign, fee);
  }

  getFee(campaignId: string): EvaluationFeeRecord | undefined { return this.runtime.get<EvaluationFeeRecord>('evaluation-fees-v2', campaignId); }
  config(): { enabled: true; feeUsdc: string; feeAsset: 'USDC'; feeCustody: 'ESCROW'; escrowAddress: string; genLayerGasPayer: 'OWNER' } { return { enabled: true, feeUsdc: this.feeUsdc, feeAsset: 'USDC', feeCustody: 'ESCROW', escrowAddress: this.escrowAddress, genLayerGasPayer: 'OWNER' }; }

  private async advanceSafely(campaign: SoloCampaignRecord, fee: EvaluationFeeRecord): Promise<SoloCampaignRecord> {
    let next = campaign;
    if (!['FINALIZED', 'FAILED'].includes(next.state)) {
      try { next = await this.runner.advance(next.campaignId); }
      catch { next = this.runner.failInfrastructure(next.campaignId); }
    }
    return this.settle(next, fee);
  }

  private async settle(campaign: SoloCampaignRecord, fee: EvaluationFeeRecord): Promise<SoloCampaignRecord> {
    const current = this.getFee(fee.campaignId) ?? fee;
    if (campaign.state === 'FINALIZED') {
      if (current.state === 'REFUNDED') throw new Error('evaluation fee was already refunded');
      if (current.state !== 'RELEASED') await this.settleOnce(current, 'RELEASED');
    }
    if (campaign.state === 'FAILED') {
      if (current.state === 'RELEASED') throw new Error('evaluation fee was already released');
      if (current.state !== 'REFUNDED') await this.settleOnce(current, 'REFUNDED');
    }
    return campaign;
  }

  private settleOnce(fee: EvaluationFeeRecord, target: 'RELEASED' | 'REFUNDED'): Promise<void> {
    const active = this.settlementOperations.get(fee.campaignId);
    if (active) {
      if (active.target !== target) return Promise.reject(new Error('evaluation settlement target conflict'));
      return active.operation;
    }
    const operation = this.runSettlement(fee, target).finally(() => {
      if (this.settlementOperations.get(fee.campaignId)?.operation === operation) this.settlementOperations.delete(fee.campaignId);
    });
    this.settlementOperations.set(fee.campaignId, { target, operation });
    return operation;
  }

  private async runSettlement(fee: EvaluationFeeRecord, target: 'RELEASED' | 'REFUNDED'): Promise<void> {
    try {
      const settlement = target === 'RELEASED'
        ? await this.settlement.release(fee.campaignId, fee.settlementIdempotencyKey)
        : await this.settlement.refund(fee.campaignId, fee.settlementIdempotencyKey);
      this.runtime.put('evaluation-fees-v2', fee.campaignId, { ...fee, state: target, settlement, error: undefined });
    } catch (error) {
      this.runtime.put('evaluation-fees-v2', fee.campaignId, { ...fee, state: 'SETTLEMENT_FAILED', error: error instanceof Error ? error.message : 'evaluation settlement failed' });
      throw error;
    }
  }

  private requireOwned(owner: string, campaignId: string): SoloCampaignRecord {
    const campaign = this.runner.get(campaignId);
    if (!campaign || campaign.owner.toLowerCase() !== owner.toLowerCase()) throw new Error('evaluation campaign not found');
    return campaign;
  }
}
