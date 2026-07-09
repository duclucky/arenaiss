'use client';

import { useMemo, useState } from 'react';
import { useArena, useArenaDispatch } from '@/app/arena/state';
import { CardFilterBar, filterCardsByFilter, type CardFilter } from '@/components/CardFilterBar';
import { Slab } from '@/components/Slab';
import type { Tier } from '@/lib/game/stats';

const RANK: Record<Tier, number> = { TOP: 0, S: 1, A: 2, B: 3, C: 4, D: 5 };

export function Roster() {
  const state = useArena();
  const dispatch = useArenaDispatch();
  const [filter, setFilter] = useState<CardFilter>('ALL');
  const sorted = useMemo(
    () => filterCardsByFilter([...state.roster], filter).sort((a, b) => RANK[a.tier] - RANK[b.tier] || b.power - a.power),
    [state.roster, filter],
  );

  return (
    <div className="anim-fade" style={{ maxWidth: 1120, margin: '0 auto', padding: '26px 22px 60px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 24 }}>Roster</h2>
          <p className="caveat">
            {state.roster.length} fictional cards - tap a card to view its real Card Passport - stats are fictional gameplay attributes.
          </p>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
          <button className="btn" onClick={() => dispatch({ type: 'GOTO', screen: 'intro' })}>Gacha</button>
          <button className="btn btn-primary" disabled={state.roster.length === 0} onClick={() => dispatch({ type: 'GOTO', screen: 'deck' })}>
            Build lineup
          </button>
        </div>
      </div>

      <CardFilterBar value={filter} onChange={setFilter} />

      {sorted.length === 0 ? (
        <div className="panel" style={{ padding: 50, textAlign: 'center' }}>
          <p style={{ color: 'var(--text-sub)', margin: 0 }}>{state.roster.length === 0 ? 'No cards yet. Open your Welcome Pack or choose a simulated pack to start.' : 'No cards match this filter.'}</p>
          <button className="btn btn-primary" style={{ marginTop: 10 }} onClick={() => dispatch({ type: 'GOTO', screen: 'intro' })}>Back to Gacha</button>
        </div>
      ) : (
        <div className="card-grid">
          {sorted.map((card) => (
            <Slab
              key={card.tokenId}
              card={card}
              selected={state.deckTokens.includes(card.tokenId)}
              onClick={(c) => dispatch({ type: 'OPEN_PASSPORT', tokenId: c.tokenId })}
            />
          ))}
        </div>
      )}
    </div>
  );
}
