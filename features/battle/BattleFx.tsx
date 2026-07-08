'use client';

import { AnimatePresence, motion, type Variants } from 'framer-motion';
import type { CSSProperties } from 'react';
import { STAT_LABEL, type Side, type StatKey } from '@/lib/game/battle';
import type { GameCard, Tier } from '@/lib/game/stats';
import { COMBAT_TIMING, type CombatFxRound, type CombatPhase } from './useCombatTimeline';

const STAT_COLORS: Record<StatKey, string> = {
  atk: '#ff6b4a',
  def: '#4c8dff',
  aura: '#a277ff',
};

const TIER_COLORS: Record<Tier, string> = {
  TOP: '#F5B301',
  S: '#A277FF',
  A: '#4C8DFF',
  B: '#2FD3A5',
  C: '#8A93A0',
  D: '#5A626E',
};

const PARTICLES = [
  [-26, -34], [4, -42], [31, -29], [44, -2],
  [32, 25], [5, 38], [-28, 29], [-43, 2],
  [-17, -52], [20, -55], [54, 14], [-55, 16],
] as const;

const SPARKS = [
  [-88, -22, -16], [-62, 24, 12], [-34, -46, -8], [0, 38, 0],
  [34, -44, 8], [64, 22, -10], [88, -18, 16], [18, -64, 24],
] as const;

function sideX(side: Side) {
  return side === 'player' ? -1 : 1;
}

function cardForSide(fxRound: CombatFxRound, side: Side): GameCard {
  return side === 'player' ? fxRound.round.playerCard : fxRound.round.opponentCard;
}

export function battleCardMotion(
  side: Side,
  phase: CombatPhase,
  fxRound: CombatFxRound | null,
  reduced: boolean,
) {
  if (!fxRound || phase === 'idle' || reduced) {
    return { x: 0, y: 0, scale: 1, rotate: 0, filter: 'grayscale(0) brightness(1)' };
  }

  const round = fxRound.round;
  const isAttacker = round.attacker === side;
  const isWinner = round.winner === side;
  const dir = sideX(side);
  const attackDistance = round.stat === 'atk' ? 132 : round.stat === 'def' ? 82 : 104;

  if (phase === 'lockIn') {
    return { x: -dir * 16, y: 8, scale: 0.97, rotate: -dir * 2.4, filter: 'grayscale(0) brightness(1.1)' };
  }
  if (phase === 'clash') {
    return isAttacker
      ? { x: -dir * attackDistance, y: -14, scale: 1.14, rotate: -dir * 6, filter: 'grayscale(0) brightness(1.24) saturate(1.16)' }
      : { x: 0, y: 0, scale: 1.03, rotate: 0, filter: 'grayscale(0) brightness(1.08)' };
  }
  if (phase === 'impact') {
    if (isAttacker) return { x: -dir * (attackDistance - 22), y: -8, scale: 1.12, rotate: -dir * 3, filter: 'grayscale(0) brightness(1.28) saturate(1.2)' };
    return {
      x: [0, dir * 14, -dir * 12, dir * 8, 0],
      y: [0, -6, 5, -3, 0],
      scale: 1.02,
      rotate: [0, dir * 3, -dir * 3, 0],
      filter: 'grayscale(0) brightness(1.16)',
    };
  }
  if (phase === 'resolve') {
    return isWinner
      ? { x: 0, y: -18, scale: 1.08, rotate: 0, filter: 'grayscale(0) brightness(1.18)' }
      : { x: 0, y: 18, scale: 0.96, rotate: 0, filter: 'grayscale(0.55) brightness(0.74)' };
  }
  return { x: 0, y: 0, scale: 1, rotate: 0, filter: 'grayscale(0) brightness(1)' };
}

const layerVariants: Variants = {
  lockIn: { opacity: 1, transition: { duration: 0.12, when: 'beforeChildren', staggerChildren: 0.03 } },
  clash: { opacity: 1, transition: { duration: COMBAT_TIMING.clash / 1000, when: 'beforeChildren' } },
  impact: { opacity: 1, transition: { duration: COMBAT_TIMING.impact / 1000 } },
  resolve: { opacity: 1, transition: { duration: COMBAT_TIMING.resolve / 1000, staggerChildren: 0.025 } },
  settle: { opacity: 0, transition: { duration: COMBAT_TIMING.settle / 1000 } },
};

