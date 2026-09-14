import { randomBytes } from 'node:crypto';

import type { ArenaApiService } from './service.ts';

type Headers = Record<string, string>;
export type ApiRequest = { method: string; path: string; headers?: Headers; body?: Record<string, unknown> };
export type ApiResponse = { status: number; headers: Headers; body?: any };
export type SignatureVerifier = (input: { address: string; message: string; signature: string }) => Promise<boolean>;

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const CHALLENGE_TTL_MS = 15 * 60_000;
const SESSION_TTL_MS = 12 * 60 * 60_000;

export class ArenaHttpApi {
  private service: ArenaApiService;
  private verifySignature: SignatureVerifier;
  private challenges = new Map<string, { message: string; expiresAt: number }>();
  private sessions = new Map<string, { address: string; expiresAt: number }>();

  constructor(service: ArenaApiService, verifySignature: SignatureVerifier) {
    this.service = service;
    this.verifySignature = verifySignature;
  }

  async handle(request: ApiRequest): Promise<ApiResponse> {
    try {
      if (request.method === 'POST' && request.path === '/api/auth/challenge') return this.challenge(request.body);
      if (request.method === 'POST' && request.path === '/api/auth/verify') return await this.verify(request.body);
      if (request.method === 'GET' && request.path === '/api/tournaments') return this.json(200, this.service.listTournaments());
      const tournamentMatch = request.path.match(/^\/api\/tournaments\/(sha256:[0-9a-fA-F]{64})$/);
      if (request.method === 'GET' && tournamentMatch) {
        const tournament = this.service.getTournament(tournamentMatch[1]);
        return tournament ? this.json(200, tournament) : this.json(404, { error: 'not found' });
      }
      const tournamentMatches = request.path.match(/^\/api\/tournaments\/(sha256:[0-9a-fA-F]{64})\/matches$/);
      if (request.method === 'GET' && tournamentMatches) return this.json(200, this.service.listMatches(tournamentMatches[1]));
      const publicMatch = request.path.match(/^\/api\/matches\/(sha256:[0-9a-fA-F]{64})$/);
      if (request.method === 'GET' && publicMatch) {
        const match = this.service.getMatch(publicMatch[1]);
        return match ? this.json(200, match) : this.json(404, { error: 'not found' });
      }
      const publicVerdict = request.path.match(/^\/api\/matches\/(sha256:[0-9a-fA-F]{64})\/verdict$/);
      if (request.method === 'GET' && publicVerdict) {
        const verdict = this.service.getVerdict(publicVerdict[1]);
        return verdict ? this.json(200, verdict) : this.json(404, { error: 'not found' });
      }
      if (request.method === 'GET' && request.path === '/api/evaluation-runs') {
        const owner = this.requireSession(request.headers);
        return this.json(200, this.service.listOwnedEvaluationRuns(owner));
      }
      if (request.method === 'POST' && request.path === '/api/evaluation-packs') {
        const owner = this.requireSession(request.headers);
        const body = request.body || {};
        return this.json(201, this.service.createEvaluationPack(owner, {
          packId: requireString(body.packId) as `sha256:${string}`,
          version: requireString(body.version),
          name: requireString(body.name),
          scenarios: body.scenarios as any,
        }));
      }
      if (request.method === 'POST' && request.path === '/api/evaluation-campaigns') {
        const owner = this.requireSession(request.headers);
        const body = request.body || {};
        return this.json(201, this.service.createSoloCampaign(owner, {
          campaignId: requireString(body.campaignId) as `sha256:${string}`,
          agentId: requireString(body.agentId) as `sha256:${string}`,
          agentsVersion: requireString(body.agentsVersion) as `sha256:${string}`,
          packId: requireString(body.packId) as `sha256:${string}`,
          packVersion: requireString(body.packVersion),
          runtimePolicy: body.runtimePolicy as any,
        }));
      }
      if (request.method === 'GET' && request.path === '/api/evaluation-campaigns') {
        const owner = this.requireSession(request.headers);
        return this.json(200, this.service.listOwnedEvaluationCampaigns(owner));
      }
      const publicCampaign = request.path.match(/^\/api\/evaluation-campaigns\/(sha256:[0-9a-fA-F]{64})$/);
      if (request.method === 'GET' && publicCampaign) {
        const campaign = this.service.getPublicEvaluationCampaign(publicCampaign[1] as `sha256:${string}`);
        return campaign ? this.json(200, campaign) : this.json(404, { error: 'not found' });
      }
      const privateEvaluationRun = request.path.match(/^\/api\/evaluation-runs\/(sha256:[0-9a-fA-F]{64})\/private$/);
      if (request.method === 'GET' && privateEvaluationRun) {
        const owner = this.requireSession(request.headers);
        return this.json(200, this.service.getPrivateEvaluationRun(owner, privateEvaluationRun[1] as `sha256:${string}`));
      }
      const publicEvaluationRun = request.path.match(/^\/api\/evaluation-runs\/(sha256:[0-9a-fA-F]{64})$/);
      if (request.method === 'GET' && publicEvaluationRun) {
        const run = this.service.getPublicEvaluationRun(publicEvaluationRun[1] as `sha256:${string}`);
        return run ? this.json(200, run) : this.json(404, { error: 'not found' });
      }
      if (request.method === 'GET' && request.path === '/api/agents') {
        const owner = this.requireSession(request.headers);
        return this.json(200, this.service.listOwnedAgents(owner));
      }
      if (request.method === 'POST' && request.path === '/api/agents') {
        const owner = this.requireSession(request.headers);
        const body = request.body || {};
        const created = this.service.createAgent(owner, requireString(body.name), requireString(body.agentsMd));
        return this.json(201, created);
      }
      const registrationMatch = request.path.match(/^\/api\/tournaments\/(sha256:[0-9a-fA-F]{64})\/registrations$/);
      if (request.method === 'POST' && registrationMatch) {
        const owner = this.requireSession(request.headers);
        const agentId = requireString(request.body?.agentId);
        return this.json(200, this.service.prepareRegistration(owner, registrationMatch[1] as `sha256:${string}`, agentId as `sha256:${string}`));
      }
      return this.json(404, { error: 'not found' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'request failed';
      const status = message === 'unauthorized' ? 401 : 400;
      return this.json(status, { error: message });
    }
  }

  private challenge(body: Record<string, unknown> | undefined): ApiResponse {
    const address = requireAddress(body?.address);
    const nonce = randomBytes(24).toString('hex');
    const message = `Arena ISS sign-in\nAddress: ${address}\nNonce: ${nonce}`;
    this.challenges.set(address, { message, expiresAt: Date.now() + CHALLENGE_TTL_MS });
    return this.json(200, { address, message, expiresAt: Date.now() + CHALLENGE_TTL_MS });
  }

  private async verify(body: Record<string, unknown> | undefined): Promise<ApiResponse> {
    const address = requireAddress(body?.address);
    const signature = requireString(body?.signature);
    const challenge = this.challenges.get(address);
    this.challenges.delete(address);
    if (!challenge || challenge.expiresAt <= Date.now()) throw new Error('unauthorized');
    if (!await this.verifySignature({ address, message: challenge.message, signature })) throw new Error('unauthorized');
    const token = randomBytes(32).toString('base64url');
    this.sessions.set(token, { address, expiresAt: Date.now() + SESSION_TTL_MS });
    return {
      status: 204,
      headers: { 'set-cookie': `arena_session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}` },
    };
  }

  private requireSession(headers: Headers | undefined): string {
    const cookie = headers?.cookie || '';
    const token = cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith('arena_session='))?.slice(14);
    if (!token) throw new Error('unauthorized');
    const session = this.sessions.get(token);
    if (!session || session.expiresAt <= Date.now()) {
      this.sessions.delete(token);
      throw new Error('unauthorized');
    }
    return session.address;
  }

  private json(status: number, body: any): ApiResponse {
    return { status, headers: { 'content-type': 'application/json; charset=utf-8' }, body };
  }
}

function requireAddress(value: unknown): string {
  if (typeof value !== 'string' || !ADDRESS.test(value)) throw new Error('invalid address');
  return value.toLowerCase();
}

function requireString(value: unknown): string {
  if (typeof value !== 'string') throw new Error('invalid request');
  return value;
}
