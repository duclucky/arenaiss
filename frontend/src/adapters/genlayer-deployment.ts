import type { GenLayerNetworkConfig } from './interfaces';

export const STUDIO_NEXT_SOURCE_HASHES = {
  matchJudge: 'a90bcbfac8dc9925a1e0f93e7b69ab3661ae2119f8f08a371336b55834ad13c8',
  evaluationJudge: '74682ca3f45cce2d344cc670260b3a99914fec4ee47e0fb93f6e256b40598454',
} as const;

export type StudioNextDeploymentStatus = {
  state: 'VERIFIED' | 'WRONG_CHAIN' | 'SOURCE_MISMATCH' | 'UNAVAILABLE';
  chainId?: number;
  matchJudgeVerified: boolean;
  evaluationJudgeVerified: boolean;
};

export async function verifyStudioNextDeployments(
  config: GenLayerNetworkConfig,
  fetcher: typeof fetch = fetch,
  expectedHashes: { matchJudge: string; evaluationJudge: string } = STUDIO_NEXT_SOURCE_HASHES,
): Promise<StudioNextDeploymentStatus> {
  let requestId = 0;
  const rpc = async (method: string, params: unknown[]) => {
    const response = await fetcher(config.rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params }),
      credentials: 'omit',
    });
    if (!response.ok) throw new Error(`STUDIO_NEXT_HTTP_${response.status}`);
    const payload = await response.json() as { result?: unknown; error?: unknown };
    if (payload.error !== undefined || payload.result === undefined || payload.result === null) throw new Error('STUDIO_NEXT_RPC_ERROR');
    return payload.result;
  };

  try {
    const rawChainId = await rpc('eth_chainId', []);
    if (typeof rawChainId !== 'string' || !/^0x[0-9a-f]+$/i.test(rawChainId)) throw new Error('STUDIO_NEXT_CHAIN_ID_INVALID');
    const chainId = Number.parseInt(rawChainId.slice(2), 16);
    if (chainId !== config.chainId) return { state: 'WRONG_CHAIN', chainId, matchJudgeVerified: false, evaluationJudgeVerified: false };

    const verifyContract = async (address: `0x${string}`, expectedHash: string) => {
      const [encodedCode, schema] = await Promise.all([
        rpc('gen_getContractCode', [address]),
        rpc('gen_getContractSchema', [address]),
      ]);
      if (typeof encodedCode !== 'string' || typeof schema !== 'object' || schema === null) return false;
      const binary = atob(encodedCode);
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const hash = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
      return hash === expectedHash;
    };

    const [matchJudgeVerified, evaluationJudgeVerified] = await Promise.all([
      verifyContract(config.matchJudgeAddress, expectedHashes.matchJudge),
      verifyContract(config.evaluationJudgeAddress, expectedHashes.evaluationJudge),
    ]);
    return {
      state: matchJudgeVerified && evaluationJudgeVerified ? 'VERIFIED' : 'SOURCE_MISMATCH',
      chainId,
      matchJudgeVerified,
      evaluationJudgeVerified,
    };
  } catch {
    return { state: 'UNAVAILABLE', matchJudgeVerified: false, evaluationJudgeVerified: false };
  }
}
