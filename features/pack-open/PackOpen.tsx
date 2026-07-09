'use client';

import { AnimatePresence, motion, type Variants } from 'framer-motion';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useArena, useArenaDispatch } from '@/app/arena/state';
import { Slab } from '@/components/Slab';
import type { PackReveal } from '@/lib/game/gacha';
import type { Tier } from '@/lib/game/stats';

type OpenPhase = 'charge' | 'crack' | 'burst' | 'spotlight' | 'reveal' | 'settle';

const RANK: Record<Tier, number> = { TOP: 0, S: 1, A: 2, B: 3, C: 4, D: 5 };
const TIER_COLORS: Record<Tier, string> = {
  TOP: '#f5b301',
  S: '#a277ff',
  A: '#4c8dff',
  B: '#2fd3a5',
  C: '#8a93a0',
  D: '#5a626e',
};
const TIER_SHOUT: Record<Tier, string> = {
  TOP: 'LEGENDARY! Top-tier pull.',
  S: 'ULTRA RARE! Tier S revealed.',
  A: 'Rare hit! Tier A joins the roster.',
  B: 'Solid pull - tier B.',
  C: 'Tier C joined the roster.',
  D: 'Starter pull secured.',
};
const INTENSITY: Record<Tier, { charge: number; crack: number; burst: number; cardStagger: number; particles: number; slowMo: boolean }> = {
  TOP: { charge: 960, crack: 560, burst: 720, cardStagger: 190, particles: 64, slowMo: true },
  S: { charge: 900, crack: 520, burst: 680, cardStagger: 175, particles: 56, slowMo: true },
  A: { charge: 820, crack: 470, burst: 620, cardStagger: 150, particles: 42, slowMo: false },
  B: { charge: 740, crack: 430, burst: 560, cardStagger: 130, particles: 34, slowMo: false },
  C: { charge: 640, crack: 360, burst: 500, cardStagger: 105, particles: 24, slowMo: false },
  D: { charge: 560, crack: 320, burst: 450, cardStagger: 90, particles: 20, slowMo: false },
};
const FX = {
  holdBeforeBurst: 110,
  spotlight: 1050,
  revealLead: 160,
  settleDelay: 420,
  easing: {
    charge: [0.16, 1, 0.3, 1] as const,
    burst: [0.06, 0.9, 0.18, 1] as const,
    card: [0.18, 0.9, 0.18, 1] as const,
  },
};

const packVariants: Variants = {
  charge: {
    y: [0, -7, 0],
    rotate: [0, -0.8, 0.8, 0],
    scale: [1, 1.035, 1],
    transition: { duration: 1.35, ease: FX.easing.charge, repeat: Infinity, repeatType: 'mirror' },
  },
  crack: {
    y: [0, -12, -6, -14, 0],
    x: [0, -3, 4, -2, 0],
    rotate: [0, -1.5, 1.8, -1, 0],
    scale: [1.04, 1.1, 1.08, 1.13, 1.1],
    transition: { duration: 0.58, ease: 'anticipate' },
  },
  burst: {
    opacity: 0.14,
    scale: 1.18,
    y: -44,
    filter: 'brightness(2.2) saturate(1.1)',
    transition: { duration: 0.34, ease: FX.easing.burst },
  },
  spotlight: {
    opacity: 0.06,
    scale: 1.28,
    y: -58,
    filter: 'brightness(2.8) saturate(1.2) blur(1px)',
    transition: { duration: 0.28, ease: FX.easing.burst },
  },
};

const halfVariants: Variants = {
  closed: (side: 'left' | 'right') => ({
    x: side === 'left' ? -26 : 26,
    rotate: side === 'left' ? -3 : 3,
    opacity: 1,
  }),
  burst: (side: 'left' | 'right') => ({
    x: side === 'left' ? -165 : 165,
    y: side === 'left' ? -42 : -58,
    rotate: side === 'left' ? -18 : 18,
    opacity: 0,
    transition: { duration: 0.42, ease: FX.easing.burst },
  }),
};

