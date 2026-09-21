import { createHash, randomUUID } from 'node:crypto';
import type { SqliteRuntimeStore } from '../../../packages/persistence/src/sqlite-runtime.ts';
import type { ChainRoom, PairEvaluationFailureCode, PairRoom } from './pair-rooms.ts';

export type PairOutcome = { state: 'WAITING'; failureCode: 'VERDICT_PENDING'; transactionHash?: string }
  | { state: 'RETRY_LATER'; failureCode: 'PROVIDER_ERROR' | 'GENLAYER_BUSY' | 'GENLAYER_ERROR' | 'GENLAYER_NO_CONSENSUS'; transactionHash?: string }
  | { state: 'FINAL'; result: 'A_WIN' | 'B_WIN' | 'TIE'; transactionHash: string };
export interface PairOutcomePort { resolve(room: PairRoom): Promise<PairOutcome>; }
export interface PairSettlementArcPort {
  getRoom(roomId: string): Promise<ChainRoom>;
  settle(roomId: string, winner: string, verdictDigest: string): Promise<string>;
  expire(roomId: string): Promise<string>;
  refund(room: PairRoom, failureCode?: PairEvaluationFailureCode): Promise<string>;
}

export type PairEvaluationPhase = 'PROVIDER' | 'GENLAYER_SUBMISSION' | 'GENLAYER_FINALITY' | 'ARC_SETTLEMENT' | 'COMPLETE' | 'RECOVERY_REQUIRED';
export type PairEvaluationProgress = {
  schema: 'pair-room-evaluation-progress-v2';
  phase: PairEvaluationPhase;
  providerFailures: number;
  submissionFailures: number;
  finalityPollFailures: number;
  arcFailures: number;
  nextAt: number;
  verdictTx?: string;
  lastFailureCode?: PairEvaluationFailureCode;
  updatedAt: number;
};

const PROGRESS_NAMESPACE = 'pair-room-evaluation-progress-v2';
const RETRY_BUDGET = 3;

export class PairSettlementWorker {
  private readonly runtime: SqliteRuntimeStore;
  private readonly arc: PairSettlementArcPort;
  private readonly outcome: PairOutcomePort;
  private readonly now: () => number;
  constructor(runtime: SqliteRuntimeStore, arc: PairSettlementArcPort,
    outcome: PairOutcomePort, now: () => number = () => Math.floor(Date.now() / 1000)) {
    this.runtime = runtime; this.arc = arc; this.outcome = outcome; this.now = now;
  }
  async tick(): Promise<void> {
    const rows = this.runtime.list<PairRoom>('pair-rooms-v1');
    await Promise.all(rows.filter((item) => item.state === 'OPEN' || item.state === 'JOINING' || item.state === 'JOINED').map(async (room) => {
      const owner = randomUUID();
      if (this.runtime.claimLease('pair-room-worker-leases-v2', room.roomId, room.roomId, owner, Date.now(), 6 * 60_000) === 'BUSY') return;
      try { await this.progress(room); }
      catch (error) {
        const message = error instanceof Error ? error.message : 'unknown error';
        this.deferPhase(room.roomId, 'ARC_SETTLEMENT', classifyLegacyFailure(message), message);
      } finally { this.runtime.releaseLease('pair-room-worker-leases-v2', room.roomId, owner); }
    }));
  }

