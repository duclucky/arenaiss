'use client';

import { useEffect } from 'react';
import { ArenaProvider, useArena, useArenaDispatch } from './state';
import { Hud } from '@/components/Hud';
import { Intro } from '@/features/intro/Intro';
import { PackOpen } from '@/features/pack-open/PackOpen';
import { Roster } from '@/features/roster/Roster';
import { DeckBuilder } from '@/features/deck-builder/DeckBuilder';
import { Battle } from '@/features/battle/Battle';
import { Result } from '@/features/result/Result';
import { PassportDrawer } from '@/features/passport/PassportDrawer';
import { loadPool, type Category } from '@/lib/client/api';

const CATEGORIES: Category[] = ['POKEMON', 'ONE_PIECE'];

function Screens() {
  const state = useArena();
  const dispatch = useArenaDispatch();

  // Load both card lines once so gacha, roster, and lineup can filter locally.
  useEffect(() => {
    let alive = true;
    dispatch({ type: 'POOL_LOADING' });
    Promise.all(CATEGORIES.map(async (category) => [category, await loadPool(category)] as const)).then((entries) => {
      if (!alive) return;
      const pools = Object.fromEntries(entries) as Record<Category, Awaited<ReturnType<typeof loadPool>>>;
      if (pools.POKEMON.length === 0 && pools.ONE_PIECE.length === 0) {
        dispatch({ type: 'POOL_ERROR', error: 'marketplace pool could not be loaded' });
      } else {
        dispatch({ type: 'POOLS_LOADED', pools });
      }
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Slab images are derived from serials in buildCards; no extra detail hydration needed.

  return (
    <>
      <Hud />
      <main>
        {state.screen === 'intro' && <Intro />}
        {state.screen === 'pack' && <PackOpen />}
        {state.screen === 'roster' && <Roster />}
        {state.screen === 'deck' && <DeckBuilder />}
        {state.screen === 'battle' && <Battle />}
        {state.screen === 'result' && <Result />}
      </main>
      <PassportDrawer />
    </>
  );
}

export function ArenaApp() {
  return (
    <ArenaProvider>
      <Screens />
    </ArenaProvider>
  );
}
