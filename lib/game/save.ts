import type { Category } from '@/lib/client/api';
import type { GameCard } from './stats';

export const STORAGE_KEY = 'renaiss-arena:anonymous-save';
export const SAVE_VERSION = 1;

export interface PullHistoryEntry {
  seed: string;
  tokenIds: string[];
  openedAt: string;
}

export interface ArenaSave {
  version: typeof SAVE_VERSION;
  savedAt: string;
  category: Category;
  credits: number;
  roster: GameCard[];
  deckTokens: string[];
  packCount: number;
  pullHistory: PullHistoryEntry[];
  lastCreditRefillAt: string | null;
  passportHintSeen: boolean;
}

export interface ArenaSaveInput {
  category: Category;
  credits: number;
  roster: GameCard[];
  deckTokens: string[];
  packCount: number;
  pullHistory: PullHistoryEntry[];
  lastCreditRefillAt: string | null;
  passportHintSeen: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCategory(value: unknown): value is Category {
  return value === 'POKEMON' || value === 'ONE_PIECE';
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

function isGameCard(value: unknown): value is GameCard {
  if (!isRecord(value)) return false;
  return (
    typeof value.tokenId === 'string' &&
    typeof value.name === 'string' &&
    typeof value.atk === 'number' &&
    typeof value.def === 'number' &&
    typeof value.aura === 'number' &&
    typeof value.power === 'number' &&
    typeof value.tier === 'string' &&
    typeof value.element === 'string'
  );
}

function parsePullHistory(value: unknown): PullHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is PullHistoryEntry => {
    if (!isRecord(entry)) return false;
    return (
      typeof entry.seed === 'string' &&
      isStringArray(entry.tokenIds) &&
      typeof entry.openedAt === 'string'
    );
  });
}

export function serializeArenaSave(input: ArenaSaveInput, now: Date = new Date()): ArenaSave {
  return {
    version: SAVE_VERSION,
    savedAt: now.toISOString(),
    category: input.category,
    credits: input.credits,
    roster: input.roster,
    deckTokens: input.deckTokens.filter((token) => input.roster.some((card) => card.tokenId === token)).slice(0, 5),
    packCount: input.packCount,
    pullHistory: input.pullHistory,
    lastCreditRefillAt: input.lastCreditRefillAt,
    passportHintSeen: input.passportHintSeen,
  };
}

export function parseSavedArena(raw: string | null): ArenaSave | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(value) || value.version !== SAVE_VERSION || !isCategory(value.category)) return null;
  if (typeof value.savedAt !== 'string') return null;
  if (typeof value.credits !== 'number' || !Number.isFinite(value.credits)) return null;
  if (!Array.isArray(value.roster) || !value.roster.every(isGameCard)) return null;
  if (!isStringArray(value.deckTokens)) return null;
  if (typeof value.packCount !== 'number' || !Number.isFinite(value.packCount)) return null;

  const lastCreditRefillAt =
    typeof value.lastCreditRefillAt === 'string' || value.lastCreditRefillAt === null
      ? value.lastCreditRefillAt
      : null;

  return serializeArenaSave(
    {
      category: value.category,
      credits: Math.max(0, Math.floor(value.credits)),
      roster: value.roster,
      deckTokens: value.deckTokens,
      packCount: Math.max(0, Math.floor(value.packCount)),
      pullHistory: parsePullHistory(value.pullHistory),
      lastCreditRefillAt,
      passportHintSeen: value.passportHintSeen === true,
    },
    new Date(value.savedAt),
  );
}
