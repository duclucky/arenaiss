import 'server-only';

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PassportInput } from '@/lib/passport/prompt';
import {
  PASSPORT_AI_CACHE_TTL_MS,
  isPassportAiCacheFresh,
  passportAiCacheKey,
  passportAiFingerprint,
  type CachedPassportNarration,
} from '@/lib/passport/cache';

interface PassportAiCacheStore {
  version: 1;
  entries: Record<string, CachedPassportNarration>;
}

const CACHE_DIR = join(process.cwd(), 'data');
const CACHE_FILE = join(CACHE_DIR, 'passport-ai-cache.json');

async function readStore(): Promise<PassportAiCacheStore> {
  try {
    const raw = await readFile(CACHE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as PassportAiCacheStore;
    if (parsed.version === 1 && parsed.entries && typeof parsed.entries === 'object') return parsed;
  } catch {
    // Missing or malformed cache files should not break the Passport.
  }
  return { version: 1, entries: {} };
}

async function writeStore(store: PassportAiCacheStore): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  const tmp = `${CACHE_FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(store, null, 2), 'utf8');
  await rename(tmp, CACHE_FILE);
}

export async function readPassportAiCache(input: PassportInput): Promise<CachedPassportNarration | null> {
  const store = await readStore();
  const entry = store.entries[passportAiCacheKey(input)];
  if (!entry || entry.mode !== 'ai') return null;
  return isPassportAiCacheFresh(entry) ? entry : null;
}

export async function writePassportAiCache(input: PassportInput, text: string, model: string): Promise<CachedPassportNarration> {
  const now = new Date();
  const store = await readStore();
  const generatedAt = now.toISOString();
  const fingerprint = passportAiFingerprint(input);
  const entry: CachedPassportNarration = {
    tokenId: input.card.tokenId,
    fingerprint,
    text,
    mode: 'ai',
    generatedAt,
    model,
  };

  store.entries = Object.fromEntries(
    Object.entries(store.entries).filter(([, cached]) => isPassportAiCacheFresh(cached, now, PASSPORT_AI_CACHE_TTL_MS)),
  );
  store.entries[passportAiCacheKey(input)] = entry;
  await writeStore(store);
  return entry;
}
