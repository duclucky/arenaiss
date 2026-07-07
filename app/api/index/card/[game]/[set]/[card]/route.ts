import { NextResponse } from 'next/server';
import { indexFetch } from '@/lib/renaiss/index.server';
import { IndexCardSchema, safeParse } from '@/lib/renaiss/schemas';

// Proxy Index card detail. Client gọi /api/index/card/{game}/{set}/{card}
// (KHÔNG có key ở client) → route này (server) gắn header key → Renaiss.
// LƯU Ý: endpoint THẬT là /v1/cards/ (số nhiều); href từ search là /card/ (số ít).
// Next.js: params là Promise, phải await. Zod validate response.

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ game: string; set: string; card: string }> },
) {
  const { game, set, card } = await params;
  const path = `/v1/cards/${encodeURIComponent(game)}/${encodeURIComponent(set)}/${encodeURIComponent(card)}`;
  const result = await indexFetch(path);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }
  const parsed = safeParse(IndexCardSchema, result.data);
  if (!parsed.ok) {
    return NextResponse.json({ warning: parsed.error, raw: result.data });
  }
  // Nhắc: khi hiển thị số này ở UI, ghi attribution "Renaiss OS Index".
  return NextResponse.json(parsed.data);
}
