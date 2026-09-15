import { studioDevnet } from "genlayer-js/chains";
import type { GenLayerChain } from "genlayer-js/types";

export const STUDIO_NEXT_CHAIN_ID = 61_997;
export const STUDIO_NEXT_RPC_URL = "https://studio-next.genlayer.com/api";

export function studioNextChain(): GenLayerChain {
  return {
    ...studioDevnet,
    name: "GenLayer Studio Next",
    rpcUrls: {
      ...studioDevnet.rpcUrls,
      default: { ...studioDevnet.rpcUrls.default, http: [STUDIO_NEXT_RPC_URL] },
    },
  };
}
