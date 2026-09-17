import type { ArenaReadAdapter, GenLayerReadAdapter, Match, MatchState, MatchVerdict, PreviewFixtureAdapter, Tournament } from './interfaces';
import { previewAdapter } from './preview';

type Fetcher = typeof fetch;
const TOURNAMENT_STATES = new Set(['UPCOMING', 'ACTIVE', 'COMPLETED', 'CANCELLED']);
const MATCH_STATES = new Set<MatchState>(['SCHEDULED', 'WAITING_FOR_OUTPUTS', 'JUDGING', 'ACCEPTED', 'FAILED', 'RETRYABLE', 'FINALIZED', 'TIE', 'RETRY', 'WINNER_ADVANCED']);
const DEMO_TOURNAMENT_IDS = new Set(['1', '2', '3']);
const GENLAYER_EXPLORERS_BY_CHAIN: Readonly<Record<number, string>> = {
  61997: 'https://explorer-studio-dev.genlayer.com',
  61999: 'https://explorer-studio.genlayer.com',
};

export class HttpArenaReadAdapter implements ArenaReadAdapter, GenLayerReadAdapter {
  private baseUrl: string;
  private fetcher: Fetcher;
  private explorerBaseUrl?: string;

  constructor(baseUrl: string, fetcher: Fetcher = fetch, explorerBaseUrl?: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.fetcher = fetcher;
    this.explorerBaseUrl = explorerBaseUrl?.replace(/\/$/, '');
  }

  async listTournaments(): Promise<Tournament[]> {
    const body = await this.request<unknown>('/api/tournaments');
    if (!Array.isArray(body)) throw new Error('INVALID_ARENA_RESPONSE');
    return body.map(normalizeTournament);
  }

  async getTournament(id: string): Promise<Tournament | null> {
    const body = await this.request<unknown>(`/api/tournaments/${encodeURIComponent(id)}`, true);
    return body === null ? null : normalizeTournament(body);
  }

  async getMatches(tournamentId: string): Promise<Match[]> {
    const body = await this.request<unknown>(`/api/tournaments/${encodeURIComponent(tournamentId)}/matches`);
    if (!Array.isArray(body)) throw new Error('INVALID_ARENA_RESPONSE');
    return body.map(normalizeMatch);
  }

  async getMatch(id: string): Promise<Match | null> {
    const body = await this.request<unknown>(`/api/matches/${encodeURIComponent(id)}`, true);
    return body === null ? null : normalizeMatch(body);
  }

  async getMatchVerdict(matchId: string): Promise<MatchVerdict | null> {
    const body = await this.request<unknown>(`/api/matches/${encodeURIComponent(matchId)}/verdict`, true);
    if (body === null) return null;
    const verdict = normalizeVerdict(body);
    const explorerBaseUrl = verdict.chainId === undefined ? this.explorerBaseUrl : GENLAYER_EXPLORERS_BY_CHAIN[verdict.chainId] ?? this.explorerBaseUrl;
    if (verdict.transactionHash && explorerBaseUrl) verdict.explorerUrl = `${explorerBaseUrl}/transactions/${verdict.transactionHash}`;
    return verdict;
  }

  private async request<T>(path: string, allowMissing = false): Promise<T | null> {
    const response = await this.fetcher.call(globalThis, `${this.baseUrl}${path}`, {
      method: 'GET',
      credentials: 'omit',
      headers: { accept: 'application/json' },
    });
    if (allowMissing && response.status === 404) return null;
    if (!response.ok) throw new Error(`ARENA_READ_HTTP_${response.status}`);
    return response.json() as Promise<T>;
  }
}

/**
 * Development-only overlay that keeps the live API as the source of truth for
 * real records while making the walkthrough fixtures discoverable in an empty
 * local environment. The preview adapter is never selected for production.
 */
class DevelopmentDemoOverlayAdapter implements PreviewFixtureAdapter {
  constructor(private readonly live: PreviewFixtureAdapter) {}

  async listTournaments(): Promise<Tournament[]> {
    const live = await this.live.listTournaments();
    const demo = await previewAdapter.listTournaments();
    const liveIds = new Set(live.map((item) => item.id));
    return [...demo.filter((item) => !liveIds.has(item.id)), ...live];
  }

