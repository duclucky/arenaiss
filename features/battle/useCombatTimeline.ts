'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import type { RoundResult } from '@/lib/game/battle';

export type CombatPhase = 'idle' | 'lockIn' | 'clash' | 'impact' | 'resolve' | 'settle';

export interface CombatFxRound {
  id: string;
  round: RoundResult;
}

export const COMBAT_TIMING = {
  lockIn: 280,
  clash: 420,
  impact: 280,
  resolve: 420,
  settle: 280,
  reducedLockIn: 120,
  reducedResolve: 180,
  skipSettle: 120,
} as const;

const PHASE_ORDER: CombatPhase[] = ['lockIn', 'clash', 'impact', 'resolve', 'settle', 'idle'];

function phaseDelay(phase: CombatPhase, reduced: boolean): number {
  if (reduced) {
    if (phase === 'lockIn') return COMBAT_TIMING.reducedLockIn;
    if (phase === 'resolve') return COMBAT_TIMING.reducedResolve;
    if (phase === 'settle') return COMBAT_TIMING.skipSettle;
    return 0;
  }
  if (phase === 'idle') return 0;
  return COMBAT_TIMING[phase];
}

export function useCombatTimeline() {
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState<CombatPhase>('idle');
  const [fxRound, setFxRound] = useState<CombatFxRound | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  const finish = useCallback(() => {
    clearTimers();
    setPhase('idle');
    setFxRound(null);
  }, [clearTimers]);

  const start = useCallback((round: RoundResult) => {
    clearTimers();
    setFxRound({ id: `${round.index}-${round.attacker}-${round.stat}`, round });
    setPhase('lockIn');

    let elapsed = 0;
    for (const nextPhase of PHASE_ORDER.slice(1)) {
      elapsed += phaseDelay(PHASE_ORDER[PHASE_ORDER.indexOf(nextPhase) - 1], reduced ?? false);
      timers.current.push(setTimeout(() => {
        if (nextPhase === 'idle') {
          finish();
        } else {
          setPhase(nextPhase);
        }
      }, elapsed));
    }
  }, [clearTimers, finish, reduced]);

  const skip = useCallback(() => {
    if (phase === 'idle') return;
    clearTimers();
    setPhase('settle');
    timers.current.push(setTimeout(finish, COMBAT_TIMING.skipSettle));
  }, [clearTimers, finish, phase]);

  useEffect(() => clearTimers, [clearTimers]);

  return {
    phase,
    fxRound,
    active: phase !== 'idle',
    reduced: reduced ?? false,
    start,
    skip,
  };
}
