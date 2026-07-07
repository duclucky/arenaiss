import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth/http';

export const runtime = 'nodejs';

export async function GET() {
  const user = await currentUser();
  return NextResponse.json({ ok: true, user: user ? { id: user.id, username: user.username } : null });
}
