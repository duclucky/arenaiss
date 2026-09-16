import { createHash } from 'node:crypto';

import type { SqliteRuntimeStore } from '../../../packages/persistence/src/sqlite-runtime.ts';
import type { CreateTournamentOperation, TournamentOperationsPort } from './tournament-operations.ts';

const REQUEST_KEY = 'arena-iss-reference-cup-8x1-usdc-30m-2026-09-16-v1';
const TOURNAMENT_ID = `sha256:${createHash('sha256').update(REQUEST_KEY).digest('hex')}`;
const INTENT_NAMESPACE = 'one-time-tournament-intents';

export async function launchReferenceTournament(runtime: SqliteRuntimeStore, operations: TournamentOperationsPort, nowSeconds: number) {
  if (!Number.isSafeInteger(nowSeconds) || nowSeconds < 1) throw new Error('invalid launch time');
  const planned: CreateTournamentOperation = {
    tournamentId: TOURNAMENT_ID,
    name: 'Arena ISS Reference Cup',
    registrationOpensAt: nowSeconds,
    registrationClosesAt: nowSeconds + 1_800,
    startsAt: nowSeconds + 1_800,
    expiresAt: nowSeconds + 7 * 86_400,
    minEntrants: 8,
    maxEntrants: 8,
    stakeAmount: '1000000',
  };
  runtime.putIfAbsent(INTENT_NAMESPACE, TOURNAMENT_ID, planned);
  const input = runtime.get<CreateTournamentOperation>(INTENT_NAMESPACE, TOURNAMENT_ID);
  if (!input || input.tournamentId !== TOURNAMENT_ID || input.name !== planned.name
    || input.minEntrants !== 8 || input.maxEntrants !== 8 || input.stakeAmount !== '1000000'
    || input.registrationClosesAt - input.registrationOpensAt !== 1_800
    || input.startsAt !== input.registrationClosesAt || input.expiresAt - input.registrationOpensAt !== 7 * 86_400) {
    throw new Error('stored reference tournament intent conflicts with approved policy');
  }
  const existing = await operations.get(TOURNAMENT_ID);
  const snapshot = existing ?? await operations.create(input);
  return { input, snapshot };
}
