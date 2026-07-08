'use client';

import { useMemo } from 'react';
import { useArena, useArenaDispatch } from '@/app/arena/state';
import { PackChoices } from '@/components/PackChoices';
import { Slab } from '@/components/Slab';
import { TierLegend } from '@/components/TierLegend';
import type { Tier } from '@/lib/game/stats';

const RANK: Record<Tier, number> = { TOP: 0, S: 1, A: 2, B: 3, C: 4, D: 5 };

export function Roster() {
  const state = useArena();
  const dispatch = useArenaDispatch();
  const sorted = useMemo(
    () => [...state.roster].sort((a, b) => RANK[a.tier] - RANK[b.tier] || b.power - a.power),
    [state.roster],
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

      <div className="panel" style={{ padding: 14, marginBottom: 18 }}>
        <PackChoices />
      </div>

      <div style={{ marginBottom: 18 }}><TierLegend /></div>

      {sorted.length === 0 ? (
        <div className="panel" style={{ padding: 50, textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>PACK</div>
          <p style={{ color: 'var(--text-sub)' }}>No cards yet. Open your Welcome Pack or choose a simulated pack to start.</p>
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
