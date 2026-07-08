'use client';

import { createContext, useContext, useEffect, useReducer, type ReactNode, type Dispatch } from 'react';
import type { GameCard } from '@/lib/game/stats';
import type { PackReveal } from '@/lib/game/gacha';
import { BATTLE_STAKE, STARTING_CREDITS, WIN_REWARD, LOSS_REWARD, WELCOME_PACK_ID, settleBattleCredits } from '@/lib/game/gacha';
import type { BattleState, StatKey } from '@/lib/game/battle';
import { initBattle, stepRound, chooseStatGreedy } from '@/lib/game/battle';
import type { Category } from '@/lib/client/api';
import { applyDailyCreditRefill } from '@/lib/game/credit';
import { parseSavedArena, serializeArenaSave, STORAGE_KEY, type ArenaSave, type PullHistoryEntry } from '@/lib/game/save';

export type Screen = 'intro' | 'pack' | 'roster' | 'deck' | 'battle' | 'result';

export interface ArenaState {
  category: Category;
  pool: GameCard[];
  poolLoading: boolean;
  poolError: string | null;
  credits: number;
  roster: GameCard[];
  deckTokens: string[];
  screen: Screen;
  lastPack: PackReveal | null;
  battle: BattleState | null;
  battleReward: number | null;
  packCount: number;
  pullHistory: PullHistoryEntry[];
  lastCreditRefillAt: string | null;
  passportHintSeen: boolean;
  saveReady: boolean;
  lastSavedAt: string | null;
  passportToken: string | null;
  welcomePackOpened: boolean;
}

const initialState: ArenaState = {
  category: 'POKEMON',
  pool: [],
  poolLoading: false,
  poolError: null,
  credits: STARTING_CREDITS,
  roster: [],
  deckTokens: [],
  screen: 'intro',
  lastPack: null,
  battle: null,
  battleReward: null,
  packCount: 0,
  pullHistory: [],
  lastCreditRefillAt: null,
  passportHintSeen: false,
  saveReady: false,
  lastSavedAt: null,
  passportToken: null,
  welcomePackOpened: false,
};

export type Action =
  | { type: 'SET_CATEGORY'; category: Category }
  | { type: 'POOL_LOADING' }
  | { type: 'POOL_LOADED'; pool: GameCard[] }
  | { type: 'POOL_ERROR'; error: string }
  | { type: 'HYDRATE_SAVE'; save: ArenaSave; credits: number; lastCreditRefillAt: string | null }
  | { type: 'SAVE_READY' }
  | { type: 'SAVED'; savedAt: string }
  | { type: 'OPEN_PACK'; reveal: PackReveal; openedAt: string }
  | { type: 'HYDRATE_IMAGES'; images: Record<string, string | null> }
  | { type: 'GOTO'; screen: Screen }
  | { type: 'TOGGLE_DECK'; tokenId: string }
  | { type: 'REORDER_DECK'; tokens: string[] }
  | { type: 'START_BATTLE'; playerDeck: GameCard[]; opponentDeck: GameCard[]; seed: string }
  | { type: 'BATTLE_STEP'; stat: StatKey }
  | { type: 'END_BATTLE' }
  | { type: 'OPEN_PASSPORT'; tokenId: string }
  | { type: 'CLOSE_PASSPORT' }
  | { type: 'DISMISS_PASSPORT_HINT' }
  | { type: 'RESET_RUN' };

function mergeRoster(roster: GameCard[], cards: GameCard[]): GameCard[] {
  const map = new Map(roster.map((c) => [c.tokenId, c]));
  for (const c of cards) if (!map.has(c.tokenId)) map.set(c.tokenId, c);
  return Array.from(map.values());
}

function applyImages<T extends GameCard>(cards: T[], images: Record<string, string | null>): T[] {
  return cards.map((c) => (c.tokenId in images ? { ...c, imageUrl: images[c.tokenId] } : c));
}

