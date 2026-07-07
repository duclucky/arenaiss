import { NextResponse } from 'next/server';
import { marketplaceFetch } from '@/lib/renaiss/marketplace.server';
import { PacksResponseSchema, safeParse } from '@/lib/renaiss/schemas';

// Proxy /v0/packs → dữ liệu cho nút "làm sao sở hữu THẬT" (phễu hệ sinh thái).
// Đây là gói THẬT của Renaiss (tốn USDT thật) — TÁCH biệt hoàn toàn với gói
// MÔ PHỎNG trong game. READ-ONLY.

export const revalidate = 300;

export async function GET() {
  const res = await marketplaceFetch('/v0/packs');
  if (!res.ok) {
    return NextResponse.json({ error: res.error, cardPacks: [] }, { status: 502 });
  }
  const parsed = safeParse(PacksResponseSchema, res.data);
  if (!parsed.ok) {
    return NextResponse.json({ warning: parsed.error, cardPacks: [] });
  }
  return NextResponse.json(parsed.data);
}