const cardVariants: Variants = {
  hidden: (custom: { index: number; total: number }) => ({
    opacity: 0,
    x: (custom.index - (custom.total - 1) / 2) * -42,
    y: 170,
    scale: 0.58,
    rotate: (custom.index - (custom.total - 1) / 2) * -5,
    rotateY: 76,
    filter: 'brightness(1.55) blur(1.6px)',
  }),
  show: (custom: { index: number; total: number; delay: number; rare: boolean }) => ({
    opacity: 1,
    x: 0,
    y: 0,
    scale: custom.rare ? [0.66, 1.08, 1] : [0.72, 1.03, 1],
    rotate: 0,
    rotateY: 0,
    filter: 'brightness(1) blur(0px)',
    transition: {
      delay: custom.delay / 1000,
      duration: custom.rare ? 0.78 : 0.56,
      ease: FX.easing.card,
    },
  }),
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
  const reducedMotion = false; // Bypassing OS accessibility setting to ensure effects run
  const topTier = pack.topTier;
  const intensity = INTENSITY[topTier];
  const order = useMemo(
    () => [...pack.cards].sort((a, b) => RANK[b.tier] - RANK[a.tier] || a.power - b.power),
    [pack.cards],
  );
  const [phase, setPhase] = useState<OpenPhase>(reducedMotion ? 'reveal' : 'charge');
  const [skipped, setSkipped] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];

    if (reducedMotion) {
      timers.current.push(setTimeout(() => setPhase('settle'), 900));
      return () => timers.current.forEach(clearTimeout);
    }

    const crackAt = intensity.charge;
    const burstAt = crackAt + intensity.crack + FX.holdBeforeBurst;
    const spotlightAt = burstAt + intensity.burst;
    const revealAt = spotlightAt + FX.spotlight + FX.revealLead;
    const settleAt = revealAt + order.length * intensity.cardStagger + (intensity.slowMo ? 930 : 680) + FX.settleDelay;

    timers.current.push(setTimeout(() => setPhase('crack'), crackAt));
    timers.current.push(setTimeout(() => setPhase('burst'), burstAt));
    timers.current.push(setTimeout(() => setPhase('spotlight'), spotlightAt));
    timers.current.push(setTimeout(() => setPhase('reveal'), revealAt));
    timers.current.push(setTimeout(() => setPhase('settle'), settleAt));

    return () => timers.current.forEach(clearTimeout);
  }, [intensity, order.length, reducedMotion]);

  function skip() {
    if (phase === 'settle') return;
    timers.current.forEach(clearTimeout);
    setSkipped(true);
    setPhase('settle');
  }

  const showCards = phase === 'reveal' || phase === 'settle';
  const spotlightCard = order[order.length - 1];
  const rareToken = spotlightCard?.tokenId;
  const shellPhase = phase === 'burst' || phase === 'spotlight' ? 'burst' : 'closed';
  const showCardShowcase = (phase === 'burst' || phase === 'spotlight') && spotlightCard;
  const cssVars = {
    '--pack-tier': TIER_COLORS[topTier],
    '--pack-tier-rgb': hexToRgbStr(TIER_COLORS[topTier]),
    '--pack-tier-soft': `${TIER_COLORS[topTier]}66`,
  } as CSSProperties;

  return (
    <div
      className="cinematic-pack-shell anim-fade"
      data-tier={topTier}
      data-pack-phase={phase}
      data-skipped={skipped ? 'true' : 'false'}
      style={cssVars}
      onPointerDown={phase !== 'settle' ? skip : undefined}
      role="presentation"
    >
      <div className="cinematic-vignette" />
      <div className="cinematic-spotlight" />
      <ParticleCanvas active={!reducedMotion && (phase === 'burst' || phase === 'spotlight')} tier={topTier} count={intensity.particles} />

      <AnimatePresence mode="wait">
        {!showCards ? (
          <motion.div
            key="ritual"
            className="cinematic-pack-stage pack-stage"
            data-pack-phase={phase}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1.05, transition: { duration: 0.18 } }}
          >
            <motion.div
              className="cinematic-pack-object pack-visual"
              variants={packVariants}
              animate={phase}
            >
              <motion.div className="cinematic-pack-aura" animate={{ scale: phase === 'crack' ? 1.14 : 1, opacity: phase === 'charge' ? 0.42 : 0.76 }} />
              <div className="cinematic-pack-shadow" />
              <div className="cinematic-pack-face">
                <span className="cinematic-pack-foil cinematic-pack-foil-a" />
                <span className="cinematic-pack-foil cinematic-pack-foil-b" />
                <span className="cinematic-pack-foil cinematic-pack-foil-c" />
                <span className="cinematic-pack-rail cinematic-pack-rail-top" />
                <span className="cinematic-pack-rail cinematic-pack-rail-bottom" />
              </div>
              <motion.div className="cinematic-pack-half cinematic-pack-half-left" custom="left" variants={halfVariants} animate={shellPhase} />
              <motion.div className="cinematic-pack-half cinematic-pack-half-right" custom="right" variants={halfVariants} animate={shellPhase} />
              <motion.div
                className="cinematic-vault-seal"
                animate={{
                  rotate: phase === 'charge' ? [0, 360] : phase === 'crack' ? [0, 18, -12, 0] : 0,
                  scale: phase === 'crack' ? [1, 1.08, 0.98, 1.12] : 1,
                }}
                transition={phase === 'charge' ? { duration: 4.8, ease: 'linear', repeat: Infinity } : { duration: 0.48, ease: 'anticipate' }}
              >
                <span className="cinematic-seal-core">RA</span>
              </motion.div>
              <motion.div
                className="cinematic-lock-bar"
                animate={{ scaleX: phase === 'charge' ? [0.2, 1, 0.2] : phase === 'crack' ? [1, 0.45, 1] : 1 }}
                transition={{ duration: phase === 'charge' ? 1.6 : 0.42, ease: 'easeInOut', repeat: phase === 'charge' ? Infinity : 0 }}
              />
              <motion.svg className="cinematic-crack" viewBox="0 0 120 180" aria-hidden="true">
                <motion.path
                  d="M62 10 L54 34 L68 52 L49 80 L64 105 L46 136 L56 170"
                  fill="none"
                  stroke="white"
                  strokeWidth="3"
                  strokeLinecap="round"
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: phase === 'charge' ? 0.18 : 1, opacity: phase === 'charge' ? 0.28 : 1 }}
                  transition={{ duration: phase === 'charge' ? 0.7 : 0.42, ease: 'easeOut' }}
                />
                <motion.path
                  d="M63 66 L83 82 M58 116 L78 130 M55 38 L38 55"
                  fill="none"
                  stroke="white"
                  strokeWidth="2"
                  strokeLinecap="round"
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: phase === 'charge' ? 0 : 1, opacity: phase === 'charge' ? 0 : 0.9 }}
                  transition={{ duration: 0.3, delay: 0.16, ease: 'easeOut' }}
                />
              </motion.svg>
              <div className="cinematic-inner-light" />
              <div className="cinematic-pack-name">{pack.packName}</div>
            </motion.div>
            {(phase === 'burst' || phase === 'spotlight') && (
              <>
                {phase === 'burst' && (
                  <motion.div
                    className="cinematic-burst pack-explosion"
                    initial={{ opacity: 0, scale: 0.22 }}
                    animate={{ opacity: [0, 1, 1, 0.72], scale: [0.28, 1, 1.08, 1.18] }}
                    transition={{ duration: intensity.burst / 1000, ease: FX.easing.burst }}
                  >
                    <span className="cinematic-burst-core" />
                    <span className="cinematic-shockwave" />
                    <span className="cinematic-flash-card" />
                    {Array.from({ length: 14 }).map((_, index) => (
                      <span key={index} className="cinematic-foil-chip" style={{ '--chip': index } as CSSProperties} />
                    ))}
                  </motion.div>
                )}
                {phase === 'spotlight' && (
                  <motion.div
                    className="cinematic-showcase-field"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.3, ease: FX.easing.burst }}
                  >
                    <span className="cinematic-showcase-ring cinematic-showcase-ring-a" />
                    <span className="cinematic-showcase-ring cinematic-showcase-ring-b" />
                    {Array.from({ length: 18 }).map((_, index) => (
                      <span key={index} className="cinematic-light-lance" style={{ '--ray': index } as CSSProperties} />
                    ))}
                  </motion.div>
                )}
                {showCardShowcase && (
                  <motion.div
                    className={`cinematic-emerge-card${phase === 'spotlight' ? ' cinematic-spotlight-card' : ''}`}
                    data-tier={spotlightCard.tier}
                    initial={{ opacity: 0, y: 128, scale: 0.42, rotateY: 78, rotateZ: -5 }}
                    animate={phase === 'spotlight'
                      ? {
                        opacity: 1,
                        y: [-96, -116, -108],
                        scale: [1.08, 1.24, 1.2],
                        rotateY: 0,
                        rotateZ: [0, -1.2, 0.8, 0],
                      }
                      : {
                        opacity: [0, 1, 1, 0.98],
                        y: [128, -72, -92, -96],
                        scale: [0.42, 1.04, 1.12, 1.08],
                        rotateY: [78, 0, -4, 0],
                        rotateZ: [-5, 1, -1, 0],
                      }}
                    transition={{ duration: phase === 'spotlight' ? 0.64 : intensity.burst / 1000, ease: FX.easing.burst }}
                    aria-hidden="true"
                  >
                    <span className="cinematic-emerge-halo" />
                    {phase === 'spotlight' && <span className="cinematic-spotlight-label">Vault pull</span>}
                    <Slab card={spotlightCard} reveal />
                  </motion.div>
                )}
              </>
            )}
            {phase !== 'burst' && phase !== 'spotlight' && (
              <>
                <div className="cinematic-pack-copy">
                  {phase === 'charge' && 'Charging the vault seal'}
                  {phase === 'crack' && 'Cracking the inner light'}
                </div>
                <div className="cinematic-skip-copy">Tap to skip</div>
              </>
            )}
          </motion.div>
        ) : (
          <motion.div
            key="reveal"
            className="cinematic-result-stage"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="pack-result-title" style={{ textAlign: 'center', marginBottom: 22 }}>
              <div data-tier={topTier} style={{ display: 'inline-block' }}>
                <div style={{ fontSize: 12, color: 'var(--text-dim)', letterSpacing: '0.14em' }}>{pack.packName.toUpperCase()} RESULT</div>
                <h2 style={{ margin: '6px 0 0', color: 'var(--tier)', fontSize: 22 }}>{TIER_SHOUT[topTier]}</h2>
                <p className="caveat" style={{ marginTop: 8 }}>Tap any card to view its real Card Passport.</p>
              </div>
            </div>

            <div className="cinematic-card-grid" style={{ gridTemplateColumns: `repeat(${order.length}, minmax(0, 1fr))` }}>
              {order.map((card, index) => {
                const rare = card.tokenId === rareToken;
                const delay = phase === 'settle' && skipped ? 0 : index * intensity.cardStagger + (rare && intensity.slowMo ? 320 : 0);
                return (
                  <motion.div
                    key={card.tokenId}
                    className="cinematic-card-reveal pack-reveal-card"
                    data-tier={card.tier}
                    custom={{ index, total: order.length, delay, rare }}
                    variants={cardVariants}
                    initial="hidden"
                    animate="show"
                    style={{ maxWidth: pack.size === 1 ? 290 : undefined }}
                  >
                    {rare && (card.tier === 'TOP' || card.tier === 'S') && <div className="cinematic-tier-badge">Tier {card.tier}</div>}
                    <span className="pack-card-flare cinematic-card-flare" />
                    {(card.tier === 'TOP' || card.tier === 'S') && <span className="sweep-overlay" />}
                    <Slab
                      card={card}
                      reveal
                      onClick={(c) => dispatch({ type: 'OPEN_PASSPORT', tokenId: c.tokenId })}
                    />
                  </motion.div>
                );
              })}
            </div>

            {phase === 'settle' && (
              <div className="anim-fade" style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 30, flexWrap: 'wrap' }}>
                <button className="btn" onClick={() => dispatch({ type: 'GOTO', screen: 'roster' })}>Add to roster</button>
                <button className="btn btn-primary" onClick={() => dispatch({ type: 'GOTO', screen: 'deck' })}>Build lineup & battle</button>
                <button className="btn btn-ghost" onClick={() => dispatch({ type: 'GOTO', screen: 'intro' })}>Open another pack</button>
              </div>
            )}
            {!state.passportHintSeen && phase === 'settle' && (
              <p className="caveat anim-fade" style={{ textAlign: 'center', marginTop: 18 }}>
                Tap any card to view its real Card Passport.
                <button className="btn btn-ghost" style={{ marginLeft: 8, padding: '3px 8px', fontSize: 10 }} onClick={() => dispatch({ type: 'DISMISS_PASSPORT_HINT' })}>
                  Got it
                </button>
              </p>
            )}
            <p className="caveat" style={{ textAlign: 'center', marginTop: 10 }}>
              Simulated pack - not a real pack opening, no real money. These are fictional gameplay stats based on real graded-card data.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ParticleCanvas({ active, tier, count }: { active: boolean; tier: Tier; count: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !active) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const context = ctx;

    let raf = 0;
    let alive = true;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    const colors = particlePalette(tier);
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const particles = Array.from({ length: count }, (_, i) => {
      const angle = Math.random() * Math.PI * 2;
      const speed = 4 + Math.random() * (i % 5 === 0 ? 9 : 6);
      return {
        x: cx + (Math.random() - 0.5) * 30,
        y: cy + (Math.random() - 0.5) * 22,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - Math.random() * 3,
        size: 1.5 + Math.random() * (i % 7 === 0 ? 8 : 4),
        life: 42 + Math.random() * 58,
        age: 0,
        gravity: 0.08 + Math.random() * 0.08,
        spin: (Math.random() - 0.5) * 0.18,
        rot: Math.random() * Math.PI,
        type: i % 9 === 0 ? 'shard' : i % 3 === 0 ? 'orb' : 'spark',
        color: colors[i % colors.length],
      };
    });

    function frame() {
      if (!alive) return;
      context.clearRect(0, 0, rect.width, rect.height);
      let living = 0;
      context.globalCompositeOperation = 'lighter';
      for (const p of particles) {
        p.age += 1;
        if (p.age >= p.life) continue;
        living += 1;
        p.x += p.vx;
        p.y += p.vy;
        p.vy += p.gravity;
        p.vx *= 0.985;
        p.rot += p.spin;
        const t = p.age / p.life;
        const alpha = Math.pow(1 - t, 1.7);
        context.save();
        context.globalAlpha = alpha;
        context.translate(p.x, p.y);
        context.rotate(p.rot);
        context.fillStyle = p.color;
        if (p.type === 'spark') {
          context.fillRect(-p.size * 0.22, -p.size * 2.2, p.size * 0.44, p.size * 4.4);
        } else if (p.type === 'shard') {
          context.fillRect(-p.size * 0.7, -p.size * 0.28, p.size * 1.4, p.size * 0.56);
        } else {
          context.beginPath();
          context.arc(0, 0, p.size, 0, Math.PI * 2);
          context.fill();
        }
        context.restore();
      }
      if (living > 0) raf = requestAnimationFrame(frame);
    }

    raf = requestAnimationFrame(frame);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      context.clearRect(0, 0, rect.width, rect.height);
    };
  }, [active, count, tier]);

  if (!active) return null;
  return <canvas ref={canvasRef} className="cinematic-particle-canvas" aria-hidden="true" />;
}

function particlePalette(tier: Tier): string[] {
  const base = TIER_COLORS[tier];
  if (tier === 'TOP') return ['#fff3b0', '#f5b301', '#ff9f1c', '#ffffff', base];
  if (tier === 'S') return ['#eadbff', '#a277ff', '#ff5ee1', '#ffffff', base];
  if (tier === 'A') return ['#d9e8ff', '#4c8dff', '#60d8ff', '#ffffff', base];
  if (tier === 'B') return ['#d8fff4', '#2fd3a5', '#7cffd8', '#ffffff', base];
  if (tier === 'C') return ['#f4f7fb', '#8a93a0', '#c9d2dc', '#ffffff', base];
  return ['#e2e7ee', '#5a626e', '#9aa3ad', '#ffffff', base];
}

function hexToRgbStr(hex: string) {
  const bigint = parseInt(hex.slice(1), 16);
  return `${(bigint >> 16) & 255}, ${(bigint >> 8) & 255}, ${bigint & 255}`;
}

