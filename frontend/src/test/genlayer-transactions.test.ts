import { describe, expect, it, vi } from 'vitest';

import { createStudioNextTransactionKit, STUDIO_NEXT_RPC_URL, studioNextChain } from '../adapters/genlayer-transactions';

describe('Studio Next Transaction Kit boundary', () => {
  it('uses the canonical Studio Next RPC with the RC chain identity', () => {
    const chain = studioNextChain();
    expect(chain.id).toBe(61997);
    expect(chain.rpcUrls.default.http).toEqual([STUDIO_NEXT_RPC_URL]);
  });

  it('creates the real RC2 estimate, submit and tracking surface', () => {
    const kit = createStudioNextTransactionKit({ request: vi.fn() }, '0x1111111111111111111111111111111111111111');
    expect(typeof kit.estimate).toBe('function');
    expect(typeof kit.submit).toBe('function');
    expect(typeof kit.track).toBe('function');
    expect(typeof kit.verification).toBe('function');
  });
});
