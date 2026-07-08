import { NextResponse } from 'next/server';
import { PASSPORT_SYSTEM_PROMPT, PassportInputSchema, fallbackNarration } from '@/lib/passport/prompt';
import { safeParse } from '@/lib/renaiss/schemas';
import { readPassportAiCache, writePassportAiCache } from '@/lib/passport/cache.server';

// Card Passport AI layer: server-side only, with validated data and deterministic fallback.

export const runtime = 'nodejs';

const DEFAULT_BASE_URL = 'https://v98store.com/v1';
const DEFAULT_MODEL = 'deepseek-v4-flash';

function providerBaseUrl(): string {
  return (process.env.PASSPORT_AI_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function providerModel(): string {
  return process.env.PASSPORT_AI_MODEL ?? DEFAULT_MODEL;
}

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

  const apiKey = process.env.PASSPORT_AI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({
      text: fallbackNarration(input),
      mode: 'fallback',
      note: 'AI provider key is not configured, so this is a deterministic insight from the same validated data.',
    });
  }

  const cached = await readPassportAiCache(input);
  if (cached) {
    return NextResponse.json({
      text: cached.text,
      mode: cached.mode,
      cached: true,
      generatedAt: cached.generatedAt,
      model: cached.model,
    });
  }

  try {
    const model = providerModel();
    const res = await fetch(`${providerBaseUrl()}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 260,
        messages: [
          { role: 'system', content: PASSPORT_SYSTEM_PROMPT },
          {
            role: 'user',
            content: `This is validated real reference data for one card. Produce only the short Passport AI insight requested by the system prompt:\n\n\`\`\`json\n${JSON.stringify(input, null, 2)}\n\`\`\``,
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
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = (data.choices ?? []).map((c) => c.message?.content ?? '').join('\n').trim();
    if (!text) {
      return NextResponse.json({ text: fallbackNarration(input), mode: 'fallback', note: 'LLM returned empty text; using fallback.' });
    }
    const entry = await writePassportAiCache(input, text, model);
    return NextResponse.json({
      text,
      mode: 'ai',
      cached: false,
      generatedAt: entry.generatedAt,
      model,
    });
  } catch (e) {
    return NextResponse.json({
      text: fallbackNarration(input),
      mode: 'fallback',
      note: `LLM exception (${e instanceof Error ? e.message : 'unknown'}); using fallback.`,
    });
  }
}
