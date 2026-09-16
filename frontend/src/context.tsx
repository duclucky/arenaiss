import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { ArcWalletAdapter, ArcNetworkConfig, ArenaWriteAdapter, AgentApiAdapter, ArenaReadAdapter, GenLayerReadAdapter, ManagedAccount, ManagedIdentityAdapter, MarketplaceApiAdapter, TournamentOperationsApiAdapter } from './adapters/interfaces';
import { LazyBrowserArcWalletAdapter } from './adapters/wallet-lazy';
import { HttpAgentAdapter } from './adapters/agent-api';
import { createArenaReadAdapter } from './adapters/arena-read';
import { HttpEvaluationAdapter } from './adapters/evaluation-api';
import type { EvaluationApiAdapter } from './adapters/interfaces';
import { HttpManagedIdentityAdapter } from './adapters/managed-identity';
import { HttpMarketplaceAdapter } from './adapters/marketplace-api';
import { HttpTournamentOperationsAdapter } from './adapters/tournament-operations-api';

interface AppContextType {
  arenaRead: ArenaReadAdapter;
  arenaWrite: ArenaWriteAdapter | null;
  agentApi: AgentApiAdapter | null;
  evaluationApi: EvaluationApiAdapter | null;
  genLayerRead: GenLayerReadAdapter;
  wallet: ArcWalletAdapter;
  networkConfig: ArcNetworkConfig | null;
  account: string | null;
  managedAccount: ManagedAccount | null;
  managedIdentity: ManagedIdentityAdapter | null;
  managedIdentityEnabled: boolean;
  marketplaceApi: MarketplaceApiAdapter | null;
  tournamentOperationsApi: TournamentOperationsApiAdapter | null;
  connectWallet: (providerUuid: string) => Promise<void>;
  requestEmailCode: (email: string) => Promise<void>;
  signInWithEmail: (email: string, code: string) => Promise<void>;
  disconnectWallet: () => Promise<void>;
}

