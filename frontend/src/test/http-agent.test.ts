import { describe, expect, it, vi } from 'vitest';

import { HttpAgentAdapter } from '../adapters/agent-api';

describe('agent HTTP adapter', () => {
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
});
