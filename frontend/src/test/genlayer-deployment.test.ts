import { describe, expect, it, vi } from 'vitest';

import { verifyStudioNextDeployments } from '../adapters/genlayer-deployment';
import type { GenLayerNetworkConfig } from '../adapters/interfaces';

const config: GenLayerNetworkConfig = {
  chainId: 61997,
  rpcUrl: 'https://studio-next.genlayer.com/api',
  name: 'GenLayer Studio Next',
  explorerUrl: 'https://explorer-studio-dev.genlayer.com',
  matchJudgeAddress: '0xbd5592dc0A45B78614cd5d1c2f29F6F35dabB679',
  evaluationJudgeAddress: '0x0aA2B27D04BAa4438f2c3B9560eb7989de5a934d',
};

const code = btoa('contract source');

describe('Studio Next deployment verification', () => {
  it('requires chain 61997, schemas and exact deployed source bytes', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body));
      const result = request.method === 'eth_chainId'
        ? '0xf22d'
        : request.method === 'gen_getContractCode'
          ? code
          : { methods: ['verified'] };
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }));
    });
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('contract source'));
    const hash = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');

    await expect(verifyStudioNextDeployments(config, fetcher as typeof fetch, { matchJudge: hash, evaluationJudge: hash })).resolves.toEqual({
      state: 'VERIFIED',
      chainId: 61997,
      matchJudgeVerified: true,
      evaluationJudgeVerified: true,
    });
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(fetcher.mock.calls.every(([url]) => url === config.rpcUrl)).toBe(true);
  });

  it('stops before contract reads on another chain', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0xf22f' })));
    await expect(verifyStudioNextDeployments(config, fetcher as typeof fetch)).resolves.toEqual({
      state: 'WRONG_CHAIN', chainId: 61999, matchJudgeVerified: false, evaluationJudgeVerified: false,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
