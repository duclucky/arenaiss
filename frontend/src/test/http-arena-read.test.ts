import { describe, expect, it, vi } from 'vitest';

import { HttpArenaReadAdapter, createArenaReadAdapter } from '../adapters/arena-read';

describe('arena live-read adapter', () => {
  it('reads normalized tournament, match and verdict endpoints without authentication', async () => {
    const fetcher = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.endsWith('/api/tournaments')) return new Response(JSON.stringify([{ id: 't1', name: 'Arena One', status: 'ACTIVE', prizePool: '800000' }]), { status: 200 });
      if (url.endsWith('/api/tournaments/t1')) return new Response(JSON.stringify({ id: 't1', name: 'Arena One', status: 'ACTIVE', prizePool: '800000' }), { status: 200 });
      if (url.endsWith('/api/tournaments/t1/matches')) return new Response(JSON.stringify([{ id: 'm1', tournamentId: 't1', state: 'FINALIZED', agentA: 'A', agentB: 'B', winner: 'A', round: 1 }]), { status: 200 });
      if (url.endsWith('/api/matches/m1/verdict')) return new Response(JSON.stringify({ id: 'v1', matchId: 'm1', winner: 'A', reasons: ['reason'], summary: 'A wins', transactionHash: `0x${'ab'.repeat(32)}` }), { status: 200 });
      return new Response(JSON.stringify({ id: 'm1', tournamentId: 't1', state: 'FINALIZED', agentA: 'A', agentB: 'B', winner: 'A', round: 1 }), { status: 200 });
    });
    const adapter = new HttpArenaReadAdapter('https://arena.example/', fetcher as typeof fetch, 'https://explorer.genlayer.com');
    expect((await adapter.listTournaments())[0].name).toBe('Arena One');
    expect((await adapter.getTournament('t1'))?.status).toBe('ACTIVE');
    expect((await adapter.getMatches('t1'))[0].state).toBe('FINALIZED');
    expect((await adapter.getMatch('m1'))?.winner).toBe('A');
    expect((await adapter.getMatchVerdict('m1'))?.explorerUrl).toBe(`https://explorer.genlayer.com/transactions/0x${'ab'.repeat(32)}`);
    expect(fetcher.mock.calls.every((call) => call[1]?.credentials === 'omit')).toBe(true);
  });

  it('never enables preview data in a production selection without an API URL', async () => {
    const adapter = createArenaReadAdapter(undefined, false);
    await expect(adapter.listTournaments()).rejects.toThrow('ARENA_READ_NOT_CONFIGURED');
  });

  it('exposes marked walkthrough fixtures alongside an empty development API', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith('/api/tournaments')) return new Response(JSON.stringify([]), { status: 200 });
      if (url.endsWith('/api/tournaments/1')) return new Response('{}', { status: 404 });
      if (url.endsWith('/api/tournaments/1/matches')) return new Response(JSON.stringify([]), { status: 200 });
      return new Response('{}', { status: 404 });
    });
    const adapter = createArenaReadAdapter('/api', true, fetcher as typeof fetch);
    expect((await adapter.listTournaments()).map((item) => item.id)).toEqual(['1', '2', '3']);
    expect((await adapter.getTournament('1'))?.demo?.format).toContain('single elimination');
    expect((await adapter.getMatches('1')).length).toBeGreaterThan(0);
  });

  it('invokes the browser fetch function with its global receiver', async () => {
    let receiver: unknown;
    const fetcher = function (this: unknown) {
      receiver = this;
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
    };
    const adapter = new HttpArenaReadAdapter('/', fetcher as typeof fetch);
    await adapter.listTournaments();
    expect(receiver).toBe(globalThis);
  });

  it('accepts the public refundable-cancellation status', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify([{ id: 't-cancelled', name: 'Refund Arena', status: 'CANCELLED', prizePool: '0' }]), { status: 200 }));
    const adapter = new HttpArenaReadAdapter('/', fetcher as typeof fetch);
    expect((await adapter.listTournaments())[0].status).toBe('CANCELLED');
  });

  it('preserves the registration deadline and confirmed entrant count', async () => {
    const bracketSeed = { schema: 'arena-bracket-seed-v2', seedDigest: `sha256:${'a'.repeat(64)}`, rosterDigest: `sha256:${'b'.repeat(64)}`, entropyBlockHash: `0x${'c'.repeat(64)}`, entropyBlockNumber: '123' };
    const fetcher = vi.fn(async () => new Response(JSON.stringify([{ id: 'daily', name: 'Daily', status: 'UPCOMING', prizePool: '1', registrationClosesAt: 1789603200, entrantIds: ['sha256:entrant'], bracketSeed }]), { status: 200 }));
    const adapter = new HttpArenaReadAdapter('/', fetcher as typeof fetch);
    expect((await adapter.listTournaments())[0]).toMatchObject({ registrationClosesAt: 1789603200, entrantCount: 1, bracketSeed });
  });

  it('rejects a malformed public pairing proof', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify([{ id: 'daily', name: 'Daily', status: 'ACTIVE', prizePool: '8', bracketSeed: { schema: 'arena-bracket-seed-v2', seedDigest: 'bad' } }]), { status: 200 }));
    await expect(new HttpArenaReadAdapter('/', fetcher as typeof fetch).listTournaments()).rejects.toThrow('INVALID_ARENA_RESPONSE');
  });

  it('accepts preliminary round zero from the canonical bracket', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify([{ id: 'm-pre', tournamentId: 't1', state: 'SCHEDULED', agentA: 'A', agentB: 'B', round: 0 }]), { status: 200 }));
    const adapter = new HttpArenaReadAdapter('/', fetcher as typeof fetch);
    expect((await adapter.getMatches('t1'))[0].round).toBe(0);
  });

  it('keeps verdict explorer links bound to the network that produced them', async () => {
    const hash = `0x${'cd'.repeat(32)}`;
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ id: 'v1', matchId: 'm1', winner: 'A', reasons: ['reason'], summary: 'A wins', transactionHash: hash, chainId: 61999 }), { status: 200 }));
    const adapter = new HttpArenaReadAdapter('/api', fetcher as typeof fetch, 'https://explorer-studio-dev.genlayer.com');

    expect((await adapter.getMatchVerdict('m1'))?.explorerUrl).toBe(`https://explorer-studio.genlayer.com/transactions/${hash}`);
  });
});
