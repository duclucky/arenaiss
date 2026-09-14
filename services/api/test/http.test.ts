import assert from 'node:assert/strict';
import test from 'node:test';

import { ArenaApiService } from '../src/service.ts';
import { ArenaHttpApi } from '../src/http.ts';
import { viemSignatureVerifier } from '../src/viem-verifier.ts';
import { privateKeyToAccount } from 'viem/accounts';

const alice = '0x1111111111111111111111111111111111111111';
const bob = '0x2222222222222222222222222222222222222222';
const operator = '0x9999999999999999999999999999999999999999';

test('wallet challenge creates an httpOnly session and agent routes never trust a caller field', async () => {
  const verified: string[] = [];
  const api = new ArenaHttpApi(new ArenaApiService(operator), async ({ address, message, signature }) => {
    verified.push(`${address}|${message}|${signature}`);
    return signature === `signed:${address}`;
  });
  const challenge = await api.handle({ method: 'POST', path: '/api/auth/challenge', body: { address: alice } });
  assert.equal(challenge.status, 200);
  const auth = await api.handle({ method: 'POST', path: '/api/auth/verify', body: { address: alice, signature: `signed:${alice}` } });
  assert.equal(auth.status, 204);
  assert.match(auth.headers['set-cookie'], /HttpOnly/);
  const cookie = auth.headers['set-cookie'].split(';')[0];

  const created = await api.handle({
    method: 'POST', path: '/api/agents', headers: { cookie },
    body: { caller: bob, name: 'Alice Agent', agentsMd: 'Return concise evidence.' },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.owner, alice);
  assert.equal('agentsMd' in created.body, false);
  assert.equal(verified.length, 1);
});

test('private agent listing requires the owner session and never returns AGENTS.md plaintext', async () => {
  const api = new ArenaHttpApi(new ArenaApiService(operator), async ({ address }) => address === alice);
  await api.handle({ method: 'POST', path: '/api/auth/challenge', body: { address: alice } });
  const auth = await api.handle({ method: 'POST', path: '/olders', body: {} });
  assert.equal(auth.status, 404);
  const verified = await api.handle({ method: 'POST', path: '/api/auth/verify', body: { address: alice, signature: 'ok' } });
  const cookie = verified.headers['set-cookie'].split(';')[0];
  await api.handle({ method: 'POST', path: '/api/agents', headers: { cookie }, body: { name: 'A', agentsMd: 'secret strategy' } });

  const anonymous = await api.handle({ method: 'GET', path: '/api/agents' });
  assert.equal(anonymous.status, 401);
  const own = await api.handle({ method: 'GET', path: '/api/agents', headers: { cookie } });
  assert.equal(own.status, 200);
  assert.equal(own.body.length, 1);
  assert.equal(JSON.stringify(own.body).includes('secret strategy'), false);
});

test('challenge is single-use and a failed signature cannot create a session', async () => {
  const api = new ArenaHttpApi(new ArenaApiService(operator), async () => false);
  await api.handle({ method: 'POST', path: '/api/auth/challenge', body: { address: alice } });
  const failed = await api.handle({ method: 'POST', path: '/api/auth/verify', body: { address: alice, signature: 'bad' } });
  assert.equal(failed.status, 401);
  const replay = await api.handle({ method: 'POST', path: '/api/auth/verify', body: { address: alice, signature: 'bad' } });
  assert.equal(replay.status, 401);
});

test('production verifier accepts only the address that signed the exact challenge', async () => {
  const account = privateKeyToAccount(`0x${'01'.repeat(32)}`);
  const message = 'Arena ISS exact challenge';
  const signature = await account.signMessage({ message });
  assert.equal(await viemSignatureVerifier({ address: account.address, message, signature }), true);
  assert.equal(await viemSignatureVerifier({ address: bob, message, signature }), false);
  assert.equal(await viemSignatureVerifier({ address: account.address, message: `${message}!`, signature }), false);
});

test('authenticated owner can prepare an exact Arc registration payload', async () => {
  const service = new ArenaApiService(operator);
  const tournamentId = `sha256:${'a'.repeat(64)}`;
  service.publishTournament(operator, { id: tournamentId, name: 'Registration Arena', status: 'UPCOMING', entrantIds: [], stakeAmount: '100000', prizePool: '0' });
  const api = new ArenaHttpApi(service, async () => true);
  await api.handle({ method: 'POST', path: '/api/auth/challenge', body: { address: alice } });
  const auth = await api.handle({ method: 'POST', path: '/api/auth/verify', body: { address: alice, signature: 'ok' } });
  const cookie = auth.headers['set-cookie'].split(';')[0];
  const created = await api.handle({ method: 'POST', path: '/api/agents', headers: { cookie }, body: { name: 'A', agentsMd: 'v1' } });
  const prepared = await api.handle({ method: 'POST', path: `/api/tournaments/${tournamentId}/registrations`, headers: { cookie }, body: { agentId: created.body.agentId } });
  assert.equal(prepared.status, 200);
  assert.match(prepared.body.entrantId, /^0x[0-9a-f]{64}$/);
  assert.equal(prepared.body.stakeAmount, '100000');

  const owned = await api.handle({ method: 'GET', path: '/api/registrations', headers: { cookie } });
  assert.equal(owned.status, 200);
  assert.deepEqual(owned.body, [{ tournamentId: prepared.body.tournamentId, entrantId: prepared.body.entrantId }]);
  assert.equal((await api.handle({ method: 'GET', path: '/api/registrations' })).status, 401);
});

test('public read routes expose normalized tournament, match and verdict data anonymously', async () => {
  const service = new ArenaApiService(operator);
  const tournamentId = `sha256:${'c'.repeat(64)}`;
  const matchId = `sha256:${'d'.repeat(64)}`;
  service.publishTournament(operator, { id: tournamentId, name: 'Arena One', status: 'ACTIVE', entrantIds: [], stakeAmount: '100000', prizePool: '800000' });
  service.publishMatch(operator, { id: matchId, tournamentId, state: 'FINALIZED', agentA: 'Agent A', agentB: 'Agent B', winner: 'Agent A', round: 1 });
  service.publishVerdict(operator, { id: `sha256:${'e'.repeat(64)}`, matchId, winner: 'A', reasons: ['r1', 'r2', 'r3', 'r4', 'r5'], summary: 'Agent A wins.', transactionHash: `0x${'ab'.repeat(32)}` });
  const api = new ArenaHttpApi(service, async () => false);

  assert.equal((await api.handle({ method: 'GET', path: '/api/tournaments' })).body[0].name, 'Arena One');
  assert.equal((await api.handle({ method: 'GET', path: `/api/tournaments/${tournamentId}` })).body.id, tournamentId);
  assert.equal((await api.handle({ method: 'GET', path: `/api/tournaments/${tournamentId}/matches` })).body[0].id, matchId);
  assert.equal((await api.handle({ method: 'GET', path: `/api/matches/${matchId}` })).body.state, 'FINALIZED');
  const verdict = await api.handle({ method: 'GET', path: `/api/matches/${matchId}/verdict` });
  assert.equal(verdict.status, 200);
  assert.equal(verdict.body.winner, 'A');
  assert.equal(JSON.stringify(verdict.body).includes('agentsMd'), false);
});

test('evaluation Run Detail routes separate anonymous redacted state from owner detail', async () => {
  const runtime = new (await import('../../../packages/persistence/src/sqlite-runtime.ts')).SqliteRuntimeStore(':memory:');
  try {
    const service = new ArenaApiService(operator, runtime);
    const api = new ArenaHttpApi(service, async () => true);
    await api.handle({ method: 'POST', path: '/api/auth/challenge', body: { address: alice } });
    const auth = await api.handle({ method: 'POST', path: '/api/auth/verify', body: { address: alice, signature: 'ok' } });
    const cookie = auth.headers['set-cookie'].split(';')[0];
    const agent = await api.handle({ method: 'POST', path: '/api/agents', headers: { cookie }, body: { name: 'Solo', agentsMd: 'private profile' } });
    const runId = `sha256:${'f'.repeat(64)}`;
    runtime.put('evaluation-runs', runId, {
      schema: 'arena-evaluation-run-v1', runId, rubricVersion: 'AgentEvaluationV5', scenarioJson: '{}', scenarioDigest: `sha256:${'1'.repeat(64)}`,
      input: { mode: 'RESPONSE', agent: { version_id: agent.body.agentsVersion, content: 'private profile' }, scenario: { scenario_id: 'solo_01', version: '1.0.0', context: 'hidden context' } },
      provider: { state: 'PENDING', operationKey: 'private-key' }, judge: { state: 'NOT_SUBMITTED' },
    });
    const publicResult = await api.handle({ method: 'GET', path: `/api/evaluation-runs/${runId}` });
    assert.equal(publicResult.status, 200);
    assert.equal(JSON.stringify(publicResult.body).includes('private profile'), false);
    assert.equal((await api.handle({ method: 'GET', path: `/api/evaluation-runs/${runId}/private` })).status, 401);
    const privateResult = await api.handle({ method: 'GET', path: `/api/evaluation-runs/${runId}/private`, headers: { cookie } });
    assert.equal(privateResult.status, 200);
    assert.equal(privateResult.body.runId, runId);
    assert.equal((await api.handle({ method: 'GET', path: '/api/evaluation-runs', headers: { cookie } })).body.length, 1);
  } finally {
    runtime.close();
  }
});

test('authenticated API creates immutable Test Pack and SOLO campaign, public status is redacted', async () => {
  const runtime = new (await import('../../../packages/persistence/src/sqlite-runtime.ts')).SqliteRuntimeStore(':memory:');
  try {
    const service = new ArenaApiService(operator, runtime);
    const api = new ArenaHttpApi(service, async () => true);
    await api.handle({ method: 'POST', path: '/api/auth/challenge', body: { address: alice } });
    const auth = await api.handle({ method: 'POST', path: '/api/auth/verify', body: { address: alice, signature: 'ok' } });
    const cookie = auth.headers['set-cookie'].split(';')[0];
    const agent = await api.handle({ method: 'POST', path: '/api/agents', headers: { cookie }, body: { name: 'Pack Agent', agentsMd: 'private pack profile' } });
    const pack = await api.handle({ method: 'POST', path: '/api/evaluation-packs', headers: { cookie }, body: { packId: `sha256:${'1'.repeat(64)}`, version: '1.0.0', name: 'Pack', scenarios: [{ schema: 'arena-test-scenario-v1', scenarioId: 'case_01', version: '1.0.0', level: 'RESPONSE', objective: 'Answer.', context: 'private context', constraints: [], availableActions: [], forbiddenActionIds: [], confirmationRequiredActionIds: [], maxProposedActions: 0 }] } });
    assert.equal(pack.status, 201);
    const campaign = await api.handle({ method: 'POST', path: '/api/evaluation-campaigns', headers: { cookie }, body: { campaignId: `sha256:${'2'.repeat(64)}`, agentId: agent.body.agentId, agentsVersion: agent.body.agentsVersion, packId: pack.body.packId, packVersion: '1.0.0', runtimePolicy: { model: 'fixture', maxOutputTokens: 500, temperature: 0, maxProviderAttempts: 2 } } });
    assert.equal(campaign.status, 201);
    const publicStatus = await api.handle({ method: 'GET', path: `/api/evaluation-campaigns/${campaign.body.campaignId}` });
    assert.equal(publicStatus.status, 200);
    assert.equal(JSON.stringify(publicStatus.body).includes('private pack profile'), false);
    assert.equal(JSON.stringify(publicStatus.body).includes('private context'), false);
    assert.equal((await api.handle({ method: 'GET', path: '/api/evaluation-campaigns', headers: { cookie } })).body.length, 1);
  } finally {
    runtime.close();
  }
});
