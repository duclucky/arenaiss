import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { isIP } from 'node:net';

import { ArenaHttpApi } from './http.ts';
import { ArenaApiService } from './service.ts';
import { viemSignatureVerifier } from './viem-verifier.ts';
import { SqliteRuntimeStore, type RuntimePurgeResult } from '../../../packages/persistence/src/sqlite-runtime.ts';
import { circleManagedWalletFromSecrets } from './circle-managed-wallet.ts';
import { SmtpEmailLoginSender } from './smtp-email.ts';
import { ManagedIdentityService, type ManagedIdentityOptions } from './managed-identity.ts';
import { ViemMarketplaceChainPort } from './marketplace-arc.ts';
import { ViemAgentRegistryPort } from './agent-registry-arc.ts';
import { EvaluationExecutionService, EvaluationExecutionWorker } from './evaluation-execution.ts';
import { ViemEvoFeeSettlement } from './evo-fee-arc.ts';
import { OpenAICompatibleEvaluationProvider, providerConfigurationFromEnvironment } from '../../../packages/evaluation/src/provider.ts';
import { EvaluationRunTracker, PersistentEvaluationRunStore } from '../../../packages/evaluation/src/run-tracker.ts';
import { PersistentSoloCampaignStore, SoloEvaluationRunner } from '../../../packages/evaluation/src/solo-runner.ts';
import { createStudioNextAgentEvaluationPort } from '../../../packages/genlayer/src/evaluation-sdk-port.ts';
import type { TournamentOperationsPort } from './tournament-operations.ts';
import { tournamentOperationsFromEnvironment } from './tournament-operations-live.ts';
import { launchReferenceTournament, runReferenceTournamentTick } from './reference-tournament-launch.ts';
import { DailyTournamentWorker } from './daily-tournament.ts';
import { PairRoomCoordinator } from './pair-rooms.ts';
import { ArcPairChainPort } from './pair-arc.ts';
import { pairSettlementFromEnvironment } from './pair-settlement-live.ts';
import { ARC_TESTNET_RPC_URL } from './arc-rpc.ts';
import { OperationalHealthRegistry } from './operational-health.ts';

const MAX_BODY_BYTES = 64 * 1024;
const ARCHIVED_TOURNAMENT_IDENTIFIERS = [
  'sha256:4cd199d746966f2df0325d307267e23ffbf9bc0c3605ab372132e0478ff06fcd',
  '0x4cd199d746966f2df0325d307267e23ffbf9bc0c3605ab372132e0478ff06fcd',
  'sha256:3a326a6030c4cbfa6171c380805e6f7fb8bce366d237f4ada69cddaead722a61',
  '0x3a326a6030c4cbfa6171c380805e6f7fb8bce366d237f4ada69cddaead722a61',
] as const;

export function purgeArchivedTournamentLogs(runtime: SqliteRuntimeStore): RuntimePurgeResult {
  return runtime.purgeIdentifiers(ARCHIVED_TOURNAMENT_IDENTIFIERS);
}

type RequestLog = { event: 'http_request'; method: string; path: string; status: number; durationMs: number };
type PairWorker = { tick(): Promise<void> };
type PairWorkerHealth = { success(): void; failure(): void };

export function createPairWorkerTick(worker: PairWorker, health: PairWorkerHealth): () => Promise<void> {
  return async () => {
    try { await worker.tick(); health.success(); }
    catch (error) { health.failure(); throw error; }
  };
}

type ServerOptions = {
  now?: () => number;
  logger?: (entry: RequestLog) => void;
  rateLimit?: { maxRequests: number; windowMs: number; maxEntries?: number };
  trustProxy?: boolean;
  tournamentOperations?: TournamentOperationsPort;
  onTournamentOperationsReady?: (operations: TournamentOperationsPort | undefined) => void;
  healthRegistry?: OperationalHealthRegistry;
};

