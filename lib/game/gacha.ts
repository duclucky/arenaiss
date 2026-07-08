import type { GameCard, Tier } from './stats';
import { TIERS, TIER_ODDS } from './stats';
import { makeRng, weightedPick, rngInt, type Rng } from './rng';

// Simulated gacha economy. No wallet, no real money, no on-chain actions.

export const STARTING_CREDITS = 10000;
export const BATTLE_STAKE = 100;
export const WIN_REWARD = 199;
export const LOSS_REWARD = 0;
export const DRAW_REFUND = BATTLE_STAKE;
export const WELCOME_PACK_ID = 'welcome';

export type PackId = 'welcome' | 'eden' | 'omega' | 'renacrypt';
export type PackCategory = 'POKEMON' | 'ONE_PIECE';

export interface PackDefinition {
  id: PackId;
  name: string;
  cost: number;
  size: number;
  description: string;
  categories: PackCategory[];
  sourceSlug?: string;
  theme: string;
  tierOdds: Record<Tier, number>;
}

export const PACKS: PackDefinition[] = [
  {
    id: WELCOME_PACK_ID,
    name: 'Welcome Pack',
    cost: 0,
    size: 5,
    description: 'One-time starter pack for a new player.',
    categories: ['POKEMON', 'ONE_PIECE'],
    theme: 'Starter mix from both arena lines.',
    tierOdds: TIER_ODDS,
  },
  {
    id: 'eden',
    name: 'Eden Pack',
    cost: 800,
    size: 1,
    description: 'One Piece themed simulated pack inspired by the real Eden Pack.',
    categories: ['ONE_PIECE'],
    sourceSlug: 'eden-pack',
    theme: 'One Piece',
    tierOdds: { TOP: 0.01, S: 0.04, A: 0.13, B: 0.27, C: 0.35, D: 0.2 },
  },
  {
    id: 'omega',
    name: 'OMEGA Pack',
    cost: 300,
    size: 1,
    description: 'Pokemon themed simulated pack inspired by the real OMEGA pack.',
    categories: ['POKEMON'],
    sourceSlug: 'omega',
    theme: 'Pokemon',
    tierOdds: { TOP: 0.02, S: 0.07, A: 0.18, B: 0.3, C: 0.28, D: 0.15 },
  },
  {
    id: 'renacrypt',
    name: 'RenaCrypt Pack',
    cost: 500,
    size: 1,
    description: 'Mixed simulated vault pack inspired by the real RenaCrypt perpetual pack.',
    categories: ['POKEMON', 'ONE_PIECE'],
    sourceSlug: 'renacrypt-pack',
    theme: 'Mixed vault',
    tierOdds: { TOP: 0.04, S: 0.11, A: 0.25, B: 0.3, C: 0.2, D: 0.1 },
  },
];

export const DEFAULT_PACK_ID: PackId = 'eden';
export const PAID_PACKS = PACKS.filter((pack) => pack.id !== WELCOME_PACK_ID);
export const PACK_COST = PACKS.find((pack) => pack.id === DEFAULT_PACK_ID)?.cost ?? 800;

export interface PackReveal {
  cards: GameCard[];
  seed: string;
  topTier: Tier;
  packId: PackId;
  packName: string;
  cost: number;
  size: number;
}

export interface OddsRow {
  tier: Tier;
  chance: number;
  label: string;
  poolCount: number;
}

export function getPack(id: PackId = DEFAULT_PACK_ID): PackDefinition {
  return PACKS.find((pack) => pack.id === id) ?? PACKS.find((pack) => pack.id === DEFAULT_PACK_ID)!;
}

export function isPackId(value: unknown): value is PackId {
  return typeof value === 'string' && PACKS.some((pack) => pack.id === value);
}

export function eligibleCardsForPack(pool: GameCard[], packId: PackId = DEFAULT_PACK_ID): GameCard[] {
  const pack = getPack(packId);
  return pool.filter((card) => card.category === null || pack.categories.includes(card.category as PackCategory));
}

export function packCategoryLabel(pack: PackDefinition): string {
  if (pack.categories.length === 2) return 'Pokemon + One Piece';
  return pack.categories[0] === 'POKEMON' ? 'Pokemon' : 'One Piece';
}

export function oddsTable(pool: GameCard[], packId: PackId = DEFAULT_PACK_ID): OddsRow[] {
  const pack = getPack(packId);
  const eligible = eligibleCardsForPack(pool, pack.id);
  const counts: Record<Tier, number> = { TOP: 0, S: 0, A: 0, B: 0, C: 0, D: 0 };
  for (const c of eligible) counts[c.tier]++;
  const labels: Record<Tier, string> = {
    TOP: 'Top - legendary',
    S: 'S - ultra rare',
    A: 'A - rare',
    B: 'B - solid',
    C: 'C - common',
    D: 'D - starter',
  };
  return TIERS.map((tier) => ({ tier, chance: pack.tierOdds[tier], label: labels[tier], poolCount: counts[tier] }));
}

export function settleBattleCredits(credits: number, event: 'start' | 'player_win' | 'opponent_win' | 'draw'): number {
  if (event === 'start') return Math.max(0, credits - BATTLE_STAKE);
  if (event === 'player_win') return credits + WIN_REWARD;
  if (event === 'draw') return credits + DRAW_REFUND;
  return credits + LOSS_REWARD;
}

function tierWeights(pool: GameCard[], pack: PackDefinition): { tiers: Tier[]; weights: number[] } {
  const present = TIERS.filter((t) => pool.some((c) => c.tier === t));
  return { tiers: present, weights: present.map((t) => pack.tierOdds[t]) };
}

function drawOne(rng: Rng, pool: GameCard[], byTier: Map<Tier, GameCard[]>, pack: PackDefinition): GameCard {
  const { tiers, weights } = tierWeights(pool, pack);
  const tier = weightedPick(rng, tiers, weights);
  const bucket = byTier.get(tier) ?? pool;
  return bucket[rngInt(rng, 0, bucket.length)];
}

export function openPack(pool: GameCard[], seed: string, packId: PackId = DEFAULT_PACK_ID): PackReveal {
  const pack = getPack(packId);
  const eligiblePool = eligibleCardsForPack(pool, pack.id);
  const rng = makeRng(seed);
  const byTier = new Map<Tier, GameCard[]>();
  for (const c of eligiblePool) {
    const arr = byTier.get(c.tier) ?? [];
    arr.push(c);
    byTier.set(c.tier, arr);
  }

  const picked: GameCard[] = [];
  const usedTokens = new Set<string>();
  const targetSize = Math.min(pack.size, eligiblePool.length);
  const maxTries = targetSize * 12;
  let tries = 0;
  while (picked.length < targetSize && tries < maxTries) {
    tries++;
    const card = drawOne(rng, eligiblePool, byTier, pack);
    if (usedTokens.has(card.tokenId)) continue;
    usedTokens.add(card.tokenId);
    picked.push(card);
  }

  const rank: Record<Tier, number> = { TOP: 0, S: 1, A: 2, B: 3, C: 4, D: 5 };
  const topTier = picked.reduce<Tier>((best, c) => (rank[c.tier] < rank[best] ? c.tier : best), 'D');
  return { cards: picked, seed, topTier, packId: pack.id, packName: pack.name, cost: pack.cost, size: pack.size };
}
