import { NextResponse } from 'next/server';
import { PASSPORT_SYSTEM_PROMPT, PassportInputSchema, fallbackNarration } from '@/lib/passport/prompt';
import { safeParse } from '@/lib/renaiss/schemas';

// Card Passport AI layer: server-side only, with validated data and deterministic fallback.

export const runtime = 'nodejs';

const MODEL = 'claude-haiku-4-5-20251001';

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'body is not valid JSON' }, { status: 400 });
  }

  const parsed = safeParse(PassportInputSchema, body);
  if (!parsed.ok) {
    return NextResponse.json({ error: `invalid input: ${parsed.error}` }, { status: 400 });
  }
  const input = parsed.data;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({
      text: fallbackNarration(input),
      mode: 'fallback',
      note: 'ANTHROPIC_API_KEY is not configured, so this is a deterministic summary from the same validated data.',
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
            content: `This is validated real reference data for one card. Explain it using the required output format:\n\n\`\`\`json\n${JSON.stringify(input, null, 2)}\n\`\`\``,
          },
        ],
      }),
    });
    if (!res.ok) {
      return NextResponse.json({
        text: fallbackNarration(input),
        mode: 'fallback',
        note: `LLM returned ${res.status}; using deterministic summary.`,
      });
    }
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = (data.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
    if (!text) {
      return NextResponse.json({ text: fallbackNarration(input), mode: 'fallback', note: 'LLM returned empty text; using fallback.' });
    }
    return NextResponse.json({ text, mode: 'ai' });
  } catch (e) {
    return NextResponse.json({
      text: fallbackNarration(input),
      mode: 'fallback',
      note: `LLM exception (${e instanceof Error ? e.message : 'unknown'}); using fallback.`,
    });
  }
}
