import { BaseError, ContractFunctionRevertedError, createPublicClient, createWalletClient, custom, defineChain, getAddress, http } from 'viem';
import { ArcWalletAdapter, WalletProvider, ArcNetworkConfig, EntrantRegistration, WalletTransaction, CanonicalEntrant } from './interfaces';
import { sanitizeWalletIcon } from '../wallet-logo';

const usdcAbi = [{
  type: 'function', name: 'approve', stateMutability: 'nonpayable',
  inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
  outputs: [{ name: '', type: 'bool' }],
}] as const;

const escrowAbi = [
  {
    type: 'function', name: 'register', stateMutability: 'nonpayable', outputs: [],
    inputs: [
      { name: 'tournamentId', type: 'bytes32' }, { name: 'entrantId', type: 'bytes32' },
      { name: 'agentId', type: 'bytes32' }, { name: 'agentsVersion', type: 'bytes32' },
      { name: 'agentsCommitment', type: 'bytes32' },
    ],
  },
  {
    type: 'function', name: 'withdrawCredit', stateMutability: 'nonpayable', outputs: [],
    inputs: [{ name: 'tournamentId', type: 'bytes32' }],
  },
  {
    type: 'function', name: 'claimRefund', stateMutability: 'nonpayable', outputs: [],
    inputs: [{ name: 'tournamentId', type: 'bytes32' }, { name: 'entrantId', type: 'bytes32' }],
  },
  {
    type: 'function', name: 'creditOf', stateMutability: 'view',
    inputs: [{ name: 'tournamentId', type: 'bytes32' }, { name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function', name: 'getEntrant', stateMutability: 'view',
    inputs: [{ name: 'tournamentId', type: 'bytes32' }, { name: 'entrantId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'tuple', components: [
      { name: 'wallet', type: 'address' }, { name: 'agentId', type: 'bytes32' },
      { name: 'agentsVersion', type: 'bytes32' }, { name: 'agentsCommitment', type: 'bytes32' },
      { name: 'registered', type: 'bool' }, { name: 'ranked', type: 'bool' },
    ] }],
  },
] as const;

declare global {
  interface WindowEventMap {
    'eip6963:announceProvider': CustomEvent;
  }
}

export class BrowserArcWalletAdapter implements ArcWalletAdapter {
  private providers: Map<string, WalletProvider> = new Map();
  private connectedProviderUuid: string | null = null;
  private connectedAccount: `0x${string}` | null = null;
  private activeConfig: ArcNetworkConfig | null = null;
  private accountsChangedCallback?: (accounts: string[]) => void;
  private registeredProviderHandler?: (...args: any[]) => void;
  private announcementHandler?: (event: CustomEvent) => void;
  private fallbackTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    this.listenForAnnouncements();
  }

  private listenForAnnouncements() {
    if (typeof window === 'undefined') return;
    this.announcementHandler = (event: CustomEvent) => {
      const detail = event.detail;
      if (detail && detail.info && detail.provider) {
        this.providers.set(detail.info.uuid, {
          name: detail.info.name,
          icon: sanitizeWalletIcon(detail.info.icon),
          rdns: typeof detail.info.rdns === 'string' ? detail.info.rdns.slice(0, 253) : undefined,
          uuid: detail.info.uuid,
          isInstalled: true,
          request: detail.provider.request.bind(detail.provider),
          on: detail.provider.on?.bind(detail.provider),
          removeListener: detail.provider.removeListener?.bind(detail.provider),
        });
      }
    };
    window.addEventListener('eip6963:announceProvider', this.announcementHandler);
    window.dispatchEvent(new Event('eip6963:requestProvider'));

    this.fallbackTimer = setTimeout(() => {
      this.inspectFallbacks();
      this.fallbackTimer = undefined;
    }, 100);
  }

  private inspectFallbacks() {
    if (typeof window === 'undefined') return;
    const w = window as any;

    const fallbacks = [
      { key: 'okxwallet', name: 'OKX Wallet', uuid: 'fallback-okx' },
      { key: 'rabby', name: 'Rabby', uuid: 'fallback-rabby' },
      { key: 'coinbaseWalletExtension', name: 'Coinbase', uuid: 'fallback-coinbase' },
      { key: 'braveWallet', name: 'Brave Wallet', uuid: 'fallback-brave' },
      { key: 'metaMask', name: 'MetaMask', uuid: 'fallback-metamask' },
      { key: 'ethereum', name: 'Injected Provider', uuid: 'fallback-ethereum' }
    ];

    for (const f of fallbacks) {
      if (w[f.key] && typeof w[f.key].request === 'function') {
        const alreadyHas = Array.from(this.providers.values()).some(
          (provider) => provider.name.toLowerCase() === f.name.toLowerCase(),
        );
        if (!alreadyHas && !this.providers.has(f.uuid)) {
          this.providers.set(f.uuid, {
            name: f.name,
            icon: '',
            uuid: f.uuid,
            isInstalled: true,
            request: w[f.key].request.bind(w[f.key]),
            on: w[f.key].on?.bind(w[f.key]),
            removeListener: w[f.key].removeListener?.bind(w[f.key]),
          });
        }
      }
    }
  }

  async getProviders(): Promise<WalletProvider[]> {
    if (this.fallbackTimer) {
      await new Promise<void>(resolve => setTimeout(resolve, 120));
    } else {
      this.inspectFallbacks();
    }
    return Array.from(this.providers.values());
  }

  async connect(providerUuid: string): Promise<string> {
    const provider = this.providers.get(providerUuid);
    if (!provider) {
      throw new Error('NOT_CONFIGURED');
    }
    
    try {
      const accounts = await provider.request({ method: 'eth_requestAccounts' });
      if (accounts && accounts.length > 0) {
        this.connectedProviderUuid = providerUuid;
        // attach listener if possible
        if (this.accountsChangedCallback && provider.on) {
          this.registeredProviderHandler = (accs: any) => {
            if (this.accountsChangedCallback && Array.isArray(accs)) {
              this.accountsChangedCallback(accs as string[]);
            }
          };
          provider.on('accountsChanged', this.registeredProviderHandler);
        }
        if (!isAddress(accounts[0])) throw new Error('INVALID_ADDRESS');
        this.connectedAccount = getAddress(accounts[0]);
        return this.connectedAccount;
      }
      throw new Error('NOT_CONFIGURED');
    } catch (error) {
      throw new Error('NOT_CONFIGURED');
    }
  }

  async switchChain(config: ArcNetworkConfig): Promise<void> {
    if (!this.connectedProviderUuid) throw new Error('NOT_CONFIGURED');
    const provider = this.providers.get(this.connectedProviderUuid);
    if (!provider) throw new Error('NOT_CONFIGURED');

    const targetChainId = `0x${config.chainId.toString(16)}`;
    try {
      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: targetChainId }],
      });
    } catch (switchError: any) {
      if (switchError.code === 4902) {
        await provider.request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId: targetChainId,
              chainName: config.name,
              rpcUrls: [config.rpcUrl],
              nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
              blockExplorerUrls: ['https://explorer.testnet.arc.io'],
            },
          ],
        });
        // EIP-3085 does not require the wallet to switch after adding a network.
        const chainAfterAdd = await provider.request({ method: 'eth_chainId' });
        if (chainAfterAdd !== targetChainId) {
          await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: targetChainId }] });
        }
      } else {
        throw switchError;
      }
    }
    const activeChainId = await provider.request({ method: 'eth_chainId' });
    if (activeChainId !== targetChainId) throw new Error('WRONG_CHAIN');
    this.activeConfig = config;
  }

  async getBalance(address: string, config: ArcNetworkConfig): Promise<string> {
    if (!this.connectedProviderUuid) throw new Error('NOT_CONFIGURED');
    const provider = this.providers.get(this.connectedProviderUuid);
    if (!provider) throw new Error('NOT_CONFIGURED');
    if (!isAddress(address)) throw new Error('INVALID_ADDRESS');
    if (!config.usdcAddress || !isConfiguredAddress(config.usdcAddress)) {
      throw new Error('NOT_CONFIGURED');
    }

    try {
      // balanceOf(address)
      const data = '0x70a08231000000000000000000000000' + address.toLowerCase().slice(2);
      const result = await provider.request({
        method: 'eth_call',
        params: [{
          to: config.usdcAddress,
          data
        }, 'latest']
      });

      if (typeof result !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(result)) throw new Error('EMPTY_RESULT');
      return BigInt(result).toString();
    } catch (err: any) {
      throw new Error(err.message === 'EMPTY_RESULT' ? 'EMPTY_RESULT' : 'PROVIDER_ERROR');
    }
  }

  async getAllowance(address: string, config: ArcNetworkConfig): Promise<string> {
    if (!this.connectedProviderUuid) throw new Error('NOT_CONFIGURED');
    const provider = this.providers.get(this.connectedProviderUuid);
    if (!provider) throw new Error('NOT_CONFIGURED');
    if (!isAddress(address) || !config.usdcAddress || !isConfiguredAddress(config.usdcAddress) || !config.escrowAddress || !isConfiguredAddress(config.escrowAddress)) {
      throw new Error('NOT_CONFIGURED');
    }

    try {
      // allowance(owner, spender)
      const ownerPad = address.toLowerCase().slice(2).padStart(64, '0');
      const spenderPad = config.escrowAddress.toLowerCase().slice(2).padStart(64, '0');
      const data = '0xdd62ed3e' + ownerPad + spenderPad;
      const result = await provider.request({
        method: 'eth_call',
        params: [{
          to: config.usdcAddress,
          data
        }, 'latest']
      });

      if (typeof result !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(result)) throw new Error('EMPTY_RESULT');
      return BigInt(result).toString();
    } catch (err: any) {
      throw new Error(err.message === 'EMPTY_RESULT' ? 'EMPTY_RESULT' : 'PROVIDER_ERROR');
    }
  }

  async approveEscrow(amount: string, config: ArcNetworkConfig): Promise<WalletTransaction> {
    const value = requireAmount(amount);
    const { client } = this.requireWriteClient(config);
    if (!config.usdcAddress || !isConfiguredAddress(config.usdcAddress) || !config.escrowAddress || !isConfiguredAddress(config.escrowAddress)) {
      throw new Error('NOT_CONFIGURED');
    }
    const hash = await client.writeContract({
      address: getAddress(config.usdcAddress), abi: usdcAbi, functionName: 'approve',
      args: [getAddress(config.escrowAddress), value],
    });
    return { hash, state: 'SUBMITTED' };
  }

  async registerEntrant(input: EntrantRegistration, config: ArcNetworkConfig): Promise<WalletTransaction> {
    const values = [input.tournamentId, input.entrantId, input.agentId, input.agentsVersion, input.agentsCommitment];
    if (values.some((value) => !isBytes32(value))) throw new Error('INVALID_BYTES32');
    const { client } = this.requireWriteClient(config);
    if (!config.escrowAddress || !isConfiguredAddress(config.escrowAddress)) throw new Error('NOT_CONFIGURED');
    const hash = await client.writeContract({
      address: getAddress(config.escrowAddress), abi: escrowAbi, functionName: 'register',
      args: values as [`0x${string}`, `0x${string}`, `0x${string}`, `0x${string}`, `0x${string}`],
    });
    return { hash, state: 'SUBMITTED' };
  }

  async withdrawCredit(tournamentId: string, config: ArcNetworkConfig): Promise<WalletTransaction> {
    if (!isBytes32(tournamentId)) throw new Error('INVALID_BYTES32');
    const { client } = this.requireWriteClient(config);
    if (!config.escrowAddress || !isConfiguredAddress(config.escrowAddress)) throw new Error('NOT_CONFIGURED');
    const hash = await client.writeContract({
      address: getAddress(config.escrowAddress), abi: escrowAbi, functionName: 'withdrawCredit',
      args: [tournamentId as `0x${string}`],
    });
    return { hash, state: 'SUBMITTED' };
  }

  async canClaimRefund(tournamentId: string, entrantId: string, address: string, config: ArcNetworkConfig): Promise<boolean> {
    if (!isBytes32(tournamentId) || !isBytes32(entrantId)) throw new Error('INVALID_BYTES32');
    if (!isAddress(address)) throw new Error('INVALID_ADDRESS');
    if (!config.escrowAddress || !isConfiguredAddress(config.escrowAddress)) throw new Error('NOT_CONFIGURED');
    try {
      await createPublicClient({ chain: arcChain(config), transport: http(config.rpcUrl) }).simulateContract({
        address: getAddress(config.escrowAddress), abi: escrowAbi, functionName: 'claimRefund',
        args: [tournamentId as `0x${string}`, entrantId as `0x${string}`], account: getAddress(address),
      });
      return true;
    } catch (error) {
      if (error instanceof BaseError && error.walk((cause) => cause instanceof ContractFunctionRevertedError)) return false;
      throw error;
    }
  }

  async claimRefund(tournamentId: string, entrantId: string, config: ArcNetworkConfig): Promise<WalletTransaction> {
    if (!isBytes32(tournamentId) || !isBytes32(entrantId)) throw new Error('INVALID_BYTES32');
    const { client } = this.requireWriteClient(config);
    if (!config.escrowAddress || !isConfiguredAddress(config.escrowAddress)) throw new Error('NOT_CONFIGURED');
    const hash = await client.writeContract({
      address: getAddress(config.escrowAddress), abi: escrowAbi, functionName: 'claimRefund',
      args: [tournamentId as `0x${string}`, entrantId as `0x${string}`],
    });
    return { hash, state: 'SUBMITTED' };
  }

  async getCredit(tournamentId: string, address: string, config: ArcNetworkConfig): Promise<string> {
    if (!isBytes32(tournamentId)) throw new Error('INVALID_BYTES32');
    if (!isAddress(address)) throw new Error('INVALID_ADDRESS');
    if (!config.escrowAddress || !isConfiguredAddress(config.escrowAddress)) throw new Error('NOT_CONFIGURED');
    const client = createPublicClient({ chain: arcChain(config), transport: http(config.rpcUrl) });
    const result = await client.readContract({
      address: getAddress(config.escrowAddress), abi: escrowAbi, functionName: 'creditOf',
      args: [tournamentId as `0x${string}`, getAddress(address)],
    });
    return result.toString();
  }

  async getEntrant(tournamentId: string, entrantId: string, config: ArcNetworkConfig): Promise<CanonicalEntrant> {
    if (!isBytes32(tournamentId) || !isBytes32(entrantId)) throw new Error('INVALID_BYTES32');
    if (!config.escrowAddress || !isConfiguredAddress(config.escrowAddress)) throw new Error('NOT_CONFIGURED');
    const result = await createPublicClient({ chain: arcChain(config), transport: http(config.rpcUrl) }).readContract({
      address: getAddress(config.escrowAddress), abi: escrowAbi, functionName: 'getEntrant',
      args: [tournamentId as `0x${string}`, entrantId as `0x${string}`],
    });
    return { tournamentId, entrantId, wallet: result.wallet, agentId: result.agentId, agentsVersion: result.agentsVersion, agentsCommitment: result.agentsCommitment, registered: result.registered, ranked: result.ranked };
  }

  async signMessage(message: string): Promise<string> {
    if (!message) throw new Error('INVALID_MESSAGE');
    if (!this.activeConfig) throw new Error('NOT_CONFIGURED');
    const { client } = this.requireWriteClient(this.activeConfig);
    return client.signMessage({ message });
  }

  async waitForTransaction(hash: string, config: ArcNetworkConfig): Promise<'CONFIRMED' | 'FAILED'> {
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error('INVALID_TRANSACTION_HASH');
    const { provider, chain } = this.requireProviderAndChain(config);
    const receipt = await createPublicClient({ chain, transport: custom(provider) }).waitForTransactionReceipt({ hash: hash as `0x${string}` });
    return receipt.status === 'success' ? 'CONFIRMED' : 'FAILED';
  }

  private requireWriteClient(config: ArcNetworkConfig) {
    this.activeConfig = config;
    const { provider, chain } = this.requireProviderAndChain(config);
    const account = this.connectedAccount!;
    return { client: createWalletClient({ account, chain, transport: custom(provider) }), account };
  }

  private requireProviderAndChain(config: ArcNetworkConfig) {
    if (!this.connectedProviderUuid || !this.connectedAccount) throw new Error('NOT_CONFIGURED');
    const provider = this.providers.get(this.connectedProviderUuid);
    if (!provider) throw new Error('NOT_CONFIGURED');
    return { provider, chain: arcChain(config) };
  }

  async disconnect(): Promise<void> {
    if (this.connectedProviderUuid && this.registeredProviderHandler) {
      const provider = this.providers.get(this.connectedProviderUuid);
      if (provider && provider.removeListener) {
        provider.removeListener('accountsChanged', this.registeredProviderHandler);
      }
    }
    this.connectedProviderUuid = null;
    this.connectedAccount = null;
    this.activeConfig = null;
    this.registeredProviderHandler = undefined;
  }

  onAccountsChanged(callback: (accounts: string[]) => void): void {
    this.accountsChangedCallback = callback;
    if (this.connectedProviderUuid) {
      const provider = this.providers.get(this.connectedProviderUuid);
      if (provider && provider.on && !this.registeredProviderHandler) {
        this.registeredProviderHandler = (accs: any) => {
          if (Array.isArray(accs)) {
            callback(accs as string[]);
          }
        };
        provider.on('accountsChanged', this.registeredProviderHandler);
      }
    }
  }

  removeListener(): void {
    if (this.connectedProviderUuid && this.registeredProviderHandler) {
      const provider = this.providers.get(this.connectedProviderUuid);
      if (provider && provider.removeListener) {
        provider.removeListener('accountsChanged', this.registeredProviderHandler);
      }
    }
    this.accountsChangedCallback = undefined;
    this.registeredProviderHandler = undefined;
    if (this.fallbackTimer) {
      clearTimeout(this.fallbackTimer);
      this.fallbackTimer = undefined;
    }
    if (typeof window !== 'undefined' && this.announcementHandler) {
      window.removeEventListener('eip6963:announceProvider', this.announcementHandler);
      this.announcementHandler = undefined;
    }
  }
}

function arcChain(config: ArcNetworkConfig) {
  return defineChain({
    id: config.chainId,
    name: config.name,
    nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } },
  });
}

function isAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

function isConfiguredAddress(value: string): boolean {
  return isAddress(value) && !/^0x0{40}$/i.test(value);
}

function isBytes32(value: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(value) && !/^0x0{64}$/i.test(value);
}

function requireAmount(value: string): bigint {
  if (!/^\d+$/.test(value)) throw new Error('INVALID_AMOUNT');
  const amount = BigInt(value);
  if (amount <= 0n) throw new Error('INVALID_AMOUNT');
  return amount;
}
