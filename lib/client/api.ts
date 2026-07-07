// Client-side fetchers — CHỈ gọi proxy nội bộ (/api/*), KHÔNG bao giờ gọi thẳng
// Renaiss (giữ key server-side, tránh CORS). Trả về giá trị an toàn, không throw.

import { buildCards, type GameCard } from '@/lib/game/stats';
import {
  MarketplaceResponseSchema,
  CardDetailSchema,
  IndexSearchResponseSchema,
  IndexCardSchema,
  PacksResponseSchema,
  safeParse,
  type CardDetail,
  type IndexSearchItem,
  type IndexCard,
  type CardPack,
} from '@/lib/renaiss/schemas';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// getJson với retry + backoff — marketplace upstream rate-limit khá gắt (403/5xx)
// khi có burst request; retry nhẹ giúp ảnh/dữ liệu vẫn về mà không vỡ UI.
async function getJson(url: string, retries = 2): Promise<unknown | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
      if (attempt < retries) await sleep(350 * (attempt + 1));
    } catch {
      if (attempt < retries) await sleep(350 * (attempt + 1));
    }
  }
  return null;
}

export type Category = 'POKEMON' | 'ONE_PIECE';

// Tải pool marketplace và tính stats/tier (buildCards) client-side.
export async function loadPool(category: Category): Promise<GameCard[]> {
  const raw = await getJson(`/api/pool?category=${category}`);
  const parsed = safeParse(MarketplaceResponseSchema, raw);
  if (!parsed.ok) return [];
  return buildCards(parsed.data.collection);
}

export async function fetchCardDetail(tokenId: string): Promise<CardDetail | null> {
  const raw = await getJson(`/api/cards/${encodeURIComponent(tokenId)}`);
  if (!raw) return null;
  const parsed = safeParse(CardDetailSchema, raw);
  return parsed.ok ? parsed.data : null;
}

export async function searchIndex(q: string): Promise<IndexSearchItem[]> {
  const raw = await getJson(`/api/index/search?q=${encodeURIComponent(q)}`);
  const parsed = safeParse(IndexSearchResponseSchema, raw);
  return parsed.ok ? parsed.data.results : [];
}

// href dạng "/card/{game}/{set}/{card}" (số ít) → gọi proxy /api/index/card/... (số nhiều).
export async function fetchIndexCardByHref(href: string): Promise<IndexCard | null> {
  const clean = href.replace(/^\/card\//, '').replace(/^\//, '');
  const parts = clean.split('/');
  if (parts.length < 3) return null;
  const [game, set, card] = parts;
  const raw = await getJson(
    `/api/index/card/${encodeURIComponent(game)}/${encodeURIComponent(set)}/${encodeURIComponent(card)}`,
  );
  if (!raw) return null;
  const parsed = safeParse(IndexCardSchema, raw);
  return parsed.ok ? parsed.data : null;
}

export async function fetchPacks(): Promise<CardPack[]> {
  const raw = await getJson('/api/packs');
  const parsed = safeParse(PacksResponseSchema, raw);
  return parsed.ok ? parsed.data.cardPacks : [];
}

export interface NarrationResult {
  text: string;
  mode: 'ai' | 'fallback';
  note?: string;
}

export async function narratePassport(payload: unknown): Promise<NarrationResult | null> {
  try {
    const res = await fetch('/api/passport/narrate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return null;
    return (await res.json()) as NarrationResult;
  } catch {
    return null;
  }
}