export function createArenaServer(operator: string, runtime?: SqliteRuntimeStore, options: ServerOptions = {}) {
  const now = options.now ?? Date.now;
  const health = options.healthRegistry ?? new OperationalHealthRegistry(now);
  const service = new ArenaApiService(operator, runtime);
  const managedIdentity = runtime ? managedIdentityFromEnvironment(runtime) : undefined;
  const managedIdentityService = runtime && managedIdentity ? new ManagedIdentityService(managedIdentity) : undefined;
  const evaluationExecution = runtime && managedIdentityService ? evaluationExecutionFromEnvironment(runtime, managedIdentityService, operator) : undefined;
  const evaluationIntervalMs = envPositiveInteger('EVALUATION_WORKER_INTERVAL_MS', 5_000);
  if (evaluationExecution) health.register('evaluation-worker', evaluationIntervalMs);
  const evaluationWorker = evaluationExecution ? new EvaluationExecutionWorker(evaluationExecution, evaluationIntervalMs, { success: () => health.success('evaluation-worker'), failure: () => health.failure('evaluation-worker') }) : undefined;
  const marketplaceChain = marketplaceChainFromEnvironment(process.env);
  const agentRegistry = agentRegistryFromEnvironment(process.env);
  const pairAddress = process.env.ARC_PAIR_ESCROW_ADDRESS?.trim();
  const pairsEnabled = process.env.ARENA_PAIR_ROOMS_ENABLED === '1';
  const pairChain = pairsEnabled && pairAddress ? new ArcPairChainPort({ escrowAddress: pairAddress, expectedOperator: operator, rpcUrl: process.env.ARC_TESTNET_RPC_URL?.trim() }) : undefined;
  const pairWorker = pairsEnabled && runtime && pairChain && managedIdentityService ? pairSettlementFromEnvironment(process.env, runtime, service, managedIdentityService, pairChain, operator) : undefined;
  const pairIntervalMs = 10_000;
  if (pairWorker) health.register('pair-worker', pairIntervalMs);
  const pairRooms = pairWorker && pairAddress && runtime && managedIdentityService && pairChain ? new PairRoomCoordinator(runtime, service, {
    account: async (userId) => managedIdentityService.pairAccount(userId),
    create: (userId, input) => managedIdentityService.pairCreate(userId, input),
    join: (userId, input) => managedIdentityService.pairJoin(userId, input),
    action: (userId, input) => managedIdentityService.pairAction(userId, input),
  }, pairChain) : undefined;
  let pairWorkerTimer: ReturnType<typeof setInterval> | undefined;
  const pairTick = pairWorker ? createPairWorkerTick(pairWorker, {
    success: () => health.success('pair-worker'),
    failure: () => health.failure('pair-worker'),
  }) : undefined;
  const tournamentOperations = options.tournamentOperations ?? (runtime ? tournamentOperationsFromEnvironment(process.env, runtime, service, operator) : undefined);
  const dailyStake = process.env.ARENA_DAILY_TOURNAMENT_STAKE_UNITS?.trim();
  if (dailyStake && (!runtime || !tournamentOperations)) throw new Error('daily Tournament requires persistent runtime and Tournament operations');
  const dailyIntervalMs = 30_000;
  if (dailyStake) health.register('daily-tournament-worker', dailyIntervalMs);
  const dailyWorker = dailyStake ? new DailyTournamentWorker(runtime!, tournamentOperations!, dailyStake, dailyIntervalMs, (result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.event === 'daily_tournament_failed') health.failure('daily-tournament-worker');
    else if (result.event === 'daily_tournament_tick') health.success('daily-tournament-worker');
  }) : undefined;
  options.onTournamentOperationsReady?.(tournamentOperations);
  const api = new ArenaHttpApi(service, viemSignatureVerifier, managedIdentity, marketplaceChain, evaluationExecution, managedIdentityService, tournamentOperations, agentRegistry, pairRooms, { tournamentsPaused: process.env.ARENA_TOURNAMENTS_PAUSED === '1', degraded: () => !health.readiness().ready });
  const logger = options.logger ?? ((entry: RequestLog) => process.stdout.write(`${JSON.stringify(entry)}\n`));
  const limiter = new FixedWindowRateLimiter(options.rateLimit ?? {
    maxRequests: envPositiveInteger('ARENA_RATE_LIMIT_MAX', 60),
    windowMs: envPositiveInteger('ARENA_RATE_LIMIT_WINDOW_MS', 60_000),
    maxEntries: 10_000,
  });
  const trustProxy = options.trustProxy ?? process.env.ARENA_TRUST_PROXY === '1';
  const server = createServer(async (request, response) => {
    const startedAt = now();
    const method = request.method || 'GET';
    let path = '/';
    let status = 500;
    try {
      path = decodePathname(new URL(request.url || '/', 'http://arena.local').pathname);
      if (method === 'GET' && path === '/livez') {
        status = 200;
        writeResponse(response, status, { 'content-type': 'application/json; charset=utf-8' }, { status: 'ok' });
        return;
      }
      if (method === 'GET' && (path === '/readyz' || path === '/healthz')) {
        const readiness = health.readiness();
        status = readiness.ready ? 200 : 503;
        writeResponse(response, status, { 'content-type': 'application/json; charset=utf-8' }, readiness.ready ? { status: 'ok' } : { status: 'degraded', components: readiness.components });
        return;
      }
      if (isMutation(method)) {
        const decision = limiter.take(clientIdentifier(request, trustProxy), now());
        if (!decision.allowed) {
          status = 429;
          writeResponse(response, status, {
            'content-type': 'application/json; charset=utf-8',
            'retry-after': String(decision.retryAfterSeconds),
          }, { error: 'rate limit exceeded' });
          return;
        }
      }
      const body = await readJsonBody(request);
      const result = await api.handle({
        method,
        path,
        headers: normalizeHeaders(request),
        body,
      });
      status = result.status;
      writeResponse(response, status, result.headers, result.body);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'bad request';
      status = message === 'request body too large' ? 413 : 400;
      writeResponse(response, status, { 'content-type': 'application/json; charset=utf-8' }, { error: message });
    } finally {
      logger({ event: 'http_request', method, path, status, durationMs: Math.max(0, now() - startedAt) });
    }
  });
  server.once('listening', () => { evaluationWorker?.start(); dailyWorker?.start(); if (pairTick) { void pairTick().catch(() => undefined); pairWorkerTimer = setInterval(() => void pairTick().catch(() => undefined), pairIntervalMs); } });
  server.once('close', () => { evaluationWorker?.stop(); dailyWorker?.stop(); if (pairWorkerTimer) clearInterval(pairWorkerTimer); });
  return server;
}

