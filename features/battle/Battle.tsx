'use client';

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useArena, useArenaDispatch } from '@/app/arena/state';
import { Slab } from '@/components/Slab';
import { BattleFx, battleCardMotion } from './BattleFx';
import { useCombatTimeline } from './useCombatTimeline';
import { BATTLE_STAKE, WIN_REWARD } from '@/lib/game/gacha';
import {
  chooseStatGreedy,
  initiativePreview,
  previewRound,
  STAT_KEYS,
  STAT_LABEL,
  type StatKey,
  type RoundResult,
  type Side,
} from '@/lib/game/battle';
import type { GameCard } from '@/lib/game/stats';
import { ELEMENT_GLYPH, typeVerdict } from '@/lib/game/stats';

function Pips({ n, side }: { n: number; side: 'p' | 'o' }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexDirection: side === 'p' ? 'row' : 'row-reverse' }}>
      {Array.from({ length: 5 }).map((_, i) => (
        <span key={i} style={{
          width: 16,
          height: 16,
          borderRadius: 5,
          background: i < n ? (side === 'p' ? 'var(--accent)' : 'var(--loss)') : 'rgba(255,255,255,0.08)',
          boxShadow: i < n ? `0 0 12px ${side === 'p' ? 'var(--accent)' : 'var(--loss)'}` : 'none',
          transition: 'all 0.3s ease',
        }} />
      ))}
    </div>
  );
}

