import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface SessionPayload {
  userId: string;
  username: string;
}

interface SignedSession extends SessionPayload {
  exp: number;
  nonce: string;
}

function b64url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

function unb64url(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8');
}

function sign(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

export function sessionSecret(): string {
  return process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || 'dev-only-please-set-AUTH_SECRET';
}

export function signSession(payload: SessionPayload, secret: string = sessionSecret(), now: Date = new Date()): string {
  const body: SignedSession = {
    ...payload,
    exp: now.getTime() + SESSION_TTL_MS,
    nonce: randomBytes(12).toString('base64url'),
  };
  const encoded = b64url(JSON.stringify(body));
  return `${encoded}.${sign(encoded, secret)}`;
}

export function verifySession(token: string | undefined | null, secret: string = sessionSecret(), now: Date = new Date()): SessionPayload | null {
  if (!token) return null;
  const [encoded, signature, extra] = token.split('.');
  if (!encoded || !signature || extra != null) return null;
  const expected = sign(encoded, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(unb64url(encoded)) as Partial<SignedSession>;
    if (!parsed.userId || !parsed.username || typeof parsed.exp !== 'number') return null;
    if (parsed.exp < now.getTime()) return null;
    return { userId: parsed.userId, username: parsed.username };
  } catch {
    return null;
  }
}

export function sessionCookieValue(payload: SessionPayload): string {
  return signSession(payload);
}
