import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { ArenaHttpApi } from './http.ts';
import { ArenaApiService } from './service.ts';
import { viemSignatureVerifier } from './viem-verifier.ts';
import { SqliteRuntimeStore } from '../../../packages/persistence/src/sqlite-runtime.ts';

const MAX_BODY_BYTES = 64 * 1024;

type RequestLog = { event: 'http_request'; method: string; path: string; status: number; durationMs: number };
type ServerOptions = {
  now?: () => number;
  logger?: (entry: RequestLog) => void;
  rateLimit?: { maxRequests: number; windowMs: number };
};

export function createArenaServer(operator: string, runtime?: SqliteRuntimeStore, options: ServerOptions = {}) {
  const api = new ArenaHttpApi(new ArenaApiService(operator, runtime), viemSignatureVerifier);
  const now = options.now ?? Date.now;
  const logger = options.logger ?? ((entry: RequestLog) => process.stdout.write(`${JSON.stringify(entry)}\n`));
  const limiter = new FixedWindowRateLimiter(options.rateLimit ?? {
    maxRequests: envPositiveInteger('ARENA_RATE_LIMIT_MAX', 60),
    windowMs: envPositiveInteger('ARENA_RATE_LIMIT_WINDOW_MS', 60_000),
  });
  return createServer(async (request, response) => {
    const startedAt = now();
    const method = request.method || 'GET';
    let path = '/';
    let status = 500;
    try {
      path = decodePathname(new URL(request.url || '/', 'http://arena.local').pathname);
      if (method === 'GET' && path === '/healthz') {
        status = 200;
        writeResponse(response, status, { 'content-type': 'application/json; charset=utf-8' }, { status: 'ok' });
        return;
      }
      if (isMutation(method)) {
        const decision = limiter.take(clientIdentifier(request), now());
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
}

class FixedWindowRateLimiter {
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly windows = new Map<string, { startedAt: number; count: number }>();

  constructor(config: { maxRequests: number; windowMs: number }) {
    if (!Number.isSafeInteger(config.maxRequests) || config.maxRequests < 1
      || !Number.isSafeInteger(config.windowMs) || config.windowMs < 1) throw new TypeError('rate limit configuration is invalid');
    this.maxRequests = config.maxRequests;
    this.windowMs = config.windowMs;
  }

  take(identifier: string, now: number): { allowed: boolean; retryAfterSeconds: number } {
    const current = this.windows.get(identifier);
    if (!current || now - current.startedAt >= this.windowMs) {
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

function clientIdentifier(request: IncomingMessage): string {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim();
  return request.socket.remoteAddress || 'unknown';
}

function envPositiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} is invalid`);
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
  const server = createArenaServer(operator, runtime);
  server.once('close', () => runtime.close());
  const shutdown = () => server.close();
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  server.listen(port, host, () => {
    process.stdout.write(`${JSON.stringify({ event: 'server_listening', host, port })}\n`);
  });
}
