'use client';

import { useArena, useArenaDispatch } from '@/app/arena/state';
import { PackChoices } from '@/components/PackChoices';
import { TierLegend } from '@/components/TierLegend';
import { oddsTable } from '@/lib/game/gacha';
import type { Category } from '@/lib/client/api';

const CATEGORIES: { id: Category; label: string; glyph: string }[] = [
  { id: 'POKEMON', label: 'Pokemon', glyph: 'P' },
  { id: 'ONE_PIECE', label: 'One Piece', glyph: 'OP' },
];

export function Intro() {
  const state = useArena();
  const dispatch = useArenaDispatch();
  const rows = oddsTable(state.pool);

  return (
    <div className="anim-fade" style={{ maxWidth: 980, margin: '0 auto', padding: '34px 22px 60px' }}>
      <div style={{ textAlign: 'center', marginBottom: 30 }}>
        <div className="anim-float" style={{ fontSize: 44, marginBottom: 8, fontWeight: 900, color: 'var(--accent)' }}>RA</div>
        <h1 style={{ fontSize: 34, margin: '0 0 8px', letterSpacing: '0' }}>
          Enter the <span style={{ color: 'var(--accent)' }}>Gacha</span>
        </h1>
        <p style={{ color: 'var(--text-sub)', maxWidth: 660, margin: '0 auto', lineHeight: 1.6 }}>
          Open simulated packs using reference odds, collect fictional cards based on real graded-card data,
          build a lineup, then battle for virtual credits. Every card links to its real Card Passport.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center', marginBottom: 26 }}>
        <span className="chip chip-sim">Simulated pack opening - no real money</span>
        <span className="chip chip-warn">Fictional game stats - not valuation or investment advice</span>
        <span className="chip">Read-only - no wallet signing - no on-chain action</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start' }}>
        <div className="panel" style={{ padding: 20 }}>
          <h3 style={{ margin: '0 0 14px', fontSize: 14, letterSpacing: '0.08em', color: 'var(--text-sub)' }}>CARD LINE</h3>
          <div style={{ display: 'flex', gap: 10 }}>
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                className="btn"
                style={{
                  flex: 1,
                  flexDirection: 'column',
                  display: 'flex',
                  gap: 6,
                  padding: '16px 10px',
                  borderColor: state.category === c.id ? 'var(--accent)' : 'var(--hairline)',
                  background: state.category === c.id ? 'var(--accent-soft)' : 'var(--raised)',
                }}
                onClick={() => dispatch({ type: 'SET_CATEGORY', category: c.id })}
              >
                <span style={{ fontSize: 18, fontWeight: 900 }}>{c.glyph}</span>
                <span>{c.label}</span>
              </button>
            ))}
          </div>
          <p className="caveat" style={{ marginTop: 14 }}>
            Demo pool is built from the <b>real Renaiss marketplace</b> ({state.poolLoading ? 'loading...' : `${state.pool.length} cards`}).
          </p>
          <div style={{ marginTop: 12 }}>
            <PackChoices compact />
          </div>
          {state.poolError && <p className="caveat" style={{ color: 'var(--loss)', marginTop: 8 }}>Pool load failed: {state.poolError}</p>}
        </div>

        <div className="panel" style={{ padding: 20 }}>
          <h3 style={{ margin: '0 0 6px', fontSize: 14, letterSpacing: '0.08em', color: 'var(--text-sub)' }}>EDEN PACK ODDS</h3>
          <p className="caveat" style={{ marginBottom: 12 }}>
            Odds are estimated from the real marketplace pool composition. Paid simulated packs reveal 1 card;
            the one-time Welcome Pack reveals 5 cards.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {rows.map((r) => (
              <div key={r.tier} data-tier={r.tier} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ width: 40, fontWeight: 800, color: 'var(--tier)', fontSize: 13 }}>{r.tier}</span>
                <div style={{ flex: 1, height: 8, background: 'rgba(255,255,255,0.05)', borderRadius: 999, overflow: 'hidden' }}>
                  <div style={{ width: `${Math.max(2, r.chance * 100)}%`, height: '100%', background: 'var(--tier)', boxShadow: '0 0 8px var(--tier)' }} />
                </div>
                <span className="tabnums" style={{ width: 46, textAlign: 'right', fontSize: 12, color: 'var(--text-sub)' }}>{(r.chance * 100).toFixed(0)}%</span>
                <span className="tabnums" style={{ width: 60, textAlign: 'right', fontSize: 10, color: 'var(--text-dim)' }}>{r.poolCount} cards</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--hairline)' }}>
            <TierLegend />
          </div>
        </div>
      </div>
    </div>
  );
}
