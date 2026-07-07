import { NextResponse } from 'next/server';
import { createAuthStore } from '@/lib/auth/store';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { username?: unknown; password?: unknown; confirmPassword?: unknown } | null;
  if (!body || typeof body.username !== 'string' || typeof body.password !== 'string' || typeof body.confirmPassword !== 'string') {
    return NextResponse.json({ ok: false, error: 'Enter a username and password.' }, { status: 400 });
  }
  if (body.password !== body.confirmPassword) {
    return NextResponse.json({ ok: false, error: 'Passwords do not match.' }, { status: 400 });
  }
  const result = await createAuthStore().createUser(body.username, body.password);
  if (!result.ok) {
    const message = result.error === 'USERNAME_TAKEN'
      ? 'That username is already taken.'
      : 'Username must be 3-24 chars using letters, numbers, or underscore. Password must be at least 8 chars.';
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
  return NextResponse.json({ ok: true, user: { id: result.user!.id, username: result.user!.username } });
}
