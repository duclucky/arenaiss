import { describe, expect, it, vi } from 'vitest';

import { HttpAgentAdapter } from '../adapters/agent-api';

describe('agent HTTP adapter', () => {
  it('invokes the browser fetch function with its global receiver', async () => {
    let calls = 0;
    const fetcher = function (this: unknown) {
      if (this !== globalThis) throw new TypeError('Illegal invocation');
      calls += 1;
      if (calls === 1) return Promise.resolve(new Response(JSON.stringify({ message: 'Arena challenge' }), { status: 200 }));
      if (calls === 2) return Promise.resolve(new Response(null, { status: 204 }));
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
    };
    const adapter = new HttpAgentAdapter('https://arena.example', () => '0x1111111111111111111111111111111111111111', async () => '0xsigned', fetcher as typeof fetch);
    await expect(adapter.listOwnedAgents()).resolves.toEqual([]);
    await expect(adapter.listOwnedRegistrations()).resolves.toEqual([]);
  });

  it('authenticates by wallet challenge and sends no caller identity in agent body', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'Arena challenge' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ agentId: 'sha256:1', name: 'A', agentsVersion: 'sha256:2', agentsCommitment: 'sha256:3' }), { status: 201 }));
    const signed: string[] = [];
    const adapter = new HttpAgentAdapter('https://arena.example', () => '0x1111111111111111111111111111111111111111', async (message) => {
      signed.push(message); return '0xsigned';
    }, fetcher);

    const created = await adapter.createAgent('A', 'Private strategy');
    expect(created.name).toBe('A');
    expect(signed).toEqual(['Arena challenge']);
    const createBody = JSON.parse(fetcher.mock.calls[2][1].body);
    expect(createBody).toEqual({ name: 'A', agentsMd: 'Private strategy' });
    expect(fetcher.mock.calls.every((call) => call[1].credentials === 'include')).toBe(true);
  });

  it('loads private detail and deactivates with only the exact Agent name', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ agentId: 'sha256:a', agentsMd: 'private', tournaments: [], evaluations: [], stats: {} }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ agentId: 'sha256:a', name: 'A', active: false }), { status: 202 }));
    const adapter = new HttpAgentAdapter('https://arena.example', () => null, async () => 'unused', fetcher, true);
    await adapter.getAgent('sha256:a');
    await adapter.deactivateAgent('sha256:a', 'A');
    expect(fetcher.mock.calls[0][0]).toBe('https://arena.example/api/agents/sha256%3Aa');
    expect(fetcher.mock.calls[1][1].method).toBe('DELETE');
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ name: 'A' });
  });
});
