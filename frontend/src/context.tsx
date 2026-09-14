import React, { createContext, useContext, useMemo, useState } from 'react';
import { ArcWalletAdapter, ArcNetworkConfig, ArenaWriteAdapter, AgentApiAdapter, ArenaReadAdapter, GenLayerReadAdapter } from './adapters/interfaces';
import { LazyBrowserArcWalletAdapter } from './adapters/wallet-lazy';
import { HttpAgentAdapter } from './adapters/agent-api';
import { createArenaReadAdapter } from './adapters/arena-read';
import { HttpEvaluationAdapter } from './adapters/evaluation-api';
import type { EvaluationApiAdapter } from './adapters/interfaces';

interface AppContextType {
  arenaRead: ArenaReadAdapter;
  arenaWrite: ArenaWriteAdapter | null;
  agentApi: AgentApiAdapter | null;
  evaluationApi: EvaluationApiAdapter | null;
  genLayerRead: GenLayerReadAdapter;
  wallet: ArcWalletAdapter;
  networkConfig: ArcNetworkConfig | null;
  account: string | null;
  connectWallet: (providerUuid: string) => Promise<void>;
  disconnectWallet: () => void;
}

export function loadRuntimeConfig(env: Record<string, string | undefined>): ArcNetworkConfig | null {
  const chainIdStr = env.VITE_ARC_CHAIN_ID;
  const rpcUrl = env.VITE_ARC_RPC_URL;
  const name = env.VITE_ARC_NETWORK_NAME;
  const usdcAddress = env.VITE_ARC_USDC_ADDRESS;
  const escrowAddress = env.VITE_ARC_ESCROW_ADDRESS;
  const apiUrl = env.VITE_ARENA_API_URL;
  const genLayerExplorerUrl = env.VITE_GENLAYER_EXPLORER_URL;

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
}

export function AppProvider({ children, config, env, walletAdapter, agentApiAdapter, evaluationApiAdapter, arenaReadAdapter, genLayerReadAdapter }: AppProviderProps) {
  const [account, setAccount] = useState<string | null>(null);
  
  const networkConfig = config !== undefined 
    ? config 
    : loadRuntimeConfig(env || import.meta.env);

  const [wallet] = useState<ArcWalletAdapter>(() => walletAdapter || new LazyBrowserArcWalletAdapter());
  const liveRead = useMemo(() => createArenaReadAdapter(networkConfig?.apiUrl, import.meta.env.DEV, fetch, networkConfig?.genLayerExplorerUrl), [networkConfig?.apiUrl, networkConfig?.genLayerExplorerUrl]);
  const agentApi = useMemo(() => {
    if (agentApiAdapter) return agentApiAdapter;
    if (!account) return null;
    return new HttpAgentAdapter(networkConfig?.apiUrl || '', () => account, (message) => wallet.signMessage(message));
  }, [account, agentApiAdapter, networkConfig?.apiUrl, wallet]);
  const evaluationApi = useMemo(() => {
    if (evaluationApiAdapter) return evaluationApiAdapter;
    if (!account || !agentApi) return null;
    return new HttpEvaluationAdapter(networkConfig?.apiUrl || '', async () => { await agentApi.listOwnedAgents(); });
  }, [account, agentApi, evaluationApiAdapter, networkConfig?.apiUrl]);

  const connectWallet = async (providerUuid: string) => {
    if (!networkConfig) {
      throw new Error('NOT_CONFIGURED');
    }
    const address = await wallet.connect(providerUuid);
    await wallet.switchChain(networkConfig);
    setAccount(address);
  };

  const disconnectWallet = async () => {
    await wallet.disconnect();
    setAccount(null);
  };

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
        connectWallet,
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
