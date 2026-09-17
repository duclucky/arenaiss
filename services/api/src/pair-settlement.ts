import { createHash, randomUUID } from 'node:crypto';
import type { SqliteRuntimeStore } from '../../../packages/persistence/src/sqlite-runtime.ts';
import type { ChainRoom, PairEvaluationFailureCode, PairRoom } from './pair-rooms.ts';

export type PairOutcome = { state: 'WAITING'; failureCode: 'VERDICT_PENDING' }
  | { state: 'RETRY_LATER'; failureCode: 'PROVIDER_ERROR' | 'GENLAYER_BUSY' | 'GENLAYER_ERROR' }
  | { state: 'FINAL'; result: 'A_WIN' | 'B_WIN' | 'TIE'; transactionHash: string };
export interface PairOutcomePort { resolve(room: PairRoom): Promise<PairOutcome>; }
export interface PairSettlementArcPort {
  getRoom(roomId: string): Promise<ChainRoom>;
  settle(roomId: string, winner: string, verdictDigest: string): Promise<string>;
  expire(roomId: string): Promise<string>;
}

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
        this.defer(room.roomId, classifyLegacyFailure(message), message);
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
      return;
    }
    if (chain.state === 4) {
      this.runtime.put('pair-rooms-v1', room.roomId, { ...room, state: 'REFUNDABLE', evaluationStage: 'COMPLETE', evaluationFailureCode: undefined, evaluationAttempts: undefined, retryAt: undefined });
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
      }
      return;
    }
    if (chain.state !== (room.state === 'OPEN' ? 1 : 2)) throw new Error('Arc room state differs from backend');
    if (this.now() >= (room.state === 'OPEN' ? room.joinDeadline : room.resolutionDeadline)) {
      await this.arc.expire(room.roomId);
      if ((await this.arc.getRoom(room.roomId)).state !== 4) throw new Error('Arc refund readback is not final');
      this.runtime.put('pair-rooms-v1', room.roomId, { ...room, state: 'REFUNDABLE', evaluationStage: 'COMPLETE', evaluationFailureCode: undefined, evaluationAttempts: undefined, retryAt: undefined });
      return;
    }
    if (room.state === 'OPEN') return;
    let intent = this.runtime.get<SettlementIntent>('pair-room-settlement-intents', room.roomId);
    if (!intent) {
      const retry = this.runtime.get<{ failures: number; nextAt: number }>('pair-room-worker-retries', room.roomId);
      if (retry?.failures && retry.failures >= 3) {
        if (!room.evaluationFailureCode) {
          const prior = this.runtime.get<{ message?: string }>('pair-room-worker-errors', room.roomId);
          this.runtime.put('pair-rooms-v1', room.roomId, { ...room, evaluationFailureCode: classifyLegacyFailure(prior?.message) });
        }
        return;
      }
      if (retry && this.now() < retry.nextAt) return;
      this.runtime.put('pair-rooms-v1', room.roomId, { ...room, evaluationStage: 'RUNNING_AGENTS', evaluationFailureCode: undefined });
      let outcome: PairOutcome;
      try { outcome = await this.outcome.resolve(room); }
      catch (error) {
        const message = error instanceof Error ? error.message : 'unknown evaluation error';
        this.defer(room.roomId, classifyEvaluationFailure(message), message);
        return;
      }
      if (outcome.state === 'RETRY_LATER') { this.defer(room.roomId, outcome.failureCode, 'pair comparison requires a bounded retry'); return; }
      if (outcome.state !== 'FINAL') { this.runtime.put('pair-rooms-v1', room.roomId, { ...room, evaluationStage: 'WAITING_VERDICT', evaluationFailureCode: outcome.failureCode, retryAt: undefined }); return; }
      if (outcome.result === 'TIE') { this.runtime.put('pair-rooms-v1', room.roomId, { ...room, evaluationStage: 'TIE_WAITING_REFUND', evaluationFailureCode: undefined, retryAt: undefined }); return; }
      if (!/^0x[0-9a-fA-F]{64}$/.test(outcome.transactionHash)) throw new Error('comparison transaction is invalid');
      const winner = outcome.result === 'A_WIN' ? room.creatorWallet : room.challengerWallet!;
      intent = { winner, verdictTx: outcome.transactionHash, digest: sha(`arena-pair-verdict-v1|${room.roomId}|${outcome.result}|${outcome.transactionHash.toLowerCase()}`) };
      this.runtime.putIfAbsent('pair-room-settlement-intents', room.roomId, intent);
      intent = this.runtime.get<SettlementIntent>('pair-room-settlement-intents', room.roomId)!;
    }
    this.runtime.put('pair-rooms-v1', room.roomId, { ...room, evaluationStage: 'SETTLING', evaluationFailureCode: undefined, retryAt: undefined, verdictTx: intent.verdictTx });
    if (!same(intent.winner, room.creatorWallet) && !same(intent.winner, room.challengerWallet!)) throw new Error('settlement intent has an unknown winner');
    const settleTx = await this.arc.settle(room.roomId, intent.winner, intent.digest);
    const settled = await this.arc.getRoom(room.roomId);
    if (settled.state !== 3 || !same(settled.winner, intent.winner)
      || settled.verdictDigest?.toLowerCase() !== `0x${intent.digest.slice(7)}`) throw new Error('Arc settlement readback mismatch');
    this.runtime.put('pair-rooms-v1', room.roomId, { ...room, state: 'SETTLED', evaluationStage: 'COMPLETE', evaluationFailureCode: undefined, evaluationAttempts: undefined, retryAt: undefined, verdictTx: intent.verdictTx, settleTx });
  }

  private requireBinding(room: PairRoom, chain: ChainRoom): void {
    if (!same(chain.creator, room.creatorWallet) || chain.stake !== BigInt(room.stake)
      || chain.creatorAgentVersion.toLowerCase() !== `0x${room.creatorVersion.slice(7)}`
      || chain.joinDeadline !== room.joinDeadline || chain.resolutionDeadline !== room.resolutionDeadline) throw new Error('Arc room creator binding mismatch');
    if ((room.state === 'JOINED' || (room.state === 'JOINING' && room.joinTx && chain.state === 2)) && (!room.challengerWallet || !room.challengerVersion || !room.joinTx
      || !same(chain.challenger, room.challengerWallet)
      || chain.challengerAgentVersion.toLowerCase() !== `0x${room.challengerVersion.slice(7)}`)) throw new Error('Arc room challenger binding mismatch');
  }

  private defer(roomId: string, failureCode: PairEvaluationFailureCode, message: string): void {
    const prior = this.runtime.get<{ failures: number }>('pair-room-worker-retries', roomId);
    const failures = Math.min(3, (prior?.failures ?? 0) + 1);
    const nextAt = this.now() + 600 * failures;
    this.runtime.put('pair-room-worker-retries', roomId, { failures, nextAt });
    this.runtime.put('pair-room-worker-errors', roomId, { at: this.now(), message });
    const room = this.runtime.get<PairRoom>('pair-rooms-v1', roomId);
    if (room) this.runtime.put('pair-rooms-v1', roomId, { ...room, evaluationStage: 'RETRYING', evaluationFailureCode: failureCode, evaluationAttempts: failures, retryAt: nextAt });
  }
}

type SettlementIntent = { winner: string; verdictTx: string; digest: string };
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
