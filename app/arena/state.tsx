'use client';

import { createContext, useContext, useReducer, type ReactNode, type Dispatch } from 'react';
import type { GameCard } from '@/lib/game/stats';
import type { PackReveal } from '@/lib/game/gacha';
import { STARTING_CREDITS, PACK_COST, WIN_REWARD, LOSS_REWARD } from '@/lib/game/gacha';
import type { BattleState, StatKey } from '@/lib/game/battle';
import { initBattle, stepRound, chooseStatGreedy } from '@/lib/game/battle';
import type { Category } from '@/lib/client/api';

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
  passportToken: string | null;
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
  passportToken: null,
};

export type Action =
  | { type: 'SET_CATEGORY'; category: Category }
  | { type: 'POOL_LOADING' }
  | { type: 'POOL_LOADED'; pool: GameCard[] }
  | { type: 'POOL_ERROR'; error: string }
  | { type: 'OPEN_PACK'; reveal: PackReveal }
  | { type: 'HYDRATE_IMAGES'; images: Record<string, string | null> }
  | { type: 'GOTO'; screen: Screen }
  | { type: 'TOGGLE_DECK'; tokenId: string }
  | { type: 'REORDER_DECK'; tokens: string[] }
  | { type: 'START_BATTLE'; playerDeck: GameCard[]; opponentDeck: GameCard[]; seed: string }
  | { type: 'BATTLE_STEP'; stat: StatKey }
  | { type: 'END_BATTLE' }
  | { type: 'OPEN_PASSPORT'; tokenId: string }
  | { type: 'CLOSE_PASSPORT' }
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
    case 'OPEN_PACK': {
      const credits = state.credits - PACK_COST;
      return {
        ...state,
        credits,
        lastPack: action.reveal,
        roster: mergeRoster(state.roster, action.reveal.cards),
        packCount: state.packCount + 1,
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
      return {
        ...state,
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
      return { ...state, credits: state.credits + reward, battleReward: reward, screen: 'result' };
    }
    case 'OPEN_PASSPORT':
      return { ...state, passportToken: action.tokenId };
    case 'CLOSE_PASSPORT':
      return { ...state, passportToken: null };
    case 'RESET_RUN':
      return { ...initialState, pool: state.pool, category: state.category };
    default:
      return state;
  }
}

const StateCtx = createContext<ArenaState | null>(null);
const DispatchCtx = createContext<Dispatch<Action> | null>(null);

export function ArenaProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
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
export { chooseStatGreedy, PACK_COST, WIN_REWARD, LOSS_REWARD };
export function deckCards(state: ArenaState): GameCard[] {
  const byId = new Map(state.roster.map((c) => [c.tokenId, c]));
  return state.deckTokens.map((t) => byId.get(t)).filter((c): c is GameCard => !!c);
}
export function cardByToken(state: ArenaState, tokenId: string | null): GameCard | null {
  if (!tokenId) return null;
  return state.roster.find((c) => c.tokenId === tokenId) ?? state.pool.find((c) => c.tokenId === tokenId) ?? null;
}