  private async progress(room: PairRoom): Promise<void> {
    const chain = await this.arc.getRoom(room.roomId);
    this.requireBinding(room, chain);
    if (chain.state === 3) {
      const intent = this.runtime.get<SettlementIntent>('pair-room-settlement-intents', room.roomId);
      if (intent && (!same(chain.winner, intent.winner) || chain.verdictDigest?.toLowerCase() !== `0x${intent.digest.slice(7)}`)) throw new Error('Arc settlement differs from persisted verdict');
      if (!same(chain.winner, room.creatorWallet) && !same(chain.winner, room.challengerWallet!)) throw new Error('Arc settled to an unknown wallet');
      this.runtime.put('pair-rooms-v1', room.roomId, { ...room, state: 'SETTLED', evaluationStage: 'COMPLETE', evaluationFailureCode: undefined, evaluationAttempts: undefined, retryAt: undefined, ...(intent ? { verdictTx: intent.verdictTx } : {}) });
      this.completeProgress(room.roomId, intent?.verdictTx);
      return;
    }
    if (chain.state === 4) {
      const refund = this.runtime.get<PairRefundIntent>('pair-room-refund-intents', room.roomId);
      this.runtime.put('pair-rooms-v1', room.roomId, { ...room, state: 'REFUNDABLE', evaluationStage: 'COMPLETE', evaluationFailureCode: refund?.failureCode, evaluationAttempts: undefined, retryAt: undefined, ...(refund?.refundTx ? { refundTx: refund.refundTx } : {}) });
      this.completeProgress(room.roomId);
      return;
    }
    if (room.state === 'JOINING') {
      if (chain.state === 2 && room.joinTx) {
        this.runtime.put('pair-rooms-v1', room.roomId, { ...room, state: 'JOINED', evaluationStage: 'QUEUED', evaluationFailureCode: undefined, evaluationAttempts: undefined, retryAt: undefined });
        return;
      }
      if (chain.state !== 1) throw new Error('pending Arc join requires reconciliation');
      if (this.now() >= room.joinDeadline) {
        await this.arc.expire(room.roomId);
        if ((await this.arc.getRoom(room.roomId)).state !== 4) throw new Error('Arc refund readback is not final');
        this.runtime.put('pair-rooms-v1', room.roomId, { ...room, state: 'REFUNDABLE', evaluationStage: 'COMPLETE', evaluationFailureCode: undefined, evaluationAttempts: undefined, retryAt: undefined });
        this.completeProgress(room.roomId);
      }
      return;
    }
    if (chain.state !== (room.state === 'OPEN' ? 1 : 2)) throw new Error('Arc room state differs from backend');
    if (this.now() >= (room.state === 'OPEN' ? room.joinDeadline : room.resolutionDeadline)) {
      await this.arc.expire(room.roomId);
      if ((await this.arc.getRoom(room.roomId)).state !== 4) throw new Error('Arc refund readback is not final');
      this.runtime.put('pair-rooms-v1', room.roomId, { ...room, state: 'REFUNDABLE', evaluationStage: 'COMPLETE', evaluationFailureCode: undefined, evaluationAttempts: undefined, retryAt: undefined });
      this.completeProgress(room.roomId);
      return;
    }
    if (room.state === 'OPEN') return;
    const queuedRefund = this.runtime.get<PairRefundIntent>('pair-room-refund-intents', room.roomId);
    if (queuedRefund) {
      if (this.now() >= this.progressFor(room.roomId).nextAt) await this.attemptRefund(room, queuedRefund);
      return;
    }
    if (room.evaluationFailureCode && immediateRefundFailure(room.evaluationFailureCode)) {
      await this.queueRefund(room, room.evaluationFailureCode, room.verdictTx);
      return;
    }
    let intent = this.runtime.get<SettlementIntent>('pair-room-settlement-intents', room.roomId);
    if (!intent) {
      const progress = this.progressFor(room.roomId);
      if (progress.phase === 'RECOVERY_REQUIRED') {
        if (!room.evaluationFailureCode) {
          const prior = this.runtime.get<{ message?: string }>('pair-room-worker-errors', room.roomId);
          this.runtime.put('pair-rooms-v1', room.roomId, { ...room, evaluationFailureCode: classifyLegacyFailure(prior?.message) });
        }
        return;
      }
      if (this.now() < progress.nextAt) return;
      this.runtime.put('pair-rooms-v1', room.roomId, { ...room, evaluationStage: 'RUNNING_AGENTS', evaluationFailureCode: undefined });
      let outcome: PairOutcome;
      try { outcome = await this.outcome.resolve(room); }
      catch (error) {
        const message = error instanceof Error ? error.message : 'unknown evaluation error';
        await this.queueRefund(room, classifyEvaluationFailure(message), progress.verdictTx);
        return;
      }
      if (outcome.state === 'RETRY_LATER') {
        await this.queueRefund(room, outcome.failureCode, outcome.transactionHash ?? progress.verdictTx);
        return;
      }
      if (outcome.state !== 'FINAL') {
        this.putProgress(room.roomId, { ...progress, phase: 'GENLAYER_FINALITY', nextAt: 0, ...(outcome.transactionHash ? { verdictTx: outcome.transactionHash } : {}), lastFailureCode: outcome.failureCode, updatedAt: this.now() });
        this.runtime.put('pair-rooms-v1', room.roomId, { ...room, evaluationStage: 'WAITING_VERDICT', evaluationFailureCode: outcome.failureCode, retryAt: undefined }); return;
      }
      if (outcome.result === 'TIE') { await this.queueRefund(room, undefined, outcome.transactionHash); return; }
      if (!/^0x[0-9a-fA-F]{64}$/.test(outcome.transactionHash)) throw new Error('comparison transaction is invalid');
      const winner = outcome.result === 'A_WIN' ? room.creatorWallet : room.challengerWallet!;
      intent = { winner, verdictTx: outcome.transactionHash, digest: sha(`arena-pair-verdict-v1|${room.roomId}|${outcome.result}|${outcome.transactionHash.toLowerCase()}`) };
      this.runtime.putIfAbsent('pair-room-settlement-intents', room.roomId, intent);
      intent = this.runtime.get<SettlementIntent>('pair-room-settlement-intents', room.roomId)!;
      this.putProgress(room.roomId, { ...progress, phase: 'ARC_SETTLEMENT', nextAt: 0, verdictTx: intent.verdictTx, lastFailureCode: undefined, updatedAt: this.now() });
    }
    const settlementProgress = this.progressFor(room.roomId);
    if (settlementProgress.phase === 'RECOVERY_REQUIRED' || this.now() < settlementProgress.nextAt) return;
    this.runtime.put('pair-rooms-v1', room.roomId, { ...room, evaluationStage: 'SETTLING', evaluationFailureCode: undefined, retryAt: undefined, verdictTx: intent.verdictTx });
    if (!same(intent.winner, room.creatorWallet) && !same(intent.winner, room.challengerWallet!)) throw new Error('settlement intent has an unknown winner');
    const settleTx = await this.arc.settle(room.roomId, intent.winner, intent.digest);
    const settled = await this.arc.getRoom(room.roomId);
    if (settled.state !== 3 || !same(settled.winner, intent.winner)
      || settled.verdictDigest?.toLowerCase() !== `0x${intent.digest.slice(7)}`) throw new Error('Arc settlement readback mismatch');
    this.runtime.put('pair-rooms-v1', room.roomId, { ...room, state: 'SETTLED', evaluationStage: 'COMPLETE', evaluationFailureCode: undefined, evaluationAttempts: undefined, retryAt: undefined, verdictTx: intent.verdictTx, settleTx });
    this.completeProgress(room.roomId, intent.verdictTx);
  }

