import { NextResponse } from 'next/server';
import { marketplaceFetch } from '@/lib/renaiss/marketplace.server';

// Proxy MẪU cho Marketplace (public, không key). Chuyển tiếp filter từ client.
// Vd: /api/marketplace?categoryFilter=POKEMON&gradeFilter=10&limit=40
// Dùng làm POOL rút thẻ cho engine gacha.

export async function GET(req: Request) {
  const qs = new URL(req.url).search; // giữ nguyên query filter
  const result = await marketplaceFetch(`/v0/marketplace${qs}`);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }
  return NextResponse.json(result.data);
}
