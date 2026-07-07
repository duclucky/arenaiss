import { NextResponse } from 'next/server';
import { indexFetch } from '@/lib/renaiss/index.server';
import { IndexSearchResponseSchema, safeParse } from '@/lib/renaiss/schemas';

// Proxy Index search /v1/search?q= (partner key server-side). Resolve tên thẻ →
// href /card/{game}/{set}/{card}. Số hiển thị ở UI ghi attribution "Renaiss OS Index".

export const revalidate = 300;

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get('q');
  if (!q) return NextResponse.json({ error: 'thiếu tham số q', results: [] }, { status: 400 });

  const res = await indexFetch(`/v1/search?q=${encodeURIComponent(q)}`);
  if (!res.ok) {
    return NextResponse.json({ error: res.error, results: [] }, { status: 502 });
  }
  const parsed = safeParse(IndexSearchResponseSchema, res.data);
  if (!parsed.ok) {
    return NextResponse.json({ warning: parsed.error, results: [] });
  }
  return NextResponse.json(parsed.data);
}