function evaluationExecutionFromEnvironment(runtime: SqliteRuntimeStore, fees: ManagedIdentityService, operator: string): EvaluationExecutionService | undefined {
  const privateKey = process.env.GENLAYER_OWNER_PRIVATE_KEY?.trim() || process.env.STUDIONET_PRIVATE_KEY?.trim();
  const judgeAddress = process.env.GENLAYER_EVALUATION_JUDGE_ADDRESS?.trim();
  const routing = providerConfigurationFromEnvironment(process.env);
  const feeUsdc = process.env.EVALUATION_FEE_USDC?.trim();
  const escrowAddress = process.env.ARC_EVO_FEE_ESCROW_ADDRESS?.trim();
  if (![privateKey, judgeAddress, feeUsdc, escrowAddress, routing].some(Boolean)) return undefined;
  if (!privateKey || !judgeAddress || !feeUsdc || !escrowAddress || !routing) return undefined;
  const provider = new OpenAICompatibleEvaluationProvider(routing.provider);
  const judge = createStudioNextAgentEvaluationPort(privateKey!);
  const runner = new SoloEvaluationRunner(provider, new EvaluationRunTracker(judge, new PersistentEvaluationRunStore(runtime), judgeAddress!), new PersistentSoloCampaignStore(runtime));
  const settlement = new ViemEvoFeeSettlement({ privateKey: privateKey!, escrowAddress: escrowAddress!, rpcUrl: process.env.ARC_TESTNET_RPC_URL?.trim() });
  return new EvaluationExecutionService({ runtime, fees, settlement, runner, operatorAddress: operator, escrowAddress: escrowAddress!, feeUsdc: feeUsdc!, model: routing.model, workerConcurrency: envBoundedInteger('EVALUATION_WORKER_CONCURRENCY', 8, 1, 30) });
}

