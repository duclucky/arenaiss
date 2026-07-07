import type { GameCard, Element } from './stats';
import { typeMultiplier, typeVerdict, ELEMENT_GLYPH } from './stats';

// ============================================================================
// BATTLE ENGINE — Top-Trumps theo lượt, DETERMINISTIC, CÓ SKILL.
//  - Hai deck 5 thẻ, người chơi TỰ sắp thứ tự (một tầng quyết định).
//  - Mỗi lượt cả hai lật thẻ đầu hàng; NGƯỜI TẤN CÔNG (luân phiên) chọn 1 thuộc
//    tính (atk/def/aura) để so — quyết định chiến thuật, không auto.
//  - TYPE-ADVANTAGE (RPSLS 5 element) nhân vào chỉ số → khắc chế lật kèo.
//  - Thẻ thua bị KO (loại); thẻ thắng ở lại. Hết sạch 5 thẻ trước là THUA.
//  - Hoà điểm → người tấn công thắng (aggressor edge). Không có RNG trong trận →
//    kết quả tái lập hoàn toàn theo (decks + lựa chọn).
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
  if (v === 'neutral') return `${ELEMENT_GLYPH[a]} ${a} vs ${ELEMENT_GLYPH[d]} ${d}: trung tính`;
  const sym = v === 'advantage' ? '≻ khắc' : '≺ bị khắc';
  return `${ELEMENT_GLYPH[a]} ${a} ${sym} ${ELEMENT_GLYPH[d]} ${d}`;
}

// Tính hiệu quả của một lượt cho một stat cụ thể (không thay đổi state).
export function previewRound(state: BattleState, stat: StatKey) {
  const p = state.playerQueue[0];
  const o = state.opponentQueue[0];
  const pMult = typeMultiplier(p.element, o.element);
  const oMult = typeMultiplier(o.element, p.element);
  const pEff = Math.round(p[stat] * pMult);
  const oEff = Math.round(o[stat] * oMult);
  return { p, o, pMult, oMult, pEff, oEff };
}

// AI tham lam: chọn stat tối đa hoá (oppEff - playerEff) ở cặp thẻ đầu hàng.
// Cũng dùng làm GỢI Ý cho người chơi.
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

// Thực thi một lượt. `stat` là lựa chọn của NGƯỜI TẤN CÔNG hiện tại
// (nếu attacker là opponent, gọi chooseStatGreedy trước rồi truyền vào).
export function stepRound(state: BattleState, stat: StatKey): { state: BattleState; round: RoundResult } {
  if (state.status !== 'ongoing') return { state, round: state.rounds[state.rounds.length - 1] };
  const { p, o, pMult, oMult, pEff, oEff } = previewRound(state, stat);
  const attacker = state.attacker;

  let winner: Side;
  if (pEff === oEff) winner = attacker; // hoà → người tấn công thắng
  else winner = pEff > oEff ? 'player' : 'opponent';
  const loser: Side = winner === 'player' ? 'opponent' : 'player';

  const playerQueue = state.playerQueue.slice();
  const opponentQueue = state.opponentQueue.slice();
  const koCard = loser === 'player' ? playerQueue[0] : opponentQueue[0];
  if (loser === 'player') playerQueue.shift();
  else opponentQueue.shift();

  const attackerLabel = attacker === 'player' ? 'Bạn' : 'Đối thủ';
  const winCard = winner === 'player' ? p : o;
  const winEff = winner === 'player' ? pEff : oEff;
  const loseCard = loser === 'player' ? p : o;
  const loseEff = loser === 'player' ? pEff : oEff;
  const typeNote = elNote(p.element, o.element);
  const reason =
    `${attackerLabel} tấn công bằng ${STAT_LABEL[stat]}. ` +
    `${winCard.name.split(' ').slice(0, 3).join(' ')} (${winEff}) ` +
    `${pEff === oEff ? 'hoà và thắng nhờ thế tấn công' : 'vượt'} ` +
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