function reducer(state: ArenaState, action: Action): ArenaState {
  switch (action.type) {
    case 'SET_CATEGORY':
      return { ...state, category: action.category };
    case 'POOL_LOADING':
      return { ...state, poolLoading: true, poolError: null };
    case 'POOL_LOADED':
      return { ...state, pool: action.pool, poolLoading: false };
    case 'POOL_ERROR':
      return { ...state, poolLoading: false, poolError: action.error };
    case 'HYDRATE_SAVE':
      return {
        ...state,
        category: action.save.category,
        credits: action.credits,
        roster: action.save.roster,
        deckTokens: action.save.deckTokens,
        packCount: action.save.packCount,
        pullHistory: action.save.pullHistory,
        lastCreditRefillAt: action.lastCreditRefillAt,
        passportHintSeen: action.save.passportHintSeen,
        welcomePackOpened: action.save.welcomePackOpened,
        lastSavedAt: action.save.savedAt,
        saveReady: true,
      };
    case 'SAVE_READY':
      return { ...state, saveReady: true };
    case 'SAVED':
      return { ...state, lastSavedAt: action.savedAt };
    case 'OPEN_PACK': {
      const credits = Math.max(0, state.credits - action.reveal.cost);
      return {
        ...state,
        credits,
        lastPack: action.reveal,
        roster: mergeRoster(state.roster, action.reveal.cards),
        packCount: state.packCount + 1,
        pullHistory: [
          ...state.pullHistory,
          {
            seed: action.reveal.seed,
            tokenIds: action.reveal.cards.map((card) => card.tokenId),
            openedAt: action.openedAt,
            packId: action.reveal.packId,
          },
        ].slice(-100),
        welcomePackOpened: state.welcomePackOpened || action.reveal.packId === WELCOME_PACK_ID,
        screen: 'pack',
      };
    }
    case 'HYDRATE_IMAGES':
      return {
        ...state,
        roster: applyImages(state.roster, action.images),
        lastPack: state.lastPack
          ? { ...state.lastPack, cards: applyImages(state.lastPack.cards, action.images) }
          : state.lastPack,
      };
    case 'GOTO':
      return { ...state, screen: action.screen };
    case 'TOGGLE_DECK': {
      const has = state.deckTokens.includes(action.tokenId);
      if (has) return { ...state, deckTokens: state.deckTokens.filter((t) => t !== action.tokenId) };
      if (state.deckTokens.length >= 5) return state;
      return { ...state, deckTokens: [...state.deckTokens, action.tokenId] };
    }
    case 'REORDER_DECK':
      return { ...state, deckTokens: action.tokens };
    case 'START_BATTLE':
      if (state.credits < BATTLE_STAKE) return state;
      return {
        ...state,
        credits: settleBattleCredits(state.credits, 'start'),
        battle: initBattle(action.playerDeck, action.opponentDeck, action.seed),
        battleReward: null,
        screen: 'battle',
      };
    case 'BATTLE_STEP': {
      if (!state.battle || state.battle.status !== 'ongoing') return state;
      const { state: next } = stepRound(state.battle, action.stat);
      return { ...state, battle: next };
    }
    case 'END_BATTLE': {
      if (!state.battle) return state;
      const won = state.battle.status === 'player_win';
      const reward = won ? WIN_REWARD : LOSS_REWARD;
      return { ...state, credits: settleBattleCredits(state.credits, won ? 'player_win' : 'opponent_win'), battleReward: reward, screen: 'result' };
    }
    case 'OPEN_PASSPORT':
      return { ...state, passportToken: action.tokenId, passportHintSeen: true };
    case 'CLOSE_PASSPORT':
      return { ...state, passportToken: null };
    case 'DISMISS_PASSPORT_HINT':
      return { ...state, passportHintSeen: true };
    case 'RESET_RUN':
      return {
        ...initialState,
        pool: state.pool,
        category: state.category,
        saveReady: state.saveReady,
        lastSavedAt: null,
        lastCreditRefillAt: new Date().toISOString(),
      };
    default:
      return state;
  }
}

const StateCtx = createContext<ArenaState | null>(null);
const DispatchCtx = createContext<Dispatch<Action> | null>(null);

export function ArenaProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  useEffect(() => {
    const save = parseSavedArena(window.localStorage.getItem(STORAGE_KEY));
    if (!save) {
      dispatch({ type: 'SAVE_READY' });
      return;
    }
    const refill = applyDailyCreditRefill({
      credits: save.credits,
      lastRefillAt: save.lastCreditRefillAt,
      now: new Date(),
    });
    dispatch({ type: 'HYDRATE_SAVE', save, credits: refill.credits, lastCreditRefillAt: refill.lastRefillAt });
  }, []);

  useEffect(() => {
    if (!state.saveReady) return;
    const saved = serializeArenaSave({
      category: state.category,
      credits: state.credits,
      roster: state.roster,
      deckTokens: state.deckTokens,
      packCount: state.packCount,
      pullHistory: state.pullHistory,
      lastCreditRefillAt: state.lastCreditRefillAt,
      passportHintSeen: state.passportHintSeen,
      welcomePackOpened: state.welcomePackOpened,
    });
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    dispatch({ type: 'SAVED', savedAt: saved.savedAt });
  }, [
    state.category,
    state.credits,
    state.roster,
    state.deckTokens,
    state.packCount,
    state.pullHistory,
    state.lastCreditRefillAt,
    state.passportHintSeen,
    state.welcomePackOpened,
    state.saveReady,
  ]);

  return (
    <StateCtx.Provider value={state}>
      <DispatchCtx.Provider value={dispatch}>{children}</DispatchCtx.Provider>
    </StateCtx.Provider>
  );
}

export function useArena(): ArenaState {
  const s = useContext(StateCtx);
  if (!s) throw new Error('useArena must be used within ArenaProvider');
  return s;
}
export function useArenaDispatch(): Dispatch<Action> {
  const d = useContext(DispatchCtx);
  if (!d) throw new Error('useArenaDispatch must be used within ArenaProvider');
  return d;
}

// Helpers dùng nhiều nơi.
export { chooseStatGreedy, BATTLE_STAKE, WIN_REWARD, LOSS_REWARD };
export function deckCards(state: ArenaState): GameCard[] {
  const byId = new Map(state.roster.map((c) => [c.tokenId, c]));
  return state.deckTokens.map((t) => byId.get(t)).filter((c): c is GameCard => !!c);
}
export function cardByToken(state: ArenaState, tokenId: string | null): GameCard | null {
  if (!tokenId) return null;
  return state.roster.find((c) => c.tokenId === tokenId) ?? state.pool.find((c) => c.tokenId === tokenId) ?? null;
}
