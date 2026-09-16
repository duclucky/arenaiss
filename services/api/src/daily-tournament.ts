import { createHash } from 'node:crypto';
import type { SqliteRuntimeStore } from '../../../packages/persistence/src/sqlite-runtime.ts';
import type { CreateTournamentOperation, TournamentOperationAction, TournamentOperationSnapshot, TournamentOperationsPort } from './tournament-operations.ts';

const DAY = 86_400;
const INTENTS = 'daily-tournament-intents';
const TERMINAL = new Set(['COMPLETED', 'REFUNDED']);

export async function runDailyTournamentTick(runtime: SqliteRuntimeStore, operations: TournamentOperationsPort, nowSeconds: number, stakeAmount: string): Promise<TournamentOperationSnapshot | null> {
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 1 || !/^[1-9][0-9]*$/.test(stakeAmount)) throw new Error('invalid daily Tournament configuration');
  const intents = runtime.list<CreateTournamentOperation>(INTENTS).sort((a, b) => a.startsAt - b.startsAt);
  const latest = intents.at(-1);
  if (latest) {
    let current = await operations.get(latest.tournamentId) ?? await operations.create(latest);
    if (!TERMINAL.has(current.state)) {
      if (nowSeconds < latest.startsAt) return current;
      const action = actionFor(current, nowSeconds >= latest.expiresAt);
      if (action) current = await operations.execute({ tournamentId: latest.tournamentId, action });
      if (!TERMINAL.has(current.state)) return current;
    }
  }
  // Another operator Tournament must reach a canonical terminal state before a daily registration opens.
  const all = await operations.list();
  if (all.some((item) => !TERMINAL.has(item.state))) return null;
  const startsAt = Math.floor(nowSeconds / DAY) * DAY + DAY;
  const date = new Date(startsAt * 1_000).toISOString().slice(0, 10);
  const tournamentId = `sha256:${createHash('sha256').update(`arena-iss-daily-v1|${date}`).digest('hex')}`;
  const planned: CreateTournamentOperation = { tournamentId, name: `Arena ISS Daily ${date} UTC`, registrationOpensAt: nowSeconds, registrationClosesAt: startsAt, startsAt, expiresAt: startsAt + 7 * DAY, minEntrants: 8, maxEntrants: 32, stakeAmount };
  runtime.putIfAbsent(INTENTS, tournamentId, planned);
  const input = runtime.get<CreateTournamentOperation>(INTENTS, tournamentId)!;
  if (input.startsAt !== startsAt || input.registrationClosesAt !== startsAt || input.tournamentId !== tournamentId) throw new Error('daily Tournament intent conflicts with UTC schedule');
  return await operations.get(tournamentId) ?? await operations.create(input);
}

function actionFor(snapshot: TournamentOperationSnapshot, expired: boolean): TournamentOperationAction | null {
  const action = snapshot.state === 'SETTLEMENT_PENDING' ? 'SETTLE'
    : snapshot.state === 'REFUND_PENDING' ? 'REFUND'
    : expired ? 'EXPIRE'
    : ['DRAFT', 'REGISTRATION', 'RUNNING', 'WAITING_FOR_JUDGE'].includes(snapshot.state) ? 'PROGRESS' : null;
  return action && snapshot.nextActions.includes(action) ? action : null;
}

export class DailyTournamentWorker {
  private timer?: NodeJS.Timeout;
  private stopped = true;
  private readonly runtime: SqliteRuntimeStore;
  private readonly operations: TournamentOperationsPort;
  private readonly stakeAmount: string;
  private readonly intervalMs: number;
  private readonly report: (result: { event: string; tournamentId?: string; state?: string; error?: string }) => void;
  constructor(runtime: SqliteRuntimeStore, operations: TournamentOperationsPort, stakeAmount: string, intervalMs = 30_000, report: (result: { event: string; tournamentId?: string; state?: string; error?: string }) => void = (result) => process.stdout.write(`${JSON.stringify(result)}\n`)) {
    if (!Number.isSafeInteger(intervalMs) || intervalMs < 1_000) throw new Error('invalid daily Tournament worker interval');
    if (!/^[1-9][0-9]*$/.test(stakeAmount)) throw new Error('invalid daily Tournament stake');
    this.runtime = runtime; this.operations = operations; this.stakeAmount = stakeAmount; this.intervalMs = intervalMs; this.report = report;
  }
  start() { if (!this.stopped) return; this.stopped = false; void this.tick(); }
  stop() { this.stopped = true; if (this.timer) clearTimeout(this.timer); }
  private async tick() {
    try {
      const result = await runDailyTournamentTick(this.runtime, this.operations, Math.floor(Date.now() / 1_000), this.stakeAmount);
      if (result) this.report({ event: 'daily_tournament_tick', tournamentId: result.tournamentId, state: result.state });
    } catch (error) {
      this.report({ event: 'daily_tournament_failed', error: error instanceof Error ? error.message : 'unknown error' });
    } finally {
      if (!this.stopped) this.timer = setTimeout(() => void this.tick(), this.intervalMs);
    }
  }
}
