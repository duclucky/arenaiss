import { createHash } from 'node:crypto';
import type { PassportInput } from '@/lib/passport/prompt';
import type { NarrationResult } from '@/lib/client/api';

export const PASSPORT_AI_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface CachedPassportNarration extends NarrationResult {
  tokenId: string;
  fingerprint: string;
  generatedAt: string;
  model: string;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, stable(v)]),
    );
  }
  return value;
}

export function passportAiFingerprint(input: PassportInput): string {
  const activities = input.onchain.activities.slice(0, 8).map((a) => ({
    type: a.type,
    timestamp: a.timestamp,
    txHash: a.txHash,
    amount: a.amount,
  }));

  const payload = {
    card: input.card,
    custody: input.custody,
    onchain: {
      activities,
      lastSale: input.onchain.lastSale,
    },
    reference: input.reference,
  };

  return createHash('sha256')
    .update(JSON.stringify(stable(payload)))
    .digest('hex');
}

export function passportAiCacheKey(input: PassportInput): string {
  return `${input.card.tokenId}:${passportAiFingerprint(input)}`;
}

export function isPassportAiCacheFresh(
  entry: Pick<CachedPassportNarration, 'generatedAt'>,
  now = new Date(),
  ttlMs = PASSPORT_AI_CACHE_TTL_MS,
): boolean {
  const generatedAt = Date.parse(entry.generatedAt);
  return Number.isFinite(generatedAt) && now.getTime() - generatedAt <= ttlMs;
}
