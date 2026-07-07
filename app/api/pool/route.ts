import { NextResponse } from 'next/server';
import { marketplaceFetch } from '@/lib/renaiss/marketplace.server';
import { MarketplaceResponseSchema, safeParse, type MarketplaceItem } from '@/lib/renaiss/schemas';

// Aggregator: gộp nhiều trang /v0/marketplace (cap limit=100/trang) thành một
// POOL sẵn dùng cho gacha engine. Server-side: giấu chi tiết phân trang, cache,
// xử lý CORS/rate-limit một chỗ. READ-ONLY.

export const revalidate = 120;

const MAX_PAGES = 4; // 4×100 = 400 thẻ/category — đủ đa dạng cho pool, đủ nhanh.

export async function GET(req: Request) {
  const url = new URL(req.url);
  const category = url.searchParams.get('category') ?? 'POKEMON'; // POKEMON | ONE_PIECE
  const items: MarketplaceItem[] = [];
  let lastError: string | null = null;

  for (let offset = 0; offset < MAX_PAGES * 100; offset += 100) {
    const qs = `?categoryFilter=${encodeURIComponent(category)}&limit=100&offset=${offset}`;
    const res = await marketplaceFetch(`/v0/marketplace${qs}`);
    if (!res.ok) { lastError = res.error; break; }
    const parsed = safeParse(MarketplaceResponseSchema, res.data);
    if (!parsed.ok) { lastError = parsed.error; break; }
    items.push(...parsed.data.collection);
    if (!parsed.data.pagination?.hasMore) break;
  }

  if (items.length === 0) {
    return NextResponse.json({ error: lastError ?? 'pool rỗng', collection: [] }, { status: 502 });
  }
  return NextResponse.json({ collection: items, count: items.length, category });
}