const beamVariants: Variants = {
  lockIn: { opacity: 0, scaleX: 0.1, scaleY: 0.7 },
  clash: { opacity: 1, scaleX: 1, scaleY: 1, transition: { duration: 0.22, ease: 'easeOut' } },
  impact: { opacity: 1, scaleX: 1.12, scaleY: 1.45, transition: { duration: 0.12, ease: 'circOut' } },
  resolve: { opacity: 0, scaleX: 0.82, scaleY: 0.9, transition: { duration: 0.22 } },
  settle: { opacity: 0, scaleX: 0.1 },
};

const impactVariants: Variants = {
  lockIn: { opacity: 0, scale: 0.3 },
  clash: { opacity: 0, scale: 0.5 },
  impact: { opacity: [0, 1, 0.16], scale: [0.32, 1.72, 1.08], transition: { duration: 0.24, ease: 'circOut' } },
  resolve: { opacity: 0, scale: 2.05, transition: { duration: 0.2 } },
  settle: { opacity: 0 },
};

const shieldVariants: Variants = {
  lockIn: { opacity: 0, scale: 0.84 },
  clash: { opacity: 0.78, scale: 1.04, rotate: -8, transition: { duration: 0.18, ease: 'backOut' } },
  impact: { opacity: [0.95, 0.35], scale: [1.08, 1.24], rotate: 8, transition: { duration: 0.22 } },
  resolve: { opacity: 0, scale: 1.35 },
  settle: { opacity: 0 },
};

const pulseVariants: Variants = {
  lockIn: { opacity: 0, scale: 0.4 },
  clash: { opacity: 0.9, scale: 1.48, transition: { duration: 0.32, ease: 'easeOut' } },
  impact: { opacity: 0.72, scale: 2.25, transition: { duration: 0.24, ease: 'circOut' } },
  resolve: { opacity: 0, scale: 2.8, transition: { duration: 0.24 } },
  settle: { opacity: 0 },
};

const particleVariants: Variants = {
  lockIn: { opacity: 0, x: 0, y: 0, scale: 0.4 },
  clash: { opacity: 0, x: 0, y: 0, scale: 0.4 },
  impact: { opacity: 0.6, x: 0, y: 0, scale: 0.7 },
  resolve: (offset: readonly [number, number]) => ({
    opacity: [0, 1, 0],
    x: offset[0],
    y: offset[1],
    scale: [0.45, 1, 0.25],
    transition: { duration: 0.48, ease: 'easeOut' },
  }),
  settle: { opacity: 0 },
};

const sparkVariants: Variants = {
  lockIn: { opacity: 0, x: 0, y: 0, scaleX: 0.2 },
  clash: (spark: readonly [number, number, number]) => ({
    opacity: 0.92,
    x: spark[0] * 0.45,
    y: spark[1] * 0.45,
    rotate: spark[2],
    scaleX: 1,
    transition: { duration: 0.22, ease: 'easeOut' },
  }),
  impact: (spark: readonly [number, number, number]) => ({
    opacity: [1, 0.35],
    x: spark[0],
    y: spark[1],
    rotate: spark[2] * 1.8,
    scaleX: 1.35,
    transition: { duration: 0.18, ease: 'circOut' },
  }),
  resolve: { opacity: 0, scaleX: 0.4, transition: { duration: 0.18 } },
  settle: { opacity: 0 },
};

interface BattleFxProps {
  fxRound: CombatFxRound | null;
  phase: CombatPhase;
  reduced: boolean;
  onSkip: () => void;
}

