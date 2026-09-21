import type {
  ArcNetworkConfig,
  ArcWalletAdapter,
  CanonicalEntrant,
  EntrantRegistration,
  WalletProvider,
  WalletTransaction,
} from './interfaces';

/**
 * Keeps viem and the live wallet implementation out of the landing-page bundle.
 * The real adapter is loaded only when a visitor opens or uses the wallet flow.
 */
export class LazyBrowserArcWalletAdapter implements ArcWalletAdapter {
  private delegatePromise: Promise<ArcWalletAdapter> | null = null;

  private delegate(): Promise<ArcWalletAdapter> {
    if (!this.delegatePromise) {
      this.delegatePromise = import('./wallet').then(({ BrowserArcWalletAdapter }) => new BrowserArcWalletAdapter());
    }
    return this.delegatePromise;
  }

  async getProviders(): Promise<WalletProvider[]> { return (await this.delegate()).getProviders(); }
  async connect(providerUuid: string): Promise<string> { return (await this.delegate()).connect(providerUuid); }
  async switchChain(config: ArcNetworkConfig): Promise<void> { return (await this.delegate()).switchChain(config); }
  async getBalance(address: string, config: ArcNetworkConfig): Promise<string> { return (await this.delegate()).getBalance(address, config); }
  async getAllowance(address: string, config: ArcNetworkConfig): Promise<string> { return (await this.delegate()).getAllowance(address, config); }
  async getCredit(tournamentId: string, address: string, config: ArcNetworkConfig): Promise<string> {
    return (await this.delegate()).getCredit(tournamentId, address, config);
  }
  async getEntrant(tournamentId: string, entrantId: string, config: ArcNetworkConfig): Promise<CanonicalEntrant> {
    return (await this.delegate()).getEntrant(tournamentId, entrantId, config);
  }
  async canClaimRefund(tournamentId: string, entrantId: string, address: string, config: ArcNetworkConfig): Promise<boolean> {
    return (await this.delegate()).canClaimRefund!(tournamentId, entrantId, address, config);
  }
  async claimRefund(tournamentId: string, entrantId: string, config: ArcNetworkConfig): Promise<WalletTransaction> {
    return (await this.delegate()).claimRefund!(tournamentId, entrantId, config);
  }
  async approveEscrow(amount: string, config: ArcNetworkConfig): Promise<WalletTransaction> {
    return (await this.delegate()).approveEscrow(amount, config);
  }
  async registerEntrant(input: EntrantRegistration, config: ArcNetworkConfig): Promise<WalletTransaction> {
    return (await this.delegate()).registerEntrant(input, config);
  }
  async withdrawCredit(tournamentId: string, config: ArcNetworkConfig): Promise<WalletTransaction> {
    return (await this.delegate()).withdrawCredit(tournamentId, config);
  }
  async signMessage(message: string): Promise<string> { return (await this.delegate()).signMessage(message); }
  async waitForTransaction(hash: string, config: ArcNetworkConfig): Promise<'CONFIRMED' | 'FAILED'> {
    return (await this.delegate()).waitForTransaction(hash, config);
  }
  async disconnect(): Promise<void> {
    if (this.delegatePromise) await (await this.delegatePromise).disconnect();
  }
  onAccountsChanged(callback: (accounts: string[]) => void): void {
    void this.delegate().then((adapter) => adapter.onAccountsChanged(callback));
  }
  removeListener(): void {
    if (this.delegatePromise) void this.delegatePromise.then((adapter) => adapter.removeListener());
  }
}
