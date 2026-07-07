'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useArena, useArenaDispatch } from '@/app/arena/state';
import { Slab } from '@/components/Slab';
import { openPack, oddsTable, PACK_COST } from '@/lib/game/gacha';
import { makePackSeed } from '@/lib/client/pack';
import type { Tier } from '@/lib/game/stats';

const RANK: Record<Tier, number> = { TOP: 0, S: 1, A: 2, B: 3, C: 4, D: 5 };
const TIER_SHOUT: Record<Tier, string> = {
  TOP: 'LEGENDARY! A Top-tier card entered your vault.',
  S: 'ULTRA RARE! A tier S card appeared.',
  A: 'Rare hit! A tier A card joined the run.',
  B: 'Solid pull — a tier B card.',
  C: 'A tier C card for the collection.',
  D: 'A common card to get started.',
};

export function PackOpen() {
  const state = useArena();
  const dispatch = useArenaDispatch();
  const pack = state.lastPack;

  // Reveal common cards first and keep the rarest hit for the final beat.
  const order = useMemo(() => {
    if (!pack) return [];
    return [...pack.cards].sort((a, b) => RANK[b.tier] - RANK[a.tier]);
  }, [pack]);

  const [phase, setPhase] = useState<'charging' | 'revealing' | 'done'>('charging');
  const [revealed, setRevealed] = useState(0);
  const [flash, setFlash] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Add anticipation before the final reveal.
  useEffect(() => {
    if (!pack) return;
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setPhase('charging');
    setRevealed(0);
    setFlash(false);

    const t0 = setTimeout(() => setPhase('revealing'), 750);
    timers.current.push(t0);

    let acc = 900;
    order.forEach((card, i) => {
      const isLast = i === order.length - 1;
      const gap = isLast ? 720 : 330;
      acc += gap;
      const t = setTimeout(() => {
        setRevealed(i + 1);
        if (isLast && (card.tier === 'TOP' || card.tier === 'S')) {
          setFlash(true);
          timers.current.push(setTimeout(() => setFlash(false), 500));
        }
        if (isLast) timers.current.push(setTimeout(() => setPhase('done'), 500));
      }, acc);
      timers.current.push(t);
    });
    return () => timers.current.forEach(clearTimeout);
  }, [order, pack]);

  if (!pack) return null;
  const topTier = pack.topTier;
  const canOpenAnother = state.pool.length > 0 && state.credits >= PACK_COST;

  function openAnother() {
    if (!canOpenAnother) return;
    const reveal = openPack(state.pool, makePackSeed(state.packCount));
    dispatch({ type: 'OPEN_PACK', reveal, openedAt: new Date().toISOString() });
  }

  return (
    <div className="anim-fade" style={{ maxWidth: 1000, margin: '0 auto', padding: '30px 22px 60px', position: 'relative' }}>
      {flash && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 30, pointerEvents: 'none',
          background: 'radial-gradient(circle at center, rgba(245,179,1,0.35), transparent 60%)',
          animation: 'fadeIn 0.2s ease',
        }} />
      )}

      {phase === 'charging' ? (
        <div style={{ textAlign: 'center', padding: '70px 0' }}>
          <div
            className="anim-shake"
            data-tier={topTier}
            style={{
              width: 150, height: 210, margin: '0 auto', borderRadius: 16,
              background: 'linear-gradient(160deg, var(--raised), #0d1016)',
              border: '1px solid var(--tier)',
              boxShadow: '0 0 50px rgba(from var(--tier) r g b / 0.6), inset 0 0 40px rgba(from var(--tier) r g b / 0.2)',
              display: 'grid', placeItems: 'center', fontSize: 46,
            }}
          >
            🎴
          </div>
          <p style={{ color: 'var(--text-sub)', marginTop: 22, letterSpacing: '0.1em' }}>The pack is cracking open...</p>
        </div>
      ) : (
        <>
          <div style={{ textAlign: 'center', marginBottom: 22 }}>
            <div data-tier={topTier} style={{ display: 'inline-block' }}>
              <div style={{ fontSize: 12, color: 'var(--text-dim)', letterSpacing: '0.14em' }}>SIMULATED PACK RESULT</div>
              <h2 style={{ margin: '6px 0 0', color: 'var(--tier)', fontSize: 22 }}>{TIER_SHOUT[topTier]}</h2>
              <p className="caveat" style={{ marginTop: 8 }}>Tap any card to view its real Card Passport.</p>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${order.length}, 1fr)`, gap: 14, alignItems: 'stretch' }}>
            {order.map((card, i) => (
              <div key={card.tokenId} style={{ visibility: i < revealed ? 'visible' : 'hidden', position: 'relative' }}>
                {i < revealed && (card.tier === 'TOP' || card.tier === 'S') && <span className="sweep-overlay" />}
                <Slab
                  card={card}
                  reveal={i < revealed}
                  onClick={(c) => dispatch({ type: 'OPEN_PASSPORT', tokenId: c.tokenId })}
                />
              </div>
            ))}
          </div>

          {phase === 'done' && (
            <div className="anim-fade" style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 30, flexWrap: 'wrap' }}>
              <button className="btn" onClick={() => dispatch({ type: 'GOTO', screen: 'roster' })}>Add to collection →</button>
              <button className="btn btn-primary" onClick={() => dispatch({ type: 'GOTO', screen: 'deck' })}>Build deck & battle</button>
              <button className="btn btn-ghost" disabled={!canOpenAnother} onClick={openAnother}>
                {canOpenAnother ? `Open another · ${PACK_COST}` : 'Out of credits'}
              </button>
            </div>
          )}
          {!state.passportHintSeen && phase === 'done' && (
            <p className="caveat anim-fade" style={{ textAlign: 'center', marginTop: 18 }}>
              Tap any card to view its real Card Passport.
              <button className="btn btn-ghost" style={{ marginLeft: 8, padding: '3px 8px', fontSize: 10 }} onClick={() => dispatch({ type: 'DISMISS_PASSPORT_HINT' })}>
                Got it
              </button>
            </p>
          )}
          <p className="caveat" style={{ textAlign: 'center', marginTop: 10 }}>
            These are fictional gameplay stats based on real graded-card data, not valuation or investment advice.
          </p>
        </>
      )}
    </div>
  );
}