  private requireBinding(room: PairRoom, chain: ChainRoom): void {
    if (!same(chain.creator, room.creatorWallet) || chain.stake !== BigInt(room.stake)
      || chain.creatorAgentVersion.toLowerCase() !== `0x${room.creatorVersion.slice(7)}`
      || chain.joinDeadline !== room.joinDeadline || chain.resolutionDeadline !== room.resolutionDeadline) throw new Error('Arc room creator binding mismatch');
    if ((room.state === 'JOINED' || (room.state === 'JOINING' && room.joinTx && chain.state === 2)) && (!room.challengerWallet || !room.challengerVersion || !room.joinTx
      || !same(chain.challenger, room.challengerWallet)
      || chain.challengerAgentVersion.toLowerCase() !== `0x${room.challengerVersion.slice(7)}`)) throw new Error('Arc room challenger binding mismatch');
  }

  private async queueRefund(room: PairRoom, failureCode?: PairEvaluationFailureCode, verdictTx?: string): Promise<void> {
    const candidate: PairRefundIntent = { ...(failureCode ? { failureCode } : {}), ...(verdictTx ? { verdictTx } : {}) };
    this.runtime.putIfAbsent('pair-room-refund-intents', room.roomId, candidate);
    const intent = this.runtime.get<PairRefundIntent>('pair-room-refund-intents', room.roomId)!;
    if (intent.failureCode !== candidate.failureCode || intent.verdictTx !== candidate.verdictTx) throw new Error('conflicting pair refund intent');
    const progress = this.progressFor(room.roomId);
    this.putProgress(room.roomId, { ...progress, phase: 'ARC_SETTLEMENT', nextAt: 0, ...(verdictTx ? { verdictTx } : {}), lastFailureCode: failureCode, updatedAt: this.now() });
    await this.attemptRefund(room, intent);
  }

