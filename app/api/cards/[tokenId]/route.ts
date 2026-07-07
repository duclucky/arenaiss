import { NextResponse } from 'next/server';
import { marketplaceFetch } from '@/lib/renaiss/marketplace.server';
import { CardDetailSchema, safeParse } from '@/lib/renaiss/schemas';

// Proxy card detail /v0/cards/{tokenId} — ảnh + custody + pricing + activities.
// Dùng để HYDRATE thẻ đã rút (lấy ảnh) và cấp dữ liệu cho Card Passport.
// READ-ONLY, public (không key).

export const revalidate = 120;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ tokenId: string }> },
) {
  const { tokenId } = await params;
  const res = await marketplaceFetch(
    `/v0/cards/${encodeURIComponent(tokenId)}?includeActivities=true&verbosePrice=true`,
  );
  if (!res.ok) {
    return NextResponse.json({ error: res.error }, { status: 502 });
  }
  const parsed = safeParse(CardDetailSchema, res.data);
  if (!parsed.ok) {
    // Data beta có thể lệch schema — vẫn trả raw để UI degrade nhẹ, kèm cảnh báo.
    return NextResponse.json({ warning: `schema: ${parsed.error}`, raw: res.data });
  }
  return NextResponse.json(parsed.data);
}
