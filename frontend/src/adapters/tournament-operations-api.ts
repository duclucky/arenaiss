import type { TournamentOperationsApiAdapter, TournamentOperationSnapshot } from './interfaces';

type Fetcher = typeof fetch;
export class HttpTournamentOperationsAdapter implements TournamentOperationsApiAdapter {
  private readonly base: string;
  private readonly fetcher: Fetcher;
  constructor(baseUrl: string, fetcher: Fetcher = fetch) { this.base = baseUrl.replace(/\/$/, ''); this.fetcher = fetcher; }
  list() { return this.request<TournamentOperationSnapshot[]>('/api/tournament-operations'); }
  get(tournamentId: string) { return this.request<TournamentOperationSnapshot>(`/api/tournament-operations/${encodeURIComponent(tournamentId)}`); }
  create(input: Parameters<TournamentOperationsApiAdapter['create']>[0]) { return this.request<TournamentOperationSnapshot>('/api/tournament-operations', { method: 'POST', body: JSON.stringify(input) }); }
  execute(tournamentId: string, action: Parameters<TournamentOperationsApiAdapter['execute']>[1]) { return this.request<TournamentOperationSnapshot>(`/api/tournament-operations/${encodeURIComponent(tournamentId)}/actions/${action}`, { method: 'POST', body: '{}' }); }
  private async request<T>(path: string, init: RequestInit = {}): Promise<T> { const response = await this.fetcher.call(globalThis, `${this.base}${path}`, { ...init, credentials: 'include', headers: init.body ? { 'content-type': 'application/json' } : undefined }); const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : `HTTP_${response.status}`); return body as T; }
}
