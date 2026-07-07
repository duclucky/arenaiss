import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth/http';
import { createAccountSaveStore } from '@/lib/auth/account-save.server';
import { parseSavedArena } from '@/lib/game/save';

export const runtime = 'nodejs';

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
  const save = await createAccountSaveStore().get(user.id);
  return NextResponse.json({ ok: true, save });
}

export async function PUT(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 });
  const body = await req.text();
  const parsed = parseSavedArena(body);
  if (!parsed) {
    return NextResponse.json({ ok: false, error: 'Invalid save payload.' }, { status: 400 });
  }
  const save = await createAccountSaveStore().put(user.id, parsed);
  return NextResponse.json({ ok: true, save });
}
