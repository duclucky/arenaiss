'use client';

import { TIERS, type GameCard, type Tier } from '@/lib/game/stats';
import type { Category } from '@/lib/client/api';

export type CardFilter = 'ALL' | Category | Tier;

export const CARD_FILTERS: { id: CardFilter; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'POKEMON', label: 'Pokemon' },
  { id: 'ONE_PIECE', label: 'One Piece' },
  ...TIERS.map((tier) => ({ id: tier, label: tier })),
];

export function filterCardsByFilter(cards: GameCard[], filter: CardFilter) {
  if (filter === 'ALL') return cards;
  if (filter === 'POKEMON' || filter === 'ONE_PIECE') return cards.filter((card) => card.category === filter);
  return cards.filter((card) => card.tier === filter);
}

function isTierFilter(filter: CardFilter): filter is Tier {
  return TIERS.includes(filter as Tier);
}

interface CardFilterBarProps {
  value: CardFilter;
  onChange: (filter: CardFilter) => void;
}

export function CardFilterBar({ value, onChange }: CardFilterBarProps) {
  return (
    <div className="panel" style={{ padding: 14, marginBottom: 18 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--text-dim)', marginRight: 4 }}>FILTER</span>
        {CARD_FILTERS.map((item) => {
          const isTier = isTierFilter(item.id);
          const active = value === item.id;
          return (
            <button
              key={item.id}
              className="btn btn-ghost"
              data-tier={isTier ? item.id : undefined}
              style={{
                padding: '6px 10px',
                borderColor: isTier ? 'rgba(from var(--tier) r g b / 0.5)' : active ? 'var(--accent)' : 'var(--hairline)',
                color: isTier ? 'var(--tier)' : active ? 'var(--accent)' : 'var(--text-sub)',
                background: isTier
                  ? 'rgba(from var(--tier) r g b / 0.1)'
                  : active
                    ? 'rgba(229,192,123,0.08)'
                    : 'transparent',
                boxShadow: active && isTier ? '0 0 14px -8px var(--tier)' : 'none',
              }}
              onClick={() => onChange(item.id)}
            >
              {item.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
