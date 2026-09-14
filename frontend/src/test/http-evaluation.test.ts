import { describe, expect, it } from 'vitest';

import { HttpEvaluationAdapter } from '../adapters/evaluation-api';

describe('evaluation HTTP adapter', () => {
  it('invokes the browser fetch function with its global receiver', async () => {
    const fetcher = function (this: unknown) {
      if (this !== globalThis) throw new TypeError('Illegal invocation');
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
    };
    const adapter = new HttpEvaluationAdapter('https://arena.example', async () => undefined, fetcher as typeof fetch);

    await expect(adapter.listCampaigns()).resolves.toEqual([]);
  });
});
