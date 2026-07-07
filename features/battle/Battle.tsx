'use client';

import { useEffect, useRef, useState } from 'react';
import { useArena, useArenaDispatch } from '@/app/arena/state';
import { Slab } from '@/components/Slab';
import {
  previewRound, chooseStatGreedy,
  STAT_KEYS, STAT_LABEL, type StatKey,
} from '@/lib/game/battle';
import type { GameCard } from '@/lib/game/stats';
import { ELEMENT_GLYPH, typeVerdict } from '@/lib/game/stats';

function Pips({ n, side }: { n: number; side: 'p' | 'o' }) {
  return (
    <div style={{ display: 'flex', gap: 5, flexDirection: side === 'p' ? 'row' : 'row-reverse' }}>
      {Array.from({ length: 5 }).map((_, i) => (
        <span key={i} style={{
          width: 14, height: 14, borderRadius: 4,
          background: i < n ? (side === 'p' ? 'var(--accent)' : 'var(--loss)') : 'rgba(255,255,255,0.08)',
          boxShadow: i < n ? `0 0 8px ${side === 'p' ? 'var(--accent)' : 'var(--loss)'}` : 'none',
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
  const prevRounds = useRef(0);

  // Flash the stat that was just compared.
  useEffect(() => {
    if (!battle) return;
    if (battle.rounds.length > prevRounds.current) {
      const last = battle.rounds[battle.rounds.length - 1];
      setFlashStat(last.stat);
      const t = setTimeout(() => setFlashStat(null), 750);
      prevRounds.current = battle.rounds.length;
      return () => clearTimeout(t);
    }
    prevRounds.current = battle.rounds.length;
  }, [battle?.rounds.length, battle]);

  // Opponent turn: greedy choice after a short beat.
  useEffect(() => {
    if (!battle || battle.status !== 'ongoing' || battle.attacker !== 'opponent') return;
    const t = setTimeout(() => {
      dispatch({ type: 'BATTLE_STEP', stat: chooseStatGreedy(battle, 'opponent') });
    }, 950);
    return () => clearTimeout(t);
  }, [battle, dispatch]);

  if (!battle) return null;
  const over = battle.status !== 'ongoing';
  const pCard: GameCard | undefined = battle.playerQueue[0];
  const oCard: GameCard | undefined = battle.opponentQueue[0];
  const lastRound = battle.rounds[battle.rounds.length - 1];
  const playerTurn = battle.attacker === 'player' && !over;

  return (
    <div className="anim-fade" style={{ maxWidth: 1100, margin: '0 auto', padding: '20px 22px 60px' }}>
      {/* HP pips */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', letterSpacing: '0.12em', marginBottom: 5 }}>YOUR DECK</div>
          <Pips n={battle.playerQueue.length} side="p" />
        </div>
        <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-dim)' }}>
          Turn {battle.rounds.length + (over ? 0 : 1)}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', letterSpacing: '0.12em', marginBottom: 5 }}>OPPONENT (AI)</div>
          <Pips n={battle.opponentQueue.length} side="o" />
        </div>
      </div>

      {/* Bàn kính đối đầu */}
      <div className="panel" style={{ padding: 20, position: 'relative', overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 18, alignItems: 'center' }}>
          <div style={{ maxWidth: 210, marginLeft: 'auto', width: '100%', position: 'relative' }}>
            {pCard ? <Slab card={pCard} interactive={false} highlightStat={flashStat} /> : <Defeated who="You" />}
            {flashStat && pCard && <span className="sweep-overlay" />}
          </div>

          <div style={{ textAlign: 'center', minWidth: 120 }}>
            {over ? (
              <div className={battle.status === 'player_win' ? 'anim-win' : 'anim-loss'}>
                <div style={{ fontSize: 40 }}>{battle.status === 'player_win' ? '🏆' : '💀'}</div>
                <div style={{ fontWeight: 900, color: battle.status === 'player_win' ? 'var(--win)' : 'var(--loss)' }}>
                  {battle.status === 'player_win' ? 'WIN' : 'LOSS'}
                </div>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--text-dim)' }}>VS</div>
                {pCard && oCard && (
                  <TypeArrow p={pCard} o={oCard} />
                )}
              </>
            )}
          </div>

          <div style={{ maxWidth: 210, width: '100%', position: 'relative' }}>
            {oCard ? <Slab card={oCard} interactive={false} highlightStat={flashStat} /> : <Defeated who="Opponent" />}
            {flashStat && oCard && <span className="sweep-overlay" />}
          </div>
        </div>

        {/* Action bar */}
        <div style={{ marginTop: 20 }}>
          {over ? (
            <div style={{ textAlign: 'center' }}>
              <button className="btn btn-primary" style={{ padding: '13px 30px', fontSize: 16 }} onClick={() => dispatch({ type: 'END_BATTLE' })}>
                View result →
              </button>
            </div>
          ) : playerTurn && pCard && oCard ? (
            <div>
              <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-sub)', marginBottom: 10 }}>
                YOUR TURN — choose a stat to attack with. Type advantage can swing the round:
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, maxWidth: 560, margin: '0 auto' }}>
                {STAT_KEYS.map((s) => {
                  const pv = previewRound(battle, s);
                  const win = pv.pEff >= pv.oEff;
                  return (
                    <button
                      key={s}
                      className="btn"
                      style={{ flexDirection: 'column', gap: 4, padding: '12px 8px', borderColor: win ? 'var(--win)' : 'var(--hairline-strong)' }}
                      onClick={() => dispatch({ type: 'BATTLE_STEP', stat: s })}
                    >
                      <span style={{ fontWeight: 800, letterSpacing: '0.06em' }}>{STAT_LABEL[s]}</span>
                      <span className="tabnums" style={{ fontSize: 13 }}>
                        <b style={{ color: win ? 'var(--win)' : 'var(--text)' }}>{pv.pEff}</b>
                        <span style={{ color: 'var(--text-dim)' }}> vs </span>
                        <b style={{ color: !win ? 'var(--loss)' : 'var(--text-sub)' }}>{pv.oEff}</b>
                      </span>
                      <span style={{ fontSize: 9, color: 'var(--text-dim)' }}>{win ? 'wins round' : 'loses round'}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', color: 'var(--text-sub)', fontSize: 13, padding: '10px' }}>
              <span className="anim-float" style={{ display: 'inline-block' }}>⚙</span> Opponent is choosing a move...
            </div>
          )}
        </div>
      </div>

      {/* Why each round resolved the way it did */}
      <div style={{ marginTop: 18 }}>
        <div style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--text-dim)', marginBottom: 8 }}>BATTLE LOG — WHY EACH ROUND WON</div>
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
          {battle.rounds.length === 0 && <p className="caveat">No rounds yet — attack to begin.</p>}
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
    <div style={{ marginTop: 8, fontSize: 11, color }}>
      <div style={{ fontSize: 16 }}>{ELEMENT_GLYPH[p.element]} {v === 'advantage' ? '≻' : v === 'disadvantage' ? '≺' : '='} {ELEMENT_GLYPH[o.element]}</div>
      <div style={{ letterSpacing: '0.06em' }}>{label}</div>
    </div>
  );
}

function Defeated({ who }: { who: string }) {
  return (
    <div style={{ aspectRatio: '2.5/4', maxWidth: 210, border: '1.5px dashed var(--hairline)', borderRadius: 14, display: 'grid', placeItems: 'center', color: 'var(--text-dim)', margin: '0 auto', width: '100%' }}>
      {who}: no cards left
    </div>
  );
}
