import { createTransactionKit, type Eip1193Provider, type TransactionKit } from '@genlayer/transaction-kit';
import { studioDevnet } from 'genlayer-js/chains';
import type { GenLayerChain } from 'genlayer-js/types';

export const STUDIO_NEXT_RPC_URL = 'https://studio-next.genlayer.com/api';

export function studioNextChain(): GenLayerChain {
  return {
    ...studioDevnet,
    name: 'GenLayer Studio Next',
    rpcUrls: {
      ...studioDevnet.rpcUrls,
      default: { ...studioDevnet.rpcUrls.default, http: [STUDIO_NEXT_RPC_URL] },
    },
  };
}

export function createStudioNextTransactionKit(provider: Eip1193Provider, account?: `0x${string}`): TransactionKit {
  return createTransactionKit({ chain: studioNextChain(), provider, ...(account ? { account } : {}) });
}
