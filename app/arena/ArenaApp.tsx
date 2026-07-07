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
import { loadPool } from '@/lib/client/api';

function Screens() {
  const state = useArena();
  const dispatch = useArenaDispatch();

  // Load pool on entry and when the card line changes.
  useEffect(() => {
    let alive = true;
    dispatch({ type: 'POOL_LOADING' });
    loadPool(state.category).then((pool) => {
      if (!alive) return;
      if (pool.length === 0) dispatch({ type: 'POOL_ERROR', error: 'marketplace pool could not be loaded' });
      else dispatch({ type: 'POOL_LOADED', pool });
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.category]);

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
