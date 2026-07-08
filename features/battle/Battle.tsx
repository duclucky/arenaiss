'use client';

import { useEffect, useRef, useState } from 'react';
import { useArena, useArenaDispatch } from '@/app/arena/state';
import { Slab } from '@/components/Slab';
import {
  chooseStatGreedy,
  previewRound,
  STAT_KEYS,
  STAT_LABEL,
  type StatKey,
  type RoundResult,
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
  const [flashStat, setFlashStat] = useState<StatKey | null>(null);
  const [lastRound, setLastRound] = useState<RoundResult | null>(null);
  const prevRounds = useRef(0);

  useEffect(() => {
    if (!battle) return;
    if (battle.rounds.length > prevRounds.current) {
      const last = battle.rounds[battle.rounds.length - 1];
      setFlashStat(last.stat);
      setLastRound(last);
      const t = setTimeout(() => setFlashStat(null), 900);
      prevRounds.current = battle.rounds.length;
      return () => clearTimeout(t);
    }
    prevRounds.current = battle.rounds.length;
  }, [battle?.rounds.length, battle]);

  useEffect(() => {
    if (!battle || battle.status !== 'ongoing' || battle.attacker !== 'opponent') return;
    const t = setTimeout(() => {
      dispatch({ type: 'BATTLE_STEP', stat: chooseStatGreedy(battle, 'opponent') });
    }, 1050);
    return () => clearTimeout(t);
  }, [battle, dispatch]);

  if (!battle) return null;
  const over = battle.status !== 'ongoing';
  const pCard: GameCard | undefined = battle.playerQueue[0];
  const oCard: GameCard | undefined = battle.opponentQueue[0];
  const playerTurn = battle.attacker === 'player' && !over;
  const turn = battle.rounds.length + (over ? 0 : 1);

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

      <div className="battle-arena panel">
        <div className="battle-card-wrap battle-card-player" data-active={battle.attacker === 'player' && !over} data-win={lastRound?.winner === 'player' && !!flashStat}>
          <div className="battle-role-chip">{battle.attacker === 'player' && !over ? 'ATTACKING' : 'DEFENDING'}</div>
          {pCard ? <Slab card={pCard} interactive={false} battleMode highlightStat={flashStat} /> : <Defeated who="You" />}
        </div>

        <div className="battle-center">
          {over ? (
            <div className={battle.status === 'player_win' ? 'anim-win' : 'anim-loss'}>
              <div className="battle-clash-title">{battle.status === 'player_win' ? 'VICTORY' : 'DEFEAT'}</div>
            </div>
          ) : (
            <>
              <div className="battle-clash-title">{flashStat ? `${STAT_LABEL[flashStat]} CLASH` : 'VS'}</div>
              {pCard && oCard && <TypeArrow p={pCard} o={oCard} />}
              {lastRound && (
                <div className="battle-last-hit">
                  {lastRound.winner === 'player' ? 'You won' : 'Opponent won'} with {STAT_LABEL[lastRound.stat]}
                </div>
              )}
            </>
          )}
        </div>

        <div className="battle-card-wrap battle-card-opponent" data-active={battle.attacker === 'opponent' && !over} data-win={lastRound?.winner === 'opponent' && !!flashStat}>
          <div className="battle-role-chip">{battle.attacker === 'opponent' && !over ? 'ATTACKING' : 'DEFENDING'}</div>
          {oCard ? <Slab card={oCard} interactive={false} battleMode highlightStat={flashStat} /> : <Defeated who="Opponent" />}
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        {over ? (
          <div style={{ textAlign: 'center' }}>
            <button className="btn btn-primary" style={{ padding: '13px 30px', fontSize: 16 }} onClick={() => dispatch({ type: 'END_BATTLE' })}>
              View result
            </button>
          </div>
        ) : playerTurn && pCard && oCard ? (
          <div>
            <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-sub)', marginBottom: 10 }}>
              YOUR TURN - choose the attack stat. Type advantage can swing the round.
            </div>
            <div className="battle-stat-grid">
              {STAT_KEYS.map((s) => {
                const pv = previewRound(battle, s);
                const win = pv.pEff >= pv.oEff;
                return (
                  <button
                    key={s}
                    className="btn battle-stat-button"
                    data-win={win}
                    onClick={() => dispatch({ type: 'BATTLE_STEP', stat: s })}
                  >
                    <span className="battle-stat-name">{STAT_LABEL[s]}</span>
                    <span className="battle-stat-values tabnums">
                      <b>{pv.pEff}</b>
                      <span>vs</span>
                      <b>{pv.oEff}</b>
                    </span>
                    <span className="battle-stat-outcome">{win ? 'wins round' : 'loses round'}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div style={{ textAlign: 'center', color: 'var(--text-sub)', fontSize: 13, padding: '10px' }}>
            Opponent is choosing a move...
          </div>
        )}
      </div>

      <div style={{ marginTop: 18 }}>
        <div style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--text-dim)', marginBottom: 8 }}>BATTLE LOG - WHY EACH ROUND WON</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
          {[...battle.rounds].reverse().map((r) => (
            <div key={r.index} className="panel anim-fade" style={{ padding: '9px 12px', display: 'flex', gap: 10, alignItems: 'center' }}>
              <span style={{ width: 22, height: 22, borderRadius: 6, display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 800, background: r.winner === 'player' ? 'rgba(47,211,165,0.15)' : 'rgba(255,107,107,0.15)', color: r.winner === 'player' ? 'var(--win)' : 'var(--loss)' }}>
                {r.index + 1}
              </span>
              <span style={{ fontSize: 12.5, color: 'var(--text-sub)', flex: 1 }}>{r.reason}</span>
              <span className="mono" style={{ fontSize: 10, color: 'var(--text-dim)' }}>{r.typeNote}</span>
            </div>
          ))}
          {battle.rounds.length === 0 && <p className="caveat">No rounds yet - attack to begin.</p>}
        </div>
      </div>
    </div>
  );
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
