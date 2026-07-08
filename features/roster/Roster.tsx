'use client';

import { useMemo, useState } from 'react';
import { useArena, useArenaDispatch } from '@/app/arena/state';
import { Slab } from '@/components/Slab';
import { TIERS, type GameCard, type Tier } from '@/lib/game/stats';
import type { Category } from '@/lib/client/api';

const RANK: Record<Tier, number> = { TOP: 0, S: 1, A: 2, B: 3, C: 4, D: 5 };
type RosterFilter = 'ALL' | Category | Tier;

const FILTERS: { id: RosterFilter; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'POKEMON', label: 'Pokemon' },
  { id: 'ONE_PIECE', label: 'One Piece' },
  ...TIERS.map((tier) => ({ id: tier, label: tier })),
];

function filterCards(cards: GameCard[], filter: RosterFilter) {
  if (filter === 'ALL') return cards;
  if (filter === 'POKEMON' || filter === 'ONE_PIECE') return cards.filter((card) => card.category === filter);
  return cards.filter((card) => card.tier === filter);
}

function isTierFilter(filter: RosterFilter): filter is Tier {
  return TIERS.includes(filter as Tier);
}

export function Roster() {
  const state = useArena();
  const dispatch = useArenaDispatch();
  const [filter, setFilter] = useState<RosterFilter>('ALL');
  const sorted = useMemo(
    () => filterCards([...state.roster], filter).sort((a, b) => RANK[a.tier] - RANK[b.tier] || b.power - a.power),
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

      <div className="panel" style={{ padding: 14, marginBottom: 18 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--text-dim)', marginRight: 4 }}>FILTER</span>
          {FILTERS.map((item) => (
            <button
              key={item.id}
              className="btn btn-ghost"
              data-tier={isTierFilter(item.id) ? item.id : undefined}
              style={{
                padding: '6px 10px',
                borderColor: isTierFilter(item.id) ? 'rgba(from var(--tier) r g b / 0.5)' : filter === item.id ? 'var(--accent)' : 'var(--hairline)',
                color: isTierFilter(item.id) ? 'var(--tier)' : filter === item.id ? 'var(--accent)' : 'var(--text-sub)',
                background: isTierFilter(item.id)
                  ? 'rgba(from var(--tier) r g b / 0.1)'
                  : filter === item.id
                    ? 'rgba(229,192,123,0.08)'
                    : 'transparent',
                boxShadow: filter === item.id && isTierFilter(item.id) ? '0 0 14px -8px var(--tier)' : 'none',
              }}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

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