  async getTournament(id: string): Promise<Tournament | null> {
    const live = await this.live.getTournament(id);
    return live ?? await previewAdapter.getTournament(id);
  }

  async getMatches(tournamentId: string): Promise<Match[]> {
    try {
      const live = await this.live.getMatches(tournamentId);
      return live.length > 0 ? live : await previewAdapter.getMatches(tournamentId);
    } catch (reason) {
      if (DEMO_TOURNAMENT_IDS.has(tournamentId) && reason instanceof Error && reason.message === 'ARENA_READ_HTTP_404') {
        return previewAdapter.getMatches(tournamentId);
      }
      throw reason;
    }
  }

  async getMatch(id: string): Promise<Match | null> {
    const live = await this.live.getMatch(id);
    return live ?? await previewAdapter.getMatch(id);
  }

  async getMatchVerdict(matchId: string): Promise<MatchVerdict | null> {
    const live = await this.live.getMatchVerdict(matchId);
    return live ?? await previewAdapter.getMatchVerdict(matchId);
  }
}

class UnavailableArenaReadAdapter implements ArenaReadAdapter, GenLayerReadAdapter {
  private unavailable(): never { throw new Error('ARENA_READ_NOT_CONFIGURED'); }
  async listTournaments(): Promise<Tournament[]> { return this.unavailable(); }
  async getTournament(): Promise<Tournament | null> { return this.unavailable(); }
  async getMatches(): Promise<Match[]> { return this.unavailable(); }
  async getMatch(): Promise<Match | null> { return this.unavailable(); }
  async getMatchVerdict(): Promise<MatchVerdict | null> { return this.unavailable(); }
}