export function Battle() {
  const state = useArena();
  const dispatch = useArenaDispatch();
  const battle = state.battle;
  const [lastRound, setLastRound] = useState<RoundResult | null>(null);
  const prevRounds = useRef(0);
  const combat = useCombatTimeline();
  const { start: startCombatFx } = combat;

  useEffect(() => {
    if (!battle) return;
    if (battle.rounds.length > prevRounds.current) {
      const last = battle.rounds[battle.rounds.length - 1];
      setLastRound(last);
      startCombatFx(last);
      prevRounds.current = battle.rounds.length;
      return;
    }
    prevRounds.current = battle.rounds.length;
  }, [battle?.rounds.length, battle, startCombatFx]);

  useEffect(() => {
    if (!battle || combat.active || battle.status !== 'ongoing' || battle.attacker !== 'opponent') return;
    const t = setTimeout(() => {
      dispatch({ type: 'BATTLE_STEP', stat: chooseStatGreedy(battle, 'opponent') });
    }, 1050);
    return () => clearTimeout(t);
  }, [battle, combat.active, dispatch]);

  if (!battle) return null;
  const over = battle.status !== 'ongoing';
  const pCard: GameCard | undefined = combat.fxRound?.round.playerCard ?? battle.playerQueue[0];
  const oCard: GameCard | undefined = combat.fxRound?.round.opponentCard ?? battle.opponentQueue[0];
  const playerTurn = battle.attacker === 'player' && !over && !combat.active;
  const turn = battle.rounds.length + (over ? 0 : 1);
  const activeStat = combat.fxRound ? combat.fxRound.round.stat : null;
  const showResultButton = over && !combat.active;

  function playPlayerStat(stat: StatKey) {
    if (combat.active) return;
    dispatch({ type: 'BATTLE_STEP', stat });
  }

  return (
    <div className="anim-fade" style={{ maxWidth: 1180, margin: '0 auto', padding: '18px 22px 60px' }}>
      <div className="battle-topline">
        <div>
          <div className="battle-side-label">YOUR LINEUP</div>
          <Pips n={battle.playerQueue.length} side="p" />
        </div>
        <div className="battle-round-title">ROUND {turn}</div>
        <div style={{ textAlign: 'right' }}>
          <div className="battle-side-label">OPPONENT AI</div>
          <Pips n={battle.opponentQueue.length} side="o" />
        </div>
      </div>

      <motion.div
        className="battle-arena panel"
        data-combat-active={combat.active}
        data-combat-stat={activeStat ?? undefined}
        animate={!combat.reduced && combat.phase === 'impact' ? { x: [0, -4, 5, -3, 0] } : { x: 0 }}
        transition={{ duration: 0.22, ease: 'easeOut' }}
        onClick={combat.active ? combat.skip : undefined}
      >
        <motion.div
          className="battle-card-wrap battle-card-player"
          data-active={battle.attacker === 'player' && !over && !combat.active}
          data-win={combat.fxRound?.round.winner === 'player' && combat.phase === 'resolve'}
          animate={battleCardMotion('player', combat.phase, combat.fxRound, combat.reduced)}
          transition={{ duration: 0.26, ease: combat.phase === 'lockIn' ? 'anticipate' : 'easeOut' }}
        >
          <div className="battle-role-chip">{combat.fxRound?.round.attacker === 'player' || (battle.attacker === 'player' && !over && !combat.active) ? 'ATTACKING' : 'DEFENDING'}</div>
          {pCard ? <Slab card={pCard} interactive={false} battleMode highlightStat={activeStat} /> : <Defeated who="You" />}
        </motion.div>

        <div className="battle-center">
          {over && !combat.active ? (
            <div className={battle.status === 'player_win' ? 'anim-win' : 'anim-loss'}>
              <div className="battle-clash-title">{battle.status === 'player_win' ? 'VICTORY' : 'DEFEAT'}</div>
            </div>
          ) : (
            <>
              <div className="battle-clash-title">{activeStat ? `${STAT_LABEL[activeStat]} CLASH` : 'VS'}</div>
              {pCard && oCard && <TypeArrow p={pCard} o={oCard} />}
              {lastRound && (
                <div className="battle-last-hit">
                  {lastRound.winner === 'player' ? 'You won' : 'Opponent won'} with {STAT_LABEL[lastRound.stat]}
                </div>
              )}
            </>
          )}
        </div>

        <motion.div
          className="battle-card-wrap battle-card-opponent"
          data-active={battle.attacker === 'opponent' && !over && !combat.active}
          data-win={combat.fxRound?.round.winner === 'opponent' && combat.phase === 'resolve'}
          animate={battleCardMotion('opponent', combat.phase, combat.fxRound, combat.reduced)}
          transition={{ duration: 0.26, ease: combat.phase === 'lockIn' ? 'anticipate' : 'easeOut' }}
        >
          <div className="battle-role-chip">{combat.fxRound?.round.attacker === 'opponent' || (battle.attacker === 'opponent' && !over && !combat.active) ? 'ATTACKING' : 'DEFENDING'}</div>
          {oCard ? <Slab card={oCard} interactive={false} battleMode highlightStat={activeStat} /> : <Defeated who="Opponent" />}
        </motion.div>

        <BattleFx fxRound={combat.fxRound} phase={combat.phase} reduced={combat.reduced} onSkip={combat.skip} />
      </motion.div>

      <div style={{ marginTop: 18 }}>
        {showResultButton ? (
          <div style={{ textAlign: 'center' }}>
            <button className="btn btn-primary" style={{ padding: '13px 30px', fontSize: 16 }} onClick={() => dispatch({ type: 'END_BATTLE' })}>
              View result
            </button>
          </div>
        ) : playerTurn && pCard && oCard ? (
          <div>
            <div style={{ textAlign: 'center', marginBottom: 10 }}>
              <div style={{ fontSize: 12, color: 'var(--text-sub)' }}>
                YOUR TURN - choose an action.
              </div>
              <div className="battle-effective-help">
                Effective score = visible stat x type multiplier. <span data-tone="boost">Green</span> is boosted, <span data-tone="nerf">red</span> is reduced. Best winning margin keeps the next action.
              </div>
            </div>
            <div className="battle-stat-grid">
              {STAT_KEYS.map((s) => {
                const pv = previewRound(battle, s);
                const win = pv.pEff >= pv.oEff;
                const initiative = initiativePreview(battle, 'player', s);
                const playerBase = pCard[s];
                const opponentBase = oCard[s];
                return (
                  <button
                    key={s}
                    className="btn battle-stat-button"
                    data-win={win}
                    onClick={() => playPlayerStat(s)}
                  >
                    <span className="battle-stat-name">{STAT_LABEL[s]}</span>
                    <span className="battle-stat-values tabnums">
                      <EffectiveScore base={playerBase} value={pv.pEff} />
                      <span>vs</span>
                      <EffectiveScore base={opponentBase} value={pv.oEff} />
                    </span>
                    <span className="battle-stat-outcome">
                      {win ? (initiative.keepsInitiative ? 'wins + keeps initiative' : 'wins, passes turn') : 'loses round'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div style={{ textAlign: 'center', color: 'var(--text-sub)', fontSize: 13, padding: '10px' }}>
            {combat.active ? 'Resolving clash... tap the arena to skip.' : 'Opponent is choosing a move...'}
          </div>
        )}
      </div>

      <BattleInfo rounds={battle.rounds} />
    </div>
  );
}

function BattleInfo({ rounds }: { rounds: RoundResult[] }) {
  return (
    <div className="battle-info-grid">
      <section className="panel battle-log-panel">
        <div className="battle-panel-head">
          <div>
            <div className="battle-panel-kicker">BATTLE LOG</div>
            <h3>Round history</h3>
          </div>
          <span className="chip">{rounds.length} rounds</span>
        </div>
        <div className="battle-log-list">
          {[...rounds].reverse().map((r) => <RoundLogRow key={r.index} round={r} />)}
          {rounds.length === 0 && <p className="caveat">No rounds yet - attack to begin.</p>}
        </div>
      </section>

      <section className="panel battle-rules-panel">
        <div className="battle-panel-head">
          <div>
            <div className="battle-panel-kicker">RULES</div>
            <h3>How battles work</h3>
          </div>
        </div>
        <ul className="battle-rule-list">
          <li><b>Choose an action.</b> Pick ATK, DEF, or AURA; both cards compare that same visible stat.</li>
          <li><b>Margin matters.</b> If several actions win, the best winning margin keeps initiative for the next action.</li>
          <li><b>PWR is lineup rating.</b> PWR helps compare cards while building a lineup; rounds are decided by the chosen action score.</li>
          <li><b>Higher score wins.</b> If scores tie, the current attacker wins the edge.</li>
          <li><b>Loser is KO.</b> The losing card leaves the lineup. Battle ends when one side has no cards left.</li>
          <li><b>Virtual stake.</b> Starting costs {BATTLE_STAKE} credits; a win pays {WIN_REWARD}. Credits are not real money.</li>
        </ul>
      </section>
    </div>
  );
}

function effectiveTone(base: number, value: number) {
  if (value > base) return 'boost';
  if (value < base) return 'nerf';
  return 'flat';
}

function EffectiveScore({ base, value }: { base: number; value: number }) {
  return (
    <b className="battle-effective-score" data-tone={effectiveTone(base, value)}>
      {value}
    </b>
  );
}

function RoundLogRow({ round }: { round: RoundResult }) {
  const playerWon = round.winner === 'player';
  const attackerLabel = sideLabel(round.attacker);
  const winnerLabel = sideLabel(round.winner);
  const loserLabel = sideLabel(round.loser);

  return (
    <div className="battle-log-row anim-fade" data-winner={round.winner}>
      <span className="battle-log-index">{round.index + 1}</span>
      <div className="battle-log-main">
        <div className="battle-log-title">
          <span>{attackerLabel} chose {STAT_LABEL[round.stat]}</span>
          <span className={playerWon ? 'battle-log-win' : 'battle-log-loss'}>{winnerLabel} won</span>
        </div>
        <div className="battle-log-score tabnums">
          <span>You <EffectiveScore base={round.playerBase} value={round.playerEff} /></span>
          <span>vs</span>
          <span>Opponent <EffectiveScore base={round.opponentBase} value={round.opponentEff} /></span>
          <span className="battle-log-ko">{loserLabel} card KO</span>
          <span className="battle-log-initiative">{round.initiativeKept ? `${attackerLabel} keeps initiative` : 'Initiative passes'}</span>
        </div>
        <div className="battle-log-note mono">{round.typeNote}</div>
      </div>
    </div>
  );
}

function sideLabel(side: Side) {
  return side === 'player' ? 'You' : 'Opponent';
}

function TypeArrow({ p, o }: { p: GameCard; o: GameCard }) {
  const v = typeVerdict(p.element, o.element);
  const color = v === 'advantage' ? 'var(--win)' : v === 'disadvantage' ? 'var(--loss)' : 'var(--text-dim)';
  const label = v === 'advantage' ? 'You counter' : v === 'disadvantage' ? 'You are countered' : 'Neutral';
  return (
    <div style={{ marginTop: 10, fontSize: 11, color }}>
      <div style={{ fontSize: 18 }}>{ELEMENT_GLYPH[p.element]} {v === 'advantage' ? '>' : v === 'disadvantage' ? '<' : '='} {ELEMENT_GLYPH[o.element]}</div>
      <div style={{ letterSpacing: '0.06em' }}>{label}</div>
    </div>
  );
}

function Defeated({ who }: { who: string }) {
  return (
    <div style={{ aspectRatio: '2.5/4', maxWidth: 280, border: '1.5px dashed var(--hairline)', borderRadius: 14, display: 'grid', placeItems: 'center', color: 'var(--text-dim)', margin: '0 auto', width: '100%' }}>
      {who}: no cards left
    </div>
  );
}
