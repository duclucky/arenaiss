'use client';

import { TIERS, type Tier } from '@/lib/game/stats';

const TIER_NAME: Record<Tier, string> = {
  TOP: 'Top', S: 'S', A: 'A', B: 'B', C: 'C', D: 'D',
};

// Legend tier — hiển thị 1 lần để người chơi đọc được thang glow/màu.
export function TierLegend() {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
      <span style={{ fontSize: 10, color: 'var(--text-dim)', letterSpacing: '0.12em' }}>TIER</span>
      {TIERS.map((t) => (
        <span
          key={t}
          data-tier={t}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700,
            padding: '3px 9px', borderRadius: 999, color: 'var(--tier)',
            border: '1px solid rgba(from var(--tier) r g b / 0.5)',
            background: 'rgba(from var(--tier) r g b / 0.1)',
          }}
        >
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--tier)', boxShadow: '0 0 8px var(--tier)' }} />
          {TIER_NAME[t]}
        </span>
      ))}
    </div>
  );
}