export function loadRuntimeConfig(env: Record<string, string | undefined>): ArcNetworkConfig | null {
  const chainIdStr = env.VITE_ARC_CHAIN_ID;
  const rpcUrl = env.VITE_ARC_RPC_URL;
  const name = env.VITE_ARC_NETWORK_NAME;
  const usdcAddress = env.VITE_ARC_USDC_ADDRESS;
  const escrowAddress = env.VITE_ARC_ESCROW_ADDRESS;
  const apiUrl = env.VITE_ARENA_API_URL;
  const genLayerExplorerUrl = env.VITE_GENLAYER_EXPLORER_URL;
  const genLayerChainId = env.VITE_GENLAYER_CHAIN_ID;
  const genLayerRpcUrl = env.VITE_GENLAYER_RPC_URL;
  const genLayerName = env.VITE_GENLAYER_NETWORK_NAME;
  const evaluationJudgeAddress = env.VITE_GENLAYER_EVALUATION_JUDGE_ADDRESS;
  const comparisonJudgeAddress = env.VITE_GENLAYER_COMPARISON_JUDGE_ADDRESS;

  if (!chainIdStr || !rpcUrl || !name || !name.trim()) {
    return null;
  }

  if (!/^\d+$/.test(chainIdStr)) {
    return null;
  }

  const chainId = parseInt(chainIdStr, 10);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    return null;
  }

  try {
    const url = new URL(rpcUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
  } catch {
    return null;
  }

  const config: ArcNetworkConfig = {
    chainId,
    rpcUrl,
    name,
  };

  const addressPattern = /^0x[0-9a-fA-F]{40}$/;
  if (usdcAddress !== undefined && usdcAddress !== '' && (!addressPattern.test(usdcAddress) || /^0x0{40}$/i.test(usdcAddress))) {
    return null;
  }
  if (escrowAddress !== undefined && escrowAddress !== '' && (!addressPattern.test(escrowAddress) || /^0x0{40}$/i.test(escrowAddress))) {
    return null;
  }
  if (usdcAddress) config.usdcAddress = usdcAddress;
  if (escrowAddress) config.escrowAddress = escrowAddress;
  if (apiUrl) {
    try {
      if (!apiUrl.startsWith('/')) {
        const url = new URL(apiUrl);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      } else if (apiUrl.startsWith('//')) return null;
      config.apiUrl = apiUrl;
    } catch { return null; }
  }
  if (genLayerExplorerUrl) {
    try {
      const url = new URL(genLayerExplorerUrl);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      config.genLayerExplorerUrl = genLayerExplorerUrl;
    } catch { return null; }
  }

  const genLayerValues = [genLayerChainId, genLayerRpcUrl, genLayerName, genLayerExplorerUrl, evaluationJudgeAddress, comparisonJudgeAddress];
  if (genLayerValues.some((value) => value !== undefined && value !== '') && genLayerValues.some((value) => !value)) return null;
  if (genLayerValues.every((value) => Boolean(value))) {
    if (genLayerChainId !== '61997' || !genLayerName?.trim()) return null;
    try {
      if (new URL(genLayerRpcUrl!).protocol !== 'https:' || new URL(genLayerExplorerUrl!).protocol !== 'https:') return null;
    } catch { return null; }
    if (!addressPattern.test(evaluationJudgeAddress!) || /^0x0{40}$/i.test(evaluationJudgeAddress!)
      || !addressPattern.test(comparisonJudgeAddress!) || /^0x0{40}$/i.test(comparisonJudgeAddress!)) return null;
    config.genLayer = {
      chainId: 61997,
      rpcUrl: genLayerRpcUrl!,
      name: genLayerName!,
      explorerUrl: genLayerExplorerUrl!,
      evaluationJudgeAddress: evaluationJudgeAddress! as `0x${string}`,
      comparisonJudgeAddress: comparisonJudgeAddress! as `0x${string}`,
    };
  }

  return config;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

interface AppProviderProps {
  children: React.ReactNode;
  config?: ArcNetworkConfig | null;
  env?: Record<string, string | undefined>;
  walletAdapter?: ArcWalletAdapter;
  agentApiAdapter?: AgentApiAdapter;
  evaluationApiAdapter?: EvaluationApiAdapter;
  arenaReadAdapter?: ArenaReadAdapter;
  genLayerReadAdapter?: GenLayerReadAdapter;
  identityAdapter?: ManagedIdentityAdapter;
  marketplaceApiAdapter?: MarketplaceApiAdapter;
  tournamentOperationsApiAdapter?: TournamentOperationsApiAdapter;
}

export function AppProvider({ children, config, env, walletAdapter, agentApiAdapter, evaluationApiAdapter, arenaReadAdapter, genLayerReadAdapter, identityAdapter, marketplaceApiAdapter, tournamentOperationsApiAdapter }: AppProviderProps) {
  const [account, setAccount] = useState<string | null>(null);
  const [managedAccount, setManagedAccount] = useState<ManagedAccount | null>(null);
  const [managedIdentityEnabled, setManagedIdentityEnabled] = useState(Boolean(identityAdapter));
  
  const networkConfig = config !== undefined 
    ? config 
    : loadRuntimeConfig(env || import.meta.env);

  const [wallet] = useState<ArcWalletAdapter>(() => walletAdapter || new LazyBrowserArcWalletAdapter());
  const identity = useMemo(() => identityAdapter || (networkConfig?.apiUrl !== undefined ? new HttpManagedIdentityAdapter(networkConfig.apiUrl) : null), [identityAdapter, networkConfig?.apiUrl]);
  const liveRead = useMemo(() => createArenaReadAdapter(networkConfig?.apiUrl, import.meta.env.DEV, fetch, networkConfig?.genLayerExplorerUrl), [networkConfig?.apiUrl, networkConfig?.genLayerExplorerUrl]);
  const agentApi = useMemo(() => {
    if (agentApiAdapter) return agentApiAdapter;
    if (!account) return null;
    return new HttpAgentAdapter(networkConfig?.apiUrl || '', () => account, (message) => wallet.signMessage(message), fetch, Boolean(managedAccount));
  }, [account, agentApiAdapter, managedAccount, networkConfig?.apiUrl, wallet]);
  const evaluationApi = useMemo(() => {
    if (evaluationApiAdapter) return evaluationApiAdapter;
    if (!account || !agentApi) return null;
    return new HttpEvaluationAdapter(networkConfig?.apiUrl || '', async () => { await agentApi.listOwnedAgents(); });
  }, [account, agentApi, evaluationApiAdapter, networkConfig?.apiUrl]);
  const marketplaceApi = useMemo(() => marketplaceApiAdapter || (networkConfig?.apiUrl ? new HttpMarketplaceAdapter(networkConfig.apiUrl) : null), [marketplaceApiAdapter, networkConfig?.apiUrl]);
  const tournamentOperationsApi = useMemo(() => tournamentOperationsApiAdapter || (networkConfig?.apiUrl ? new HttpTournamentOperationsAdapter(networkConfig.apiUrl) : null), [networkConfig?.apiUrl, tournamentOperationsApiAdapter]);

  const connectWallet = async (providerUuid: string) => {
    if (!networkConfig) {
      throw new Error('NOT_CONFIGURED');
    }
    const address = await wallet.connect(providerUuid);
    try {
      await wallet.switchChain(networkConfig);
    } catch (reason) {
      if (reason && typeof reason === 'object' && 'code' in reason && reason.code === 4001) throw reason;
      throw new Error('ARC_NETWORK_FAILED');
    }
    if (identity && managedIdentityEnabled) {
      const authenticated = await identity.signInWithWallet(address, (message) => wallet.signMessage(message));
      setManagedAccount(authenticated);
      setAccount(authenticated.managedWallet.address);
    } else {
      setAccount(address);
    }
  };

  const requestEmailCode = async (email: string) => {
    if (!identity || !managedIdentityEnabled) throw new Error('EMAIL_AUTH_NOT_CONFIGURED');
    await identity.requestEmailCode(email);
  };

  const signInWithEmail = async (email: string, code: string) => {
    if (!identity || !managedIdentityEnabled) throw new Error('EMAIL_AUTH_NOT_CONFIGURED');
    const authenticated = await identity.verifyEmail(email, code);
    setManagedAccount(authenticated);
    setAccount(authenticated.managedWallet.address);
  };

  const disconnectWallet = async () => {
    if (identity && managedAccount) await identity.logout();
    await wallet.disconnect();
    setManagedAccount(null);
    setAccount(null);
  };

  useEffect(() => {
    let cancelled = false;
    if (!identity) return () => { cancelled = true; };
    identity.capabilities().then(async (capabilities) => {
      if (cancelled) return;
      setManagedIdentityEnabled(capabilities.email && capabilities.managedWallet);
      if (!capabilities.managedWallet) return;
      const restored = await identity.restore();
      if (cancelled || !restored) return;
      setManagedAccount(restored);
      setAccount(restored.managedWallet.address);
    }).catch(() => { if (!cancelled) setManagedIdentityEnabled(false); });
    return () => { cancelled = true; };
  }, [identity]);

  return (
    <AppContext.Provider
      value={{
        arenaRead: arenaReadAdapter || liveRead,
        arenaWrite: null, // live writes disabled in preview
        agentApi,
        evaluationApi,
        genLayerRead: genLayerReadAdapter || (arenaReadAdapter && 'getMatchVerdict' in arenaReadAdapter ? arenaReadAdapter as ArenaReadAdapter & GenLayerReadAdapter : liveRead),
        wallet,
        networkConfig,
        account,
        managedAccount,
        managedIdentity: identity,
        managedIdentityEnabled,
        marketplaceApi,
        tournamentOperationsApi,
        connectWallet,
        requestEmailCode,
        signInWithEmail,
        disconnectWallet,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useAppContext must be used within AppProvider');
  return context;
}
