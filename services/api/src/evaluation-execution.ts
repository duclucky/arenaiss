import type { SqliteRuntimeStore } from '../../../packages/persistence/src/sqlite-runtime.ts';
import { SoloEvaluationRunner, type SoloCampaignRecord } from '../../../packages/evaluation/src/solo-runner.ts';
import type { WalletTransactionResult } from './managed-identity.ts';

export type EvaluationFeeRecord = {
  schema: 'arena-evaluation-fee-v1'; campaignId: string; owner: string; amountUsdc: string;
  destination: string; idempotencyKey: string; state: 'PENDING' | 'SUBMITTED' | 'FAILED';
  transaction?: WalletTransactionResult; error?: string;
};

export interface EvaluationFeePort {
  transferUsdcWithIdempotency(userId: string, destinationAddress: string, amount: string, idempotencyKey: string): Promise<WalletTransactionResult>;
}

/** Charges the user-facing Evo fee once, then advances the already-persisted campaign.
 * GenLayer submission is deliberately delegated to the runner's owner-key judge port;
 * its gas is not included in this USDC fee. */
export class EvaluationExecutionService {
  private readonly runtime: SqliteRuntimeStore;
  private readonly fees: EvaluationFeePort;
  private readonly runner: SoloEvaluationRunner;
  private readonly operatorAddress: string;
  private readonly feeUsdc: string;
  readonly model: string;

  constructor(options: { runtime: SqliteRuntimeStore; fees: EvaluationFeePort; runner: SoloEvaluationRunner; operatorAddress: string; feeUsdc: string; model?: string }) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(options.operatorAddress)) throw new TypeError('evaluation operator address is invalid');
    if (!/^\d+(?:\.\d{1,6})?$/.test(options.feeUsdc) || Number(options.feeUsdc) <= 0) throw new TypeError('evaluation fee is invalid');
    if (!options.model?.trim()) throw new TypeError('evaluation model is required');
    this.runtime = options.runtime; this.fees = options.fees; this.runner = options.runner;
    this.operatorAddress = options.operatorAddress.toLowerCase(); this.feeUsdc = options.feeUsdc;
    this.model = options.model.trim();
  }

  async start(userId: string, owner: string, campaignId: string): Promise<SoloCampaignRecord> {
    const campaign = this.runner.get(campaignId);
    if (!campaign || campaign.owner.toLowerCase() !== owner.toLowerCase()) throw new Error('evaluation campaign not found');
    let fee = this.runtime.get<EvaluationFeeRecord>('evaluation-fees', campaignId);
    if (fee && (fee.owner !== owner || fee.amountUsdc !== this.feeUsdc || fee.destination !== this.operatorAddress)) throw new Error('evaluation fee binding conflict');
    if (!fee) {
      fee = { schema: 'arena-evaluation-fee-v1', campaignId, owner, amountUsdc: this.feeUsdc, destination: this.operatorAddress, idempotencyKey: `evo-fee:${campaignId}`, state: 'PENDING' };
      this.runtime.putIfAbsent('evaluation-fees', campaignId, fee);
      fee = this.runtime.get<EvaluationFeeRecord>('evaluation-fees', campaignId)!;
    }
    if (fee.state === 'FAILED') throw new Error(fee.error || 'evaluation fee failed');
    if (fee.state === 'PENDING') {
      try {
        const transaction = await this.fees.transferUsdcWithIdempotency(userId, fee.destination, fee.amountUsdc, fee.idempotencyKey);
        fee = { ...fee, state: 'SUBMITTED', transaction, error: undefined };
        this.runtime.put('evaluation-fees', campaignId, fee);
      } catch (error) {
        fee = { ...fee, state: 'FAILED', error: error instanceof Error ? error.message : 'evaluation fee failed' };
        this.runtime.put('evaluation-fees', campaignId, fee);
        throw error;
      }
    }
    return this.runner.advance(campaignId);
  }

  advance(owner: string, campaignId: string): Promise<SoloCampaignRecord> {
    const campaign = this.runner.get(campaignId);
    if (!campaign || campaign.owner.toLowerCase() !== owner.toLowerCase()) return Promise.reject(new Error('evaluation campaign not found'));
    if (this.getFee(campaignId)?.state !== 'SUBMITTED') return Promise.reject(new Error('evaluation fee not submitted'));
    return this.runner.advance(campaignId);
  }
  getFee(campaignId: string): EvaluationFeeRecord | undefined { return this.runtime.get<EvaluationFeeRecord>('evaluation-fees', campaignId); }
  config(): { enabled: true; feeUsdc: string; feeAsset: 'USDC'; genLayerGasPayer: 'OWNER' } { return { enabled: true, feeUsdc: this.feeUsdc, feeAsset: 'USDC', genLayerGasPayer: 'OWNER' }; }
}