export function createArenaReadAdapter(
  apiUrl: string | undefined,
  isDevelopment: boolean,
  fetcher: Fetcher = fetch,
  explorerBaseUrl?: string,
): PreviewFixtureAdapter {
  if (apiUrl) {
    const live = new HttpArenaReadAdapter(apiUrl, fetcher, explorerBaseUrl);
    return isDevelopment ? new DevelopmentDemoOverlayAdapter(live) : live;
  }
  if (isDevelopment) return previewAdapter;
  return new UnavailableArenaReadAdapter();
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_ARENA_RESPONSE');
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new Error('INVALID_ARENA_RESPONSE');
  return value;
}
function normalizeTournament(value: unknown): Tournament {
  const item = record(value);
  const status = text(item.status);
  if (!TOURNAMENT_STATES.has(status)) throw new Error('INVALID_ARENA_RESPONSE');
  if (item.registrationClosesAt !== undefined && (!Number.isSafeInteger(item.registrationClosesAt) || (item.registrationClosesAt as number) < 1)) throw new Error('INVALID_ARENA_RESPONSE');
  if (item.entrantIds !== undefined && (!Array.isArray(item.entrantIds) || item.entrantIds.some((id) => typeof id !== 'string'))) throw new Error('INVALID_ARENA_RESPONSE');
  if (item.operationState !== undefined && !['RECOVERY_REQUIRED', 'WAITING_FOR_JUDGE', 'RUNNING', 'SETTLEMENT_PENDING', 'REFUND_PENDING'].includes(String(item.operationState))) throw new Error('INVALID_ARENA_RESPONSE');
  let bracketSeed: Tournament['bracketSeed'];
  if (item.bracketSeed !== undefined) {
    const proof = record(item.bracketSeed);
    const schema = text(proof.schema); const seedDigest = text(proof.seedDigest); const rosterDigest = text(proof.rosterDigest);
    const entropyBlockHash = text(proof.entropyBlockHash); const entropyBlockNumber = text(proof.entropyBlockNumber);
    if (schema !== 'arena-bracket-seed-v2' || !/^sha256:[0-9a-f]{64}$/.test(seedDigest) || !/^sha256:[0-9a-f]{64}$/.test(rosterDigest) || !/^0x[0-9a-f]{64}$/.test(entropyBlockHash) || !/^(0|[1-9][0-9]*)$/.test(entropyBlockNumber)) throw new Error('INVALID_ARENA_RESPONSE');
    bracketSeed = { schema, seedDigest, rosterDigest, entropyBlockHash, entropyBlockNumber };
  }
  return { id: text(item.id), name: text(item.name), status: status as Tournament['status'], prizePool: text(item.prizePool),
    ...(item.registrationClosesAt !== undefined ? { registrationClosesAt: item.registrationClosesAt as number } : {}),
    ...(Array.isArray(item.entrantIds) ? { entrantCount: item.entrantIds.length, entrantIds: item.entrantIds as string[] } : {}),
    ...(bracketSeed ? { bracketSeed } : {}), ...(item.operationState ? { operationState: item.operationState as Tournament['operationState'] } : {}) };
}
function normalizeMatch(value: unknown): Match {
  const item = record(value);
  const state = text(item.state) as MatchState;
  if (!MATCH_STATES.has(state) || !Number.isSafeInteger(item.round) || (item.round as number) < 0) throw new Error('INVALID_ARENA_RESPONSE');
  const match: Match = { id: text(item.id), tournamentId: text(item.tournamentId), state, agentA: text(item.agentA), agentB: text(item.agentB), round: item.round as number };
  if (item.winner !== undefined) match.winner = text(item.winner);
  return match;
}
function normalizeVerdict(value: unknown): MatchVerdict & { transactionHash?: string } {
  const item = record(value);
  const winner = text(item.winner);
  if (!['A', 'B', 'TIE'].includes(winner) || !Array.isArray(item.reasons) || item.reasons.some((reason) => typeof reason !== 'string')) throw new Error('INVALID_ARENA_RESPONSE');
  const verdict: MatchVerdict & { transactionHash?: string } = {
    id: text(item.id), matchId: text(item.matchId), winner: winner as MatchVerdict['winner'], reasons: [...item.reasons] as string[], summary: text(item.summary),
  };
  if (item.source === 'LIVE' || item.source === 'PREVIEW') verdict.source = item.source;
  for (const field of ['topic', 'rubricVersion', 'safetyClass', 'canonicalMatchId', 'attemptId', 'network', 'judgeAddress', 'arcTournamentId', 'arcEscrowAddress', 'grossPoolUsdc', 'netPayoutUsdc', 'platformFeeUsdc', 'arcState'] as const) {
    if (item[field] !== undefined) verdict[field] = text(item[field]);
  }
  if (item.attempt !== undefined) {
    if (!Number.isSafeInteger(item.attempt) || (item.attempt as number) < 1) throw new Error('INVALID_ARENA_RESPONSE');
    verdict.attempt = item.attempt as number;
  }
  if (item.chainId !== undefined) {
    if (!Number.isSafeInteger(item.chainId) || (item.chainId as number) < 1) throw new Error('INVALID_ARENA_RESPONSE');
    verdict.chainId = item.chainId as number;
  }
  for (const field of ['scoreA', 'scoreB'] as const) {
    if (item[field] !== undefined) {
      if (typeof item[field] !== 'number' || !Number.isFinite(item[field]) || (item[field] as number) < 0 || (item[field] as number) > 100) throw new Error('INVALID_ARENA_RESPONSE');
      verdict[field] = item[field] as number;
    }
  }
  if (item.finality !== undefined) {
    if (!['SUBMITTED', 'ACCEPTED', 'FINALIZED'].includes(text(item.finality))) throw new Error('INVALID_ARENA_RESPONSE');
    verdict.finality = text(item.finality) as MatchVerdict['finality'];
  }
  if (item.execution !== undefined) {
    if (!['PENDING', 'SUCCESS', 'FAILED'].includes(text(item.execution))) throw new Error('INVALID_ARENA_RESPONSE');
    verdict.execution = text(item.execution) as MatchVerdict['execution'];
  }
  if (item.criteria !== undefined) {
    if (!Array.isArray(item.criteria)) throw new Error('INVALID_ARENA_RESPONSE');
    verdict.criteria = item.criteria.map((value) => {
      const criterion = record(value);
      const criterionWinner = text(criterion.winner);
      if (!['A', 'B', 'TIE'].includes(criterionWinner)) throw new Error('INVALID_ARENA_RESPONSE');
      return { id: text(criterion.id), label: text(criterion.label), winner: criterionWinner as 'A' | 'B' | 'TIE', reason: text(criterion.reason) };
    });
  }
  if (item.transactionHash !== undefined) {
    const hash = text(item.transactionHash);
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error('INVALID_ARENA_RESPONSE');
    verdict.transactionHash = hash;
  }
  return verdict;
}