export function managedIdentityFromEnvironment(runtime: SqliteRuntimeStore, environment: NodeJS.ProcessEnv = process.env): ManagedIdentityOptions | undefined {
  const names = ['CIRCLE_API_KEY', 'CIRCLE_ENTITY_SECRET', 'CIRCLE_WALLET_SET_ID', 'ARC_AGENT_REGISTRY_ADDRESS', 'ARENA_IDENTITY_PEPPER', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'] as const;
  const values = Object.fromEntries(names.map((name) => [name, environment[name]?.trim() || ''])) as Record<typeof names[number], string>;
  if (names.every((name) => !values[name])) return undefined;
  const missing = names.filter((name) => !values[name]);
  if (missing.length) throw new Error(`managed identity configuration is incomplete: ${missing.join(', ')}`);
  const smtpPort = Number(values.SMTP_PORT);
  return {
    runtime,
    identityPepper: values.ARENA_IDENTITY_PEPPER,
    agentRegistryAddress: values.ARC_AGENT_REGISTRY_ADDRESS,
    marketplaceAddress: environment.ARC_MARKETPLACE_ADDRESS?.trim(),
    evaluationEscrowAddress: environment.ARC_EVO_FEE_ESCROW_ADDRESS?.trim(),
    tournamentEscrowAddress: environment.ARC_TOURNAMENT_ESCROW_ADDRESS?.trim(),
    pairEscrowAddress: environment.ARC_PAIR_ESCROW_ADDRESS?.trim(),
    circleWallets: circleManagedWalletFromSecrets({ apiKey: values.CIRCLE_API_KEY, entitySecret: values.CIRCLE_ENTITY_SECRET, walletSetId: values.CIRCLE_WALLET_SET_ID }),
    emailSender: new SmtpEmailLoginSender({ host: values.SMTP_HOST, port: smtpPort, secure: smtpPort === 465, user: values.SMTP_USER, pass: values.SMTP_PASS, from: values.SMTP_FROM }),
  };
}

function agentRegistryFromEnvironment(environment: NodeJS.ProcessEnv): ViemAgentRegistryPort | undefined {
  const address = environment.ARC_AGENT_REGISTRY_ADDRESS?.trim();
  if (!address) return undefined;
  return new ViemAgentRegistryPort({ rpcUrl: environment.ARC_TESTNET_RPC_URL?.trim() || ARC_TESTNET_RPC_URL, address });
}

function marketplaceChainFromEnvironment(environment: NodeJS.ProcessEnv): ViemMarketplaceChainPort | undefined {
  const rpcUrl = environment.ARC_TESTNET_RPC_URL?.trim() || ARC_TESTNET_RPC_URL;
  const registry = environment.ARC_AGENT_REGISTRY_V2_ADDRESS?.trim();
  const marketplace = environment.ARC_MARKETPLACE_ADDRESS?.trim();
  if (!registry && !marketplace) return undefined;
  if (!registry || !marketplace) throw new Error('marketplace configuration is incomplete');
  const privateKey = environment.GENLAYER_OWNER_PRIVATE_KEY?.trim() || environment.STUDIONET_PRIVATE_KEY?.trim();
  return new ViemMarketplaceChainPort({ rpcUrl, registryAddress: registry, marketplaceAddress: marketplace, privateKey });
}

class FixedWindowRateLimiter {
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly maxEntries: number;
  private readonly windows = new Map<string, { startedAt: number; count: number }>();

  constructor(config: { maxRequests: number; windowMs: number; maxEntries?: number }) {
    if (!Number.isSafeInteger(config.maxRequests) || config.maxRequests < 1
      || !Number.isSafeInteger(config.windowMs) || config.windowMs < 1) throw new TypeError('rate limit configuration is invalid');
    this.maxRequests = config.maxRequests;
    this.windowMs = config.windowMs;
    this.maxEntries = config.maxEntries ?? 10_000;
    if (!Number.isSafeInteger(this.maxEntries) || this.maxEntries < 1) throw new TypeError('rate limit max entries is invalid');
  }

  take(identifier: string, now: number): { allowed: boolean; retryAfterSeconds: number } {
    for (const [key, window] of this.windows) if (now - window.startedAt >= this.windowMs) this.windows.delete(key);
    const current = this.windows.get(identifier);
    if (!current || now - current.startedAt >= this.windowMs) {
      if (!current && this.windows.size >= this.maxEntries) return { allowed: false, retryAfterSeconds: 1 };
      this.windows.set(identifier, { startedAt: now, count: 1 });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (current.count < this.maxRequests) {
      current.count += 1;
      return { allowed: true, retryAfterSeconds: 0 };
    }
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((current.startedAt + this.windowMs - now) / 1_000)) };
  }
}

function isMutation(method: string): boolean {
  return !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
}

function clientIdentifier(request: IncomingMessage, trustProxy: boolean): string {
  const trusted = request.headers['x-arena-client-ip'];
  if (trustProxy && typeof trusted === 'string' && isIP(trusted.trim())) return trusted.trim();
  return request.socket.remoteAddress || 'unknown';
}

function envPositiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} is invalid`);
  return value;
}

function envBoundedInteger(name: string, fallback: number, minimum: number, maximum: number): number {
  const value = envPositiveInteger(name, fallback);
  if (value < minimum || value > maximum) throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  return value;
}

function decodePathname(pathname: string): string {
  // Router patterns operate on canonical IDs (for example `sha256:...`),
  // while URL clients correctly percent-encode the colon. Decode only the
  // pathname once at the HTTP boundary; malformed escapes remain a 400.
  return decodeURIComponent(pathname);
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  if (request.method === 'GET' || request.method === 'HEAD') return undefined;
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_BODY_BYTES) throw new Error('request body too large');
    chunks.push(bytes);
  }
  if (size === 0) return {};
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid JSON body');
  return value;
}

function normalizeHeaders(request: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(request.headers)) if (typeof value === 'string') headers[key] = value;
  return headers;
}

function writeResponse(response: ServerResponse, status: number, headers: Record<string, string>, body: unknown) {
  response.writeHead(status, { ...headers, 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' });
  response.end(body === undefined ? undefined : JSON.stringify(body));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const operator = process.env.ARENA_OPERATOR_ADDRESS;
  if (!operator) throw new Error('ARENA_OPERATOR_ADDRESS is required');
  const databasePath = process.env.ARENA_DATABASE_PATH;
  if (!databasePath) throw new Error('ARENA_DATABASE_PATH is required');
  const port = Number(process.env.PORT || '8787');
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('PORT is invalid');
  const host = process.env.HOST || '127.0.0.1';
  const resolvedDatabasePath = resolve(databasePath);
  mkdirSync(dirname(resolvedDatabasePath), { recursive: true });
  const runtime = new SqliteRuntimeStore(resolvedDatabasePath);
  const purged = purgeArchivedTournamentLogs(runtime);
  if (purged.records || purged.counters || purged.leases) {
    process.stdout.write(`${JSON.stringify({ event: 'archived_tournament_logs_purged', ...purged })}\n`);
  }
  let tournamentOperations: TournamentOperationsPort | undefined;
  const server = createArenaServer(operator, runtime, { onTournamentOperationsReady: (operations) => { tournamentOperations = operations; } });
  let referenceWorkerTimer: NodeJS.Timeout | undefined;
  let referenceWorkerStopped = false;
  server.once('close', () => { referenceWorkerStopped = true; if (referenceWorkerTimer) clearTimeout(referenceWorkerTimer); runtime.close(); });
  const shutdown = () => server.close();
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  server.listen(port, host, () => {
    process.stdout.write(`${JSON.stringify({ event: 'server_listening', host, port, fallbackConfigured: Boolean(providerConfigurationFromEnvironment(process.env)) })}\n`);
    if (process.env.ARENA_ONE_SHOT_TOURNAMENT === 'reference-8x1-30m-v1') {
      if (!tournamentOperations) process.stderr.write(`${JSON.stringify({ event: 'reference_tournament_launch_failed', error: 'Tournament operations unavailable' })}\n`);
      else void launchReferenceTournament(runtime, tournamentOperations, Math.floor(Date.now() / 1_000))
        .then(({ input, snapshot }) => {
          process.stdout.write(`${JSON.stringify({ event: 'reference_tournament_launch_confirmed', tournamentId: input.tournamentId, registrationClosesAt: input.registrationClosesAt, startsAt: input.startsAt, stakeAmount: input.stakeAmount, minEntrants: input.minEntrants, maxEntrants: input.maxEntrants, transactionHash: snapshot.arc?.transactionHash ?? null })}\n`);
          const tick = async () => {
            if (referenceWorkerStopped) return;
            try {
              const result = await runReferenceTournamentTick(tournamentOperations!, input, Math.floor(Date.now() / 1_000));
              if (result.action) process.stdout.write(`${JSON.stringify({ event: 'reference_tournament_progressed', tournamentId: input.tournamentId, action: result.action, state: result.snapshot?.state })}\n`);
              if (result.snapshot && ['COMPLETED', 'REFUNDED', 'RECOVERY_REQUIRED'].includes(result.snapshot.state)) {
                if (result.snapshot.state === 'RECOVERY_REQUIRED') process.stderr.write(`${JSON.stringify({ event: 'reference_tournament_attention_required', tournamentId: input.tournamentId, state: result.snapshot.state })}\n`);
                return;
              }
            } catch (error) {
              process.stderr.write(`${JSON.stringify({ event: 'reference_tournament_progress_failed', tournamentId: input.tournamentId, error: error instanceof Error ? error.message : 'unknown error' })}\n`);
            }
            if (!referenceWorkerStopped) referenceWorkerTimer = setTimeout(tick, 30_000);
          };
          if (!referenceWorkerStopped) referenceWorkerTimer = setTimeout(tick, Math.max(1_000, Math.min(30_000, (input.startsAt - Math.floor(Date.now() / 1_000)) * 1_000)));
        })
        .catch((error) => process.stderr.write(`${JSON.stringify({ event: 'reference_tournament_launch_failed', error: error instanceof Error ? error.message : 'unknown error' })}\n`));
    }
  });
}
