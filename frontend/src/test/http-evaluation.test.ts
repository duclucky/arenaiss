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

  it('sends immutable comparison cohorts and policy through authenticated comparison routes', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const record = { schema: 'arena-version-comparison-v1', comparisonId: 'sha256:comparison', inputDigest: 'sha256:input', status: 'PASS', agentId: 'sha256:agent', baselineVersionId: 'sha256:baseline', candidateVersionId: 'sha256:candidate', coverageBps: 10000, findings: [] };
    const fetcher = (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return Promise.resolve(new Response(JSON.stringify(calls.length === 1 ? record : [record]), { status: 200 }));
    };
    let authenticated = 0;
    const adapter = new HttpEvaluationAdapter('https://arena.example', async () => { authenticated += 1; }, fetcher as typeof fetch);
    const input = { comparisonId: record.comparisonId, agentId: record.agentId, baselineVersionId: record.baselineVersionId, candidateVersionId: record.candidateVersionId, baselineCampaignIds: ['sha256:b'], candidateCampaignIds: ['sha256:c'], policy: { schema: 'arena-regression-policy-v1' as const, requiredRunsPerScenario: 1, minimumScenarioCoverageBps: 10000, maximumOverallDrop: 5, maximumDimensionDrop: 10, maximumOverallSpread: 10, maximumDimensionSpread: 10, minimumDimensionScores: {}, criticalFindingCodes: [] } };
    await expect(adapter.createVersionComparison(input)).resolves.toEqual(record);
    await expect(adapter.listComparisons()).resolves.toEqual([record]);
    expect(authenticated).toBe(2);
    expect(calls[0].url).toBe('https://arena.example/api/evaluation-comparisons');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual(input);
    expect(calls[1].url).toBe('https://arena.example/api/evaluation-comparisons');
  });
});
