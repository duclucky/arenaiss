import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createAuthStore, type StoredUser } from './store';
import { sessionCookieValue, verifySession, type SessionPayload } from './session';

export const SESSION_COOKIE = 'renaiss_session';

export interface PublicUser {
  id: string;
  username: string;
}

export function publicUser(user: StoredUser | SessionPayload): PublicUser {
  return 'userId' in user
    ? { id: user.userId, username: user.username }
    : { id: user.id, username: user.username };
}

export function setSessionCookie(res: NextResponse, user: StoredUser): void {
  res.cookies.set(SESSION_COOKIE, sessionCookieValue({ userId: user.id, username: user.username }), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 7 * 24 * 60 * 60,
  });
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
}

export async function currentSession(): Promise<SessionPayload | null> {
  const jar = await cookies();
  return verifySession(jar.get(SESSION_COOKIE)?.value ?? null);
}

export async function currentUser(): Promise<StoredUser | null> {
  const session = await currentSession();
  if (!session) return null;
  return createAuthStore().findUserById(session.userId);
}