  private async attemptRefund(room: PairRoom, intent: PairRefundIntent): Promise<void> {
    this.runtime.put('pair-rooms-v1', room.roomId, { ...room, evaluationStage: 'REFUNDING', evaluationFailureCode: intent.failureCode, retryAt: undefined, ...(intent.verdictTx ? { verdictTx: intent.verdictTx } : {}) });
    try {
      const refundTx = await this.arc.refund(room, intent.failureCode);
      const persisted = { ...intent, refundTx };
      this.runtime.put('pair-room-refund-intents', room.roomId, persisted);
      const chain = await this.arc.getRoom(room.roomId);
      this.requireBinding(room, chain);
      if (chain.state !== 4) throw new Error('Arc automatic refund readback is not final');
      this.runtime.put('pair-rooms-v1', room.roomId, { ...room, state: 'REFUNDABLE', evaluationStage: 'COMPLETE', evaluationFailureCode: intent.failureCode, evaluationAttempts: undefined, retryAt: undefined, refundTx, ...(intent.verdictTx ? { verdictTx: intent.verdictTx } : {}) });
      this.completeProgress(room.roomId, intent.verdictTx);
    } catch (error) {
      const prior = this.progressFor(room.roomId);
      const failures = prior.arcFailures + 1;
      const nextAt = this.now() + 30 * Math.min(10, failures);
      this.putProgress(room.roomId, { ...prior, phase: 'ARC_SETTLEMENT', arcFailures: failures, nextAt, lastFailureCode: 'ARC_ERROR', updatedAt: this.now() });
      this.runtime.put('pair-room-worker-errors', room.roomId, { at: this.now(), message: error instanceof Error ? error.message : 'automatic refund failed' });
      this.runtime.put('pair-rooms-v1', room.roomId, { ...room, evaluationStage: 'REFUNDING', evaluationFailureCode: 'ARC_ERROR', evaluationAttempts: failures, retryAt: nextAt, ...(intent.verdictTx ? { verdictTx: intent.verdictTx } : {}) });
    }
  }

  private deferPhase(roomId: string, phase: Exclude<PairEvaluationPhase, 'COMPLETE' | 'RECOVERY_REQUIRED'>, failureCode: PairEvaluationFailureCode, message: string, verdictTx?: string): void {
    const prior = this.progressFor(roomId);
    const field = phase === 'PROVIDER' ? 'providerFailures' : phase === 'GENLAYER_SUBMISSION' ? 'submissionFailures' : phase === 'GENLAYER_FINALITY' ? 'finalityPollFailures' : 'arcFailures';
    const failures = prior[field] + 1;
    const bounded = phase !== 'GENLAYER_FINALITY';
    const nextAt = this.now() + 600 * Math.min(RETRY_BUDGET, failures);
    const nextPhase = bounded && failures >= RETRY_BUDGET ? 'RECOVERY_REQUIRED' : phase;
    this.putProgress(roomId, { ...prior, phase: nextPhase, [field]: failures, nextAt, ...(verdictTx ? { verdictTx } : {}), lastFailureCode: failureCode, updatedAt: this.now() });
    this.runtime.put('pair-room-worker-retries', roomId, { failures: Math.min(RETRY_BUDGET, failures), nextAt });
    this.runtime.put('pair-room-worker-errors', roomId, { at: this.now(), message });
    const room = this.runtime.get<PairRoom>('pair-rooms-v1', roomId);
    if (room) this.runtime.put('pair-rooms-v1', roomId, {
      ...room,
      evaluationStage: failureCode === 'GENLAYER_NO_CONSENSUS'
        ? 'NO_CONSENSUS'
        : nextPhase === 'RECOVERY_REQUIRED' ? 'RETRYING' : phase === 'GENLAYER_FINALITY' ? 'WAITING_VERDICT' : 'RETRYING',
      evaluationFailureCode: failureCode,
      evaluationAttempts: failures,
      retryAt: nextAt,
    });
  }

