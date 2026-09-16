import type { ManagedAccount, ManagedCctpTransfer, ManagedIdentityAdapter, ManagedUsdcBalance, ManagedWalletTransaction } from './interfaces';

type Fetcher = typeof fetch;

export class HttpManagedIdentityAdapter implements ManagedIdentityAdapter {
  private readonly baseUrl: string;
  private readonly fetcher: Fetcher;

  constructor(baseUrl: string, fetcher: Fetcher = fetch) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.fetcher = fetcher;
  }

  capabilities(): Promise<{ wallet: true; email: boolean; managedWallet: boolean }> {
    return this.request('/api/auth/capabilities', { method: 'GET' });
  }

  async restore(): Promise<ManagedAccount | null> {
    const response = await this.fetcher.call(globalThis, `${this.baseUrl}/api/account`, { method: 'GET', credentials: 'include' });
    if (response.status === 401 || response.status === 503) return null;
    return this.read<ManagedAccount>(response);
  }

  async signInWithWallet(address: string, signMessage: (message: string) => Promise<string>): Promise<ManagedAccount> {
    const challenge = await this.request<{ message: string }>('/api/auth/challenge', { method: 'POST', body: JSON.stringify({ address }) });
    const signature = await signMessage(challenge.message);
    await this.request<void>('/api/auth/verify', { method: 'POST', body: JSON.stringify({ address, signature }) }, true);
    return this.account();
  }

  async requestEmailCode(email: string): Promise<void> {
    await this.request<void>('/api/auth/email/challenge', { method: 'POST', body: JSON.stringify({ email }) });
  }

  async verifyEmail(email: string, code: string): Promise<ManagedAccount> {
    await this.request<void>('/api/auth/email/verify', { method: 'POST', body: JSON.stringify({ email, code }) }, true);
    return this.account();
  }

  listUsdcBalances(): Promise<ManagedUsdcBalance[]> {
    return this.request('/api/account/usdc-balances', { method: 'GET' });
  }

  transferUsdc(destinationAddress: string, amount: string): Promise<ManagedWalletTransaction> {
    return this.request('/api/account/usdc-transfers', { method: 'POST', body: JSON.stringify({ destinationAddress, amount }) });
  }

  bridgeUsdcToArc(sourceChain: string, amount: string): Promise<ManagedCctpTransfer> {
    return this.request('/api/account/cctp-transfers', { method: 'POST', body: JSON.stringify({ sourceChain, amount }) });
  }

  getCctpTransfer(operationId: string): Promise<ManagedCctpTransfer> {
    return this.request(`/api/account/cctp-transfers/${operationId}`, { method: 'GET' });
  }

  claimTournamentCredit(tournamentId: string, idempotencyKey: string): Promise<ManagedWalletTransaction> {
    return this.request(`/api/account/tournament-credits/${encodeURIComponent(tournamentId)}/withdraw`, { method: 'POST', body: JSON.stringify({ idempotencyKey }) });
  }

  async logout(): Promise<void> {
    await this.request<void>('/api/auth/logout', { method: 'POST' }, true);
  }

  private account(): Promise<ManagedAccount> {
    return this.request<ManagedAccount>('/api/account', { method: 'GET' });
  }

  private async request<T>(path: string, init: RequestInit, allowEmpty = false): Promise<T> {
    const headers = init.body ? { 'content-type': 'application/json' } : undefined;
    const response = await this.fetcher.call(globalThis, `${this.baseUrl}${path}`, { ...init, headers, credentials: 'include' });
    if (!response.ok) return this.read<T>(response);
    if (allowEmpty || response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  private async read<T>(response: Response): Promise<T> {
    const body = await response.json().catch(() => ({ error: `HTTP_${response.status}` }));
    if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : `HTTP_${response.status}`);
    return body as T;
  }
}