export function BattleFx({ fxRound, phase, reduced, onSkip }: BattleFxProps) {
  if (!fxRound || phase === 'idle') return null;

  const { round } = fxRound;
  const color = STAT_COLORS[round.stat];
  const attackerDir = sideX(round.attacker);
  const winnerCard = cardForSide(fxRound, round.winner);
  const loserDir = sideX(round.loser);
  const margin = Math.abs(round.playerEff - round.opponentEff);
  const tierColor = TIER_COLORS[winnerCard.tier];
  const beamRotation = round.stat === 'atk' ? attackerDir * -5 : round.stat === 'def' ? attackerDir * 2 : 0;
  const beamClass = `battle-fx-beam battle-fx-beam-${round.stat}`;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={fxRound.id}
        className="battle-fx-layer"
        data-testid="battle-fx"
        data-combat-phase={phase}
        data-stat={round.stat}
        data-attacker={round.attacker}
        data-winner={round.winner}
        style={{ '--fx-color': color, '--fx-tier-color': tierColor } as CSSProperties}
        variants={layerVariants}
        initial="lockIn"
        animate={phase}
        exit={{ opacity: 0 }}
        onClick={onSkip}
        onPointerDown={onSkip}
      >
        <motion.div
          className={`battle-fx-stage battle-fx-stage-${round.stat}`}
          variants={{
            lockIn: { opacity: 0.42, scale: 0.96 },
            clash: { opacity: 0.78, scale: 1.04, transition: { duration: 0.22, ease: 'easeOut' } },
            impact: { opacity: 0.9, scale: 1.08, transition: { duration: 0.16 } },
            resolve: { opacity: 0.35, scale: 1.03 },
            settle: { opacity: 0, scale: 1 },
          }}
        />

        <motion.div
          className="battle-fx-label"
          variants={{
            lockIn: { opacity: 1, y: 2, scale: 0.94 },
            clash: { opacity: 1, y: -4, scale: 1.04 },
            impact: { opacity: 1, y: -7, scale: 1.08 },
            resolve: { opacity: 0.85, y: -10, scale: 1 },
            settle: { opacity: 0, y: -14 },
          }}
        >
          {STAT_LABEL[round.stat]} {phase === 'lockIn' ? 'LOCKED' : phase === 'resolve' ? `${round.winner === 'player' ? 'YOU WIN' : 'OPPONENT WINS'}` : 'CLASH'}
        </motion.div>

        {!reduced && round.stat !== 'aura' && (
          <motion.div
            className={beamClass}
            data-testid="battle-fx-beam"
            style={{ rotate: `${beamRotation}deg` }}
            variants={beamVariants}
          />
        )}

        {!reduced && round.stat === 'aura' && (
          <motion.div className="battle-fx-aura" data-testid="battle-fx-beam" variants={pulseVariants}>
            <span />
            <span />
          </motion.div>
        )}

        {!reduced && round.stat === 'def' && (
          <motion.div
            className="battle-fx-shield"
            style={{ [round.loser === 'player' ? 'left' : 'right']: '21%' }}
            variants={shieldVariants}
          />
        )}

        {!reduced && <motion.div className="battle-fx-impact" variants={impactVariants} />}

        {!reduced && (
          <motion.div className="battle-fx-sparks">
            {SPARKS.map((spark, i) => (
              <motion.span key={i} custom={spark} variants={sparkVariants} />
            ))}
          </motion.div>
        )}

        {!reduced && (
          <motion.div
            className="battle-fx-burst"
            style={{ [round.winner === 'player' ? 'left' : 'right']: '24%' }}
          >
            {PARTICLES.map((offset, i) => (
              <motion.span key={i} custom={offset} variants={particleVariants} />
            ))}
          </motion.div>
        )}

        <motion.div
          className="battle-fx-float tabnums"
          style={{ [round.loser === 'player' ? 'left' : 'right']: reduced ? '27%' : '23%', color: color }}
          variants={{
            lockIn: { opacity: 0, y: 18, x: loserDir * 10, scale: 0.8 },
            clash: { opacity: 0, y: 18, x: loserDir * 10, scale: 0.8 },
            impact: { opacity: 0.9, y: 4, x: loserDir * 4, scale: 1.05 },
            resolve: { opacity: 1, y: -34, x: loserDir * 12, scale: 1.1, transition: { duration: 0.32, ease: 'easeOut' } },
            settle: { opacity: 0, y: -42, scale: 0.9 },
          }}
        >
          -{margin}
        </motion.div>

        <div className="battle-fx-skip">tap to skip</div>
      </motion.div>
    </AnimatePresence>
  );
}
