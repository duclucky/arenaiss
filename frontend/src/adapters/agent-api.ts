import type { AgentApiAdapter, AgentProfile, EntrantRegistration } from './interfaces';

type Fetcher = typeof fetch;

export class HttpAgentAdapter implements AgentApiAdapter {
  private baseUrl: string;
  private getAddress: () => string | null;
  private signMessage: (message: string) => Promise<string>;
  private fetcher: Fetcher;
  private authenticated = false;

  constructor(
    baseUrl: string,
    getAddress: () => string | null,
    signMessage: (message: string) => Promise<string>,
    fetcher: Fetcher = fetch,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.getAddress = getAddress;
    this.signMessage = signMessage;
    this.fetcher = fetcher;
  }

  async listOwnedAgents(): Promise<AgentProfile[]> {
    await this.ensureAuthenticated();
    return this.request<AgentProfile[]>('/api/agents', { method: 'GET' });
  }

  async createAgent(name: string, agentsMd: string): Promise<AgentProfile> {
    await this.ensureAuthenticated();
    return this.request<AgentProfile>('/api/agents', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, agentsMd }),
    });
  }

  async prepareRegistration(tournamentId: string, agentId: string): Promise<EntrantRegistration & { stakeAmount: string }> {
    await this.ensureAuthenticated();
    if (!/^sha256:[0-9a-fA-F]{64}$/.test(tournamentId)) throw new Error('INVALID_TOURNAMENT_ID');
    return this.request(`/api/tournaments/${tournamentId}/registrations`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agentId }),
    });
  }

  private async ensureAuthenticated() {
    if (this.authenticated) return;
    const address = this.getAddress();
    if (!address) throw new Error('WALLET_NOT_CONNECTED');
    const challenge = await this.request<{ message: string }>('/api/auth/challenge', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address }),
    });
    const signature = await this.signMessage(challenge.message);
    await this.request<void>('/api/auth/verify', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address, signature }),
    }, true);
    this.authenticated = true;
  }

  private async request<T>(path: string, init: RequestInit, allowEmpty = false): Promise<T> {
    const response = await this.fetcher.call(globalThis, `${this.baseUrl}${path}`, { ...init, credentials: 'include' });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({ error: `HTTP_${response.status}` }));
      throw new Error(typeof detail.error === 'string' ? detail.error : `HTTP_${response.status}`);
    }
    if (allowEmpty || response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }
}
