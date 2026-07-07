import type { GameCard, Element } from './stats';
import { typeMultiplier, typeVerdict, ELEMENT_GLYPH } from './stats';

// ============================================================================
// BATTLE ENGINE: deterministic turn-based Top Trumps with player agency.
// ============================================================================

export type Side = 'player' | 'opponent';
export type StatKey = 'atk' | 'def' | 'aura';
export const STAT_KEYS: StatKey[] = ['atk', 'def', 'aura'];
export const STAT_LABEL: Record<StatKey, string> = { atk: 'ATK', def: 'DEF', aura: 'AURA' };

export interface RoundResult {
  index: number;
  attacker: Side;
  stat: StatKey;
  playerCard: GameCard;
  opponentCard: GameCard;
  playerBase: number;
  opponentBase: number;
  playerMult: number;
  opponentMult: number;
  playerEff: number;
  opponentEff: number;
  winner: Side;
  loser: Side;
  koCard: GameCard;
  playerRemaining: number;
  opponentRemaining: number;
  typeNote: string;
  reason: string;
}

export interface BattleState {
  playerQueue: GameCard[];
  opponentQueue: GameCard[];
  rounds: RoundResult[];
  attacker: Side; // ai tấn công lượt SẮP TỚI
  status: 'ongoing' | 'player_win' | 'opponent_win';
  seed: string;
}

export function initBattle(playerDeck: GameCard[], opponentDeck: GameCard[], seed: string): BattleState {
  return {
    playerQueue: playerDeck.slice(),
    opponentQueue: opponentDeck.slice(),
    rounds: [],
    attacker: 'player', // người chơi tấn công trước (luôn có agency)
    status: 'ongoing',
    seed,
  };
}

function elNote(a: Element, d: Element): string {
  const v = typeVerdict(a, d);
  if (v === 'neutral') return `${ELEMENT_GLYPH[a]} ${a} vs ${ELEMENT_GLYPH[d]} ${d}: neutral`;
  const sym = v === 'advantage' ? '≻ counters' : '≺ is countered by';
  return `${ELEMENT_GLYPH[a]} ${a} ${sym} ${ELEMENT_GLYPH[d]} ${d}`;
}

// Preview a stat choice without mutating battle state.
export function previewRound(state: BattleState, stat: StatKey) {
  const p = state.playerQueue[0];
  const o = state.opponentQueue[0];
  const pMult = typeMultiplier(p.element, o.element);
  const oMult = typeMultiplier(o.element, p.element);
  const pEff = Math.round(p[stat] * pMult);
  const oEff = Math.round(o[stat] * oMult);
  return { p, o, pMult, oMult, pEff, oEff };
}

// Greedy AI: choose the stat with the best effective margin.
export function chooseStatGreedy(state: BattleState, side: Side): StatKey {
  let best: StatKey = 'atk';
  let bestMargin = -Infinity;
  for (const s of STAT_KEYS) {
    const { pEff, oEff } = previewRound(state, s);
    const margin = side === 'opponent' ? oEff - pEff : pEff - oEff;
    if (margin > bestMargin) {
      bestMargin = margin;
      best = s;
    }
  }
  return best;
}

// Resolve one round using the current attacker's chosen stat.
export function stepRound(state: BattleState, stat: StatKey): { state: BattleState; round: RoundResult } {
  if (state.status !== 'ongoing') return { state, round: state.rounds[state.rounds.length - 1] };
  const { p, o, pMult, oMult, pEff, oEff } = previewRound(state, stat);
  const attacker = state.attacker;

  let winner: Side;
  if (pEff === oEff) winner = attacker;
  else winner = pEff > oEff ? 'player' : 'opponent';
  const loser: Side = winner === 'player' ? 'opponent' : 'player';

  const playerQueue = state.playerQueue.slice();
  const opponentQueue = state.opponentQueue.slice();
  const koCard = loser === 'player' ? playerQueue[0] : opponentQueue[0];
  if (loser === 'player') playerQueue.shift();
  else opponentQueue.shift();

  const attackerLabel = attacker === 'player' ? 'You' : 'Opponent';
  const winCard = winner === 'player' ? p : o;
  const winEff = winner === 'player' ? pEff : oEff;
  const loseCard = loser === 'player' ? p : o;
  const loseEff = loser === 'player' ? pEff : oEff;
  const typeNote = elNote(p.element, o.element);
  const reason =
    `${attackerLabel} attacked with ${STAT_LABEL[stat]}. ` +
    `${winCard.name.split(' ').slice(0, 3).join(' ')} (${winEff}) ` +
    `${pEff === oEff ? 'tied and won by attacker edge against' : 'beat'} ` +
    `${loseCard.name.split(' ').slice(0, 3).join(' ')} (${loseEff}) → KO.`;

  const round: RoundResult = {
    index: state.rounds.length,
    attacker,
    stat,
    playerCard: p,
    opponentCard: o,
    playerBase: p[stat],
    opponentBase: o[stat],
    playerMult: pMult,
    opponentMult: oMult,
    playerEff: pEff,
    opponentEff: oEff,
    winner,
    loser,
    koCard,
    playerRemaining: playerQueue.length,
    opponentRemaining: opponentQueue.length,
    typeNote,
    reason,
  };

  let status: BattleState['status'] = 'ongoing';
  if (opponentQueue.length === 0) status = 'player_win';
  else if (playerQueue.length === 0) status = 'opponent_win';

  const next: BattleState = {
    ...state,
    playerQueue,
    opponentQueue,
    rounds: [...state.rounds, round],
    attacker: attacker === 'player' ? 'opponent' : 'player',
    status,
  };
  return { state: next, round };
}

// Chạy hết trận với một policy chọn stat cho người chơi (dùng cho self-test / auto).
export type Policy = (state: BattleState) => StatKey;
export function simulate(
  playerDeck: GameCard[],
  opponentDeck: GameCard[],
  seed: string,
  playerPolicy: Policy,
): BattleState {
  let state = initBattle(playerDeck, opponentDeck, seed);
  let guard = 0;
  while (state.status === 'ongoing' && guard++ < 50) {
    const stat = state.attacker === 'player' ? playerPolicy(state) : chooseStatGreedy(state, 'opponent');
    state = stepRound(state, stat).state;
  }
  return state;
}
