import type { ArenaSave } from '@/lib/game/save';

export interface PublicUser {
  id: string;
  username: string;
}

async function json<T>(res: Response): Promise<T> {
  return res.json() as Promise<T>;
}

export async function fetchSession(): Promise<PublicUser | null> {
  const res = await fetch('/api/auth/session', { cache: 'no-store' });
  if (!res.ok) return null;
  const data = await json<{ ok: boolean; user: PublicUser | null }>(res);
  return data.user;
}

export async function registerAccount(username: string, password: string, confirmPassword: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password, confirmPassword }),
  });
  const data = await json<{ ok: boolean; error?: string }>(res);
  return { ok: res.ok && data.ok, error: data.error };
}

export async function loginAccount(username: string, password: string): Promise<{ ok: boolean; user?: PublicUser; error?: string }> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await json<{ ok: boolean; user?: PublicUser; error?: string }>(res);
  return { ok: res.ok && data.ok, user: data.user, error: data.error };
}

export async function logoutAccount(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' });
}

export async function fetchAccountSave(): Promise<ArenaSave | null> {
  const res = await fetch('/api/account/save', { cache: 'no-store' });
  if (res.status === 404 || res.status === 401) return null;
  if (!res.ok) return null;
  const data = await json<{ ok: boolean; save: ArenaSave | null }>(res);
  return data.save;
}

export async function putAccountSave(save: ArenaSave): Promise<ArenaSave | null> {
  const res = await fetch('/api/account/save', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(save),
  });
  if (!res.ok) return null;
  const data = await json<{ ok: boolean; save: ArenaSave }>(res);
  return data.save;
}
