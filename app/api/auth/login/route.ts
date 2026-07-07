import { NextResponse } from 'next/server';
import { setSessionCookie } from '@/lib/auth/http';
import { createAuthStore } from '@/lib/auth/store';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { username?: unknown; password?: unknown } | null;
  if (!body || typeof body.username !== 'string' || typeof body.password !== 'string') {
    return NextResponse.json({ ok: false, error: 'Enter your username and password.' }, { status: 400 });
  }
  const result = await createAuthStore().authenticateUser(body.username, body.password);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: 'Invalid username or password.' }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true, user: { id: result.user!.id, username: result.user!.username } });
  setSessionCookie(res, result.user!);
  return res;
}
