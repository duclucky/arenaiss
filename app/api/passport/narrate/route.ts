import { NextResponse } from 'next/server';
import { PASSPORT_SYSTEM_PROMPT, PassportInputSchema, fallbackNarration } from '@/lib/passport/prompt';
import { safeParse } from '@/lib/renaiss/schemas';

// Lớp AI Card Passport — gọi SERVER-SIDE (giữ key LLM ở server). Nhận dữ liệu ĐÃ
// validate (từ proxy của ta), validate lại bằng Zod, rồi để LLM DIỄN GIẢI (không
// cho LLM tự gọi API/bịa số). Nếu chưa cấu hình ANTHROPIC_API_KEY → fallback
// deterministic (vẫn tôn trọng mọi ràng buộc: nguồn + thời điểm + caveat).

export const runtime = 'nodejs';

const MODEL = 'claude-haiku-4-5-20251001'; // nhanh, đủ cho narration ngắn

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'body không phải JSON' }, { status: 400 });
  }

  const parsed = safeParse(PassportInputSchema, body);
  if (!parsed.ok) {
    return NextResponse.json({ error: `input không hợp lệ: ${parsed.error}` }, { status: 400 });
  }
  const input = parsed.data;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({
      text: fallbackNarration(input),
      mode: 'fallback',
      note: 'Chưa cấu hình ANTHROPIC_API_KEY — đang dùng bản tóm tắt deterministic từ chính dữ liệu đã validate.',
    });
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 700,
        system: PASSPORT_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: `Đây là dữ liệu THẬT (đã validate) của một lá thẻ. Diễn giải theo đúng định dạng đầu ra:\n\n\`\`\`json\n${JSON.stringify(input, null, 2)}\n\`\`\``,
          },
        ],
      }),
    });
    if (!res.ok) {
      return NextResponse.json({
        text: fallbackNarration(input),
        mode: 'fallback',
        note: `LLM lỗi ${res.status} — dùng bản tóm tắt deterministic.`,
      });
    }
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = (data.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
    if (!text) {
      return NextResponse.json({ text: fallbackNarration(input), mode: 'fallback', note: 'LLM trả rỗng — dùng fallback.' });
    }
    return NextResponse.json({ text, mode: 'ai' });
  } catch (e) {
    return NextResponse.json({
      text: fallbackNarration(input),
      mode: 'fallback',
      note: `LLM ngoại lệ (${e instanceof Error ? e.message : 'unknown'}) — dùng fallback.`,
    });
  }
}
