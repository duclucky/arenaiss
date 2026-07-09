'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useArena, useArenaDispatch } from '@/app/arena/state';
import { Slab } from '@/components/Slab';
import type { PackReveal } from '@/lib/game/gacha';
import type { Tier } from '@/lib/game/stats';

const RANK: Record<Tier, number> = { TOP: 0, S: 1, A: 2, B: 3, C: 4, D: 5 };
const TIER_SHOUT: Record<Tier, string> = {
  TOP: 'LEGENDARY! A Top-tier card entered your roster.',
  S: 'ULTRA RARE! A tier S card appeared.',
  A: 'Rare hit! A tier A card joined the run.',
  B: 'Solid pull - a tier B card.',
  C: 'A tier C card joined the roster.',
  D: 'A starter card joined the roster.',
};

export function PackOpen() {
  const state = useArena();
  const pack = state.lastPack;

  if (!pack) return null;
  return <PackOpenSequence key={pack.seed} pack={pack} />;
}

function PackOpenSequence({ pack }: { pack: PackReveal }) {
  const state = useArena();
  const dispatch = useArenaDispatch();
  const order = useMemo(() => [...pack.cards].sort((a, b) => RANK[b.tier] - RANK[a.tier]), [pack]);
  const [phase, setPhase] = useState<'charging' | 'revealing' | 'done'>('charging');
  const [revealed, setRevealed] = useState(0);
  const [flash, setFlash] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];

    const t0 = setTimeout(() => setPhase('revealing'), 650);
    timers.current.push(t0);

    let acc = 780;
    order.forEach((card, i) => {
      const isLast = i === order.length - 1;
      acc += isLast ? 620 : 300;
      const t = setTimeout(() => {
        setRevealed(i + 1);
        if (isLast && (card.tier === 'TOP' || card.tier === 'S')) {
          setFlash(true);
          timers.current.push(setTimeout(() => setFlash(false), 500));
        }
        if (isLast) timers.current.push(setTimeout(() => setPhase('done'), 450));
      }, acc);
      timers.current.push(t);
    });
    return () => timers.current.forEach(clearTimeout);
    // Component is keyed by pack.seed, so mount resets animation state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const topTier = pack.topTier;

  return (
    <div className="anim-fade" style={{ maxWidth: pack.size === 1 ? 560 : 1000, margin: '0 auto', padding: '30px 22px 60px', position: 'relative' }}>
      {flash && (
        <div style={{
          position: 'fixed',
          inset: 0,
          zIndex: 30,
          pointerEvents: 'none',
          background: 'radial-gradient(circle at center, rgba(245,179,1,0.35), transparent 60%)',
          animation: 'fadeIn 0.2s ease',
        }} />
      )}

      {phase === 'charging' ? (
        <div className="pack-stage" data-tier={topTier}>
          <div
            className="pack-visual anim-shake"
          >
            <span className="pack-burst-ring" />
            <span className="pack-crack pack-crack-a" />
            <span className="pack-crack pack-crack-b" />
            <span className="pack-crack pack-crack-c" />
            <span className="pack-core">{pack.packName}</span>
            {Array.from({ length: 12 }).map((_, i) => (
              <span key={i} className="pack-spark" style={{ '--i': i } as CSSProperties} />
            ))}
          </div>
          <p className="pack-stage-copy">The vault seal is breaking...</p>
        </div>
      ) : (
        <>
          <div className="pack-result-title" style={{ textAlign: 'center', marginBottom: 22 }}>
            <div data-tier={topTier} style={{ display: 'inline-block' }}>
              <div style={{ fontSize: 12, color: 'var(--text-dim)', letterSpacing: '0.14em' }}>{pack.packName.toUpperCase()} RESULT</div>
              <h2 style={{ margin: '6px 0 0', color: 'var(--tier)', fontSize: 22 }}>{TIER_SHOUT[topTier]}</h2>
              <p className="caveat" style={{ marginTop: 8 }}>Tap any card to view its real Card Passport.</p>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${order.length}, minmax(0, 1fr))`, gap: 14, alignItems: 'stretch' }}>
            {order.map((card, i) => (
              <div
                key={card.tokenId}
                className="pack-reveal-card"
                data-tier={card.tier}
                style={{
                  visibility: i < revealed ? 'visible' : 'hidden',
                  position: 'relative',
                  maxWidth: pack.size === 1 ? 260 : undefined,
                  margin: '0 auto',
                  width: '100%',
                  animationDelay: `${i * 90}ms`,
                }}
              >
                {i < revealed && <span className="pack-card-flare" />}
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
              <button className="btn" onClick={() => dispatch({ type: 'GOTO', screen: 'roster' })}>Add to roster</button>
              <button className="btn btn-primary" onClick={() => dispatch({ type: 'GOTO', screen: 'deck' })}>Build lineup & battle</button>
              <button className="btn btn-ghost" onClick={() => dispatch({ type: 'GOTO', screen: 'intro' })}>Open another pack</button>
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