  private progressFor(roomId: string): PairEvaluationProgress {
    const current = this.runtime.get<PairEvaluationProgress>(PROGRESS_NAMESPACE, roomId);
    if (current) return current;
    const intent = this.runtime.get<SettlementIntent>('pair-room-settlement-intents', roomId);
    const comparisonKey = `${sha(`arena-pair-match-v1|${roomId}`)}:${sha(`arena-pair-attempt-v1|${roomId}|1`)}`;
    const comparison = this.runtime.get<{ transactionHash?: string }>('comparison-submissions', comparisonKey);
    const legacy = this.runtime.get<{ failures?: number; nextAt?: number }>('pair-room-worker-retries', roomId);
    const basePhase: PairEvaluationPhase = intent ? 'ARC_SETTLEMENT' : comparison?.transactionHash ? 'GENLAYER_FINALITY' : comparison ? 'GENLAYER_SUBMISSION' : 'PROVIDER';
    const exhausted = (legacy?.failures ?? 0) >= RETRY_BUDGET && basePhase !== 'GENLAYER_FINALITY';
    const phase: PairEvaluationPhase = exhausted ? 'RECOVERY_REQUIRED' : basePhase;
    const migrated: PairEvaluationProgress = { schema: 'pair-room-evaluation-progress-v2', phase, providerFailures: basePhase === 'PROVIDER' ? legacy?.failures ?? 0 : 0, submissionFailures: basePhase === 'GENLAYER_SUBMISSION' ? legacy?.failures ?? 0 : 0, finalityPollFailures: basePhase === 'GENLAYER_FINALITY' ? legacy?.failures ?? 0 : 0, arcFailures: basePhase === 'ARC_SETTLEMENT' ? legacy?.failures ?? 0 : 0, nextAt: legacy?.nextAt ?? 0, ...(intent ? { verdictTx: intent.verdictTx } : comparison?.transactionHash ? { verdictTx: comparison.transactionHash } : {}), updatedAt: this.now() };
    this.putProgress(roomId, migrated);
    return migrated;
  }

  private putProgress(roomId: string, progress: PairEvaluationProgress): void {
    this.runtime.put(PROGRESS_NAMESPACE, roomId, progress);
  }

  private completeProgress(roomId: string, verdictTx?: string): void {
    const prior = this.progressFor(roomId);
    this.putProgress(roomId, { ...prior, phase: 'COMPLETE', nextAt: 0, ...(verdictTx ? { verdictTx } : {}), lastFailureCode: undefined, updatedAt: this.now() });
  }
}

type SettlementIntent = { winner: string; verdictTx: string; digest: string };
type PairRefundIntent = { failureCode?: PairEvaluationFailureCode; verdictTx?: string; refundTx?: string };
function same(a: string, b: string): boolean { return a.toLowerCase() === b.toLowerCase(); }
function sha(value: string): string { return `sha256:${createHash('sha256').update(value).digest('hex')}`; }
function classifyEvaluationFailure(message: string): PairEvaluationFailureCode {
  return /server busy|execution slots? occupied|too many requests|\b429\b|capacity/i.test(message) ? 'GENLAYER_BUSY' : 'GENLAYER_ERROR';
}
function classifyLegacyFailure(message?: string): PairEvaluationFailureCode {
  if (!message) return 'GENLAYER_ERROR';
  if (/server busy|execution slots? occupied|too many requests|\b429\b|capacity/i.test(message)) return 'GENLAYER_BUSY';
  if (/pair comparison requires|provider|empty_output|invalid_output/i.test(message)) return 'PROVIDER_ERROR';
  if (/genlayer|comparison|verdict|judge|canonical/i.test(message)) return 'GENLAYER_ERROR';
  return 'ARC_ERROR';
}
function immediateRefundFailure(code: PairEvaluationFailureCode): boolean {
  return code === 'PROVIDER_ERROR' || code === 'GENLAYER_BUSY' || code === 'GENLAYER_ERROR' || code === 'GENLAYER_NO_CONSENSUS';
}
