import type { GameCard, Tier } from './stats';
import { TIERS, TIER_ODDS } from './stats';
import { makeRng, weightedPick, rngInt, type Rng } from './rng';

// ============================================================================
// GACHA ENGINE — LAI: odds theo tier + pool thẻ THẬT từ /v0/marketplace.
// GHI CHÚ TRUNG THỰC: gacha odds on-chain KHÔNG công khai ở API alpha (SDK
// listGachaMachines() → 404, GachaMachineContent không có field `chance`).
// Do đó odds tier được ƯỚC LƯỢNG minh bạch từ thành phần pool (TIER_ODDS) và
// hiển thị công khai. Kinh tế ẢO: mở gói MÔ PHỎNG, KHÔNG tốn tiền thật, KHÔNG ký ví.
// ============================================================================

export const PACK_SIZE = 5;
export const STARTING_CREDITS = 300;
export const PACK_COST = 100;
export const WIN_REWARD = 120;
export const LOSS_REWARD = 40;

export interface PackReveal {
  cards: GameCard[];
  seed: string;
  topTier: Tier; // tier hiếm nhất trong gói (dùng cho ánh sáng reveal)
}

// Bảng odds hiển thị trong UI (minh bạch).
export interface OddsRow { tier: Tier; chance: number; label: string; poolCount: number; }
export function oddsTable(pool: GameCard[]): OddsRow[] {
  const counts: Record<Tier, number> = { TOP: 0, S: 0, A: 0, B: 0, C: 0, D: 0 };
  for (const c of pool) counts[c.tier]++;
  const labels: Record<Tier, string> = {
    TOP: 'Top — legendary', S: 'S — ultra rare', A: 'A — rare',
    B: 'B — solid', C: 'C — common', D: 'D — starter',
  };
  return TIERS.map((tier) => ({ tier, chance: TIER_ODDS[tier], label: labels[tier], poolCount: counts[tier] }));
}

function tierWeights(pool: GameCard[]): { tiers: Tier[]; weights: number[] } {
  // Chỉ bốc tier CÓ thẻ trong pool; trọng số = odds ước lượng.
  const present = TIERS.filter((t) => pool.some((c) => c.tier === t));
  return { tiers: present, weights: present.map((t) => TIER_ODDS[t]) };
}

function drawOne(rng: Rng, pool: GameCard[], byTier: Map<Tier, GameCard[]>): GameCard {
  const { tiers, weights } = tierWeights(pool);
  const tier = weightedPick(rng, tiers, weights);
  const bucket = byTier.get(tier) ?? pool;
  return bucket[rngInt(rng, 0, bucket.length)];
}

// Mở một gói: rút PACK_SIZE thẻ (không trùng trong cùng gói nếu đủ pool).
export function openPack(pool: GameCard[], seed: string): PackReveal {
  const rng = makeRng(seed);
  const byTier = new Map<Tier, GameCard[]>();
  for (const c of pool) {
    const arr = byTier.get(c.tier) ?? [];
    arr.push(c);
    byTier.set(c.tier, arr);
  }
  const picked: GameCard[] = [];
  const usedTokens = new Set<string>();
  const maxTries = PACK_SIZE * 12;
  let tries = 0;
  while (picked.length < Math.min(PACK_SIZE, pool.length) && tries < maxTries) {
    tries++;
    const card = drawOne(rng, pool, byTier);
    if (usedTokens.has(card.tokenId)) continue;
    usedTokens.add(card.tokenId);
    picked.push(card);
  }
  const rank: Record<Tier, number> = { TOP: 0, S: 1, A: 2, B: 3, C: 4, D: 5 };
  const topTier = picked.reduce<Tier>((best, c) => (rank[c.tier] < rank[best] ? c.tier : best), 'D');
  return { cards: picked, seed, topTier };
}
