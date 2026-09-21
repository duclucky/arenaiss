import { describe, expect, it, vi } from 'vitest';

import { HttpManagedIdentityAdapter } from '../adapters/managed-identity';

const account = {
  userId: `usr_${'a'.repeat(64)}`,
  principal: '0x1111111111111111111111111111111111111111',
  identity: { kind: 'WALLET' as const },
  managedWallet: { state: 'READY' as const, userId: `usr_${'a'.repeat(64)}`, walletId: 'wallet-id', address: '0x2222222222222222222222222222222222222222', blockchain: 'ARC-TESTNET' as const, accountType: 'EOA' as const },
};

describe('managed identity HTTP adapter', () => {
  it('reads server capabilities before enabling managed login', async () => {
    const adapter = new HttpManagedIdentityAdapter('', vi.fn().mockResolvedValue(new Response(JSON.stringify({ wallet: true, email: false, managedWallet: false }), { status: 200 })));
    await expect(adapter.capabilities()).resolves.toEqual({ wallet: true, email: false, managedWallet: false });
  });

  it('signs the exact server challenge and returns the Circle-managed account', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'exact challenge' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(account), { status: 200 }));
    const signed: string[] = [];
    const adapter = new HttpManagedIdentityAdapter('https://arena.example/', fetcher);

    await expect(adapter.signInWithWallet(account.principal, async (message) => { signed.push(message); return '0xsigned'; })).resolves.toEqual(account);
    expect(signed).toEqual(['exact challenge']);
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ address: account.principal, signature: '0xsigned' });
    expect(fetcher.mock.calls.every((call) => call[1].credentials === 'include')).toBe(true);
  });

  it('treats an absent or disabled managed session as signed out', async () => {
    const unauthorized = new HttpManagedIdentityAdapter('', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
    const unavailable = new HttpManagedIdentityAdapter('', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })));
    await expect(unauthorized.restore()).resolves.toBeNull();
    await expect(unavailable.restore()).resolves.toBeNull();
  });

  it('uses canonical Tournament IDs for withdrawal and exact bytes32 IDs for refund claims', async () => {
    const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ transactionId: 'tx-1', state: 'COMPLETE' }), { status: 202 }));
    const adapter = new HttpManagedIdentityAdapter('', fetcher);
    await adapter.claimTournamentCredit(`0x${'a'.repeat(64)}`, 'credit-key');
    await adapter.claimTournamentRefund(`0x${'a'.repeat(64)}`, `0x${'b'.repeat(64)}`, 'refund-key');
    expect(fetcher.mock.calls[0][0]).toContain(`/api/account/tournament-credits/sha256%3A${'a'.repeat(64)}/withdraw`);
    expect(fetcher.mock.calls[1][0]).toContain('/api/account/tournament-refunds/claim');
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ tournamentId: `0x${'a'.repeat(64)}`, entrantId: `0x${'b'.repeat(64)}`, idempotencyKey: 'refund-key' });
  });
});
