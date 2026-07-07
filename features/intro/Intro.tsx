'use client';

import { useArena, useArenaDispatch } from '@/app/arena/state';
import { TierLegend } from '@/components/TierLegend';
import { oddsTable, openPack, PACK_COST } from '@/lib/game/gacha';
import { makePackSeed } from '@/lib/client/pack';
import type { Category } from '@/lib/client/api';

const CATEGORIES: { id: Category; label: string; glyph: string }[] = [
  { id: 'POKEMON', label: 'Pokémon', glyph: '⚡' },
  { id: 'ONE_PIECE', label: 'One Piece', glyph: '🏴‍☠️' },
];

export function Intro() {
  const state = useArena();
  const dispatch = useArenaDispatch();
  const rows = oddsTable(state.pool);
  const ready = state.pool.length > 0 && !state.poolLoading;
  const canOpen = ready && state.credits >= PACK_COST;

  function openFirst() {
    if (!canOpen) return;
    const reveal = openPack(state.pool, makePackSeed(state.packCount));
    dispatch({ type: 'OPEN_PACK', reveal, openedAt: new Date().toISOString() });
  }

  return (
    <div className="anim-fade" style={{ maxWidth: 980, margin: '0 auto', padding: '34px 22px 60px' }}>
      <div style={{ textAlign: 'center', marginBottom: 30 }}>
        <div className="anim-float" style={{ fontSize: 60, marginBottom: 8 }}>🗝️</div>
        <h1 style={{ fontSize: 34, margin: '0 0 8px', letterSpacing: '-0.01em' }}>
          Enter the <span style={{ color: 'var(--accent)' }}>Vault</span>
        </h1>
        <p style={{ color: 'var(--text-sub)', maxWidth: 620, margin: '0 auto', lineHeight: 1.6 }}>
          Open packs using reference odds → collect fictional cards based on real graded-card data → build a deck →
          battle in a skill-based Top-Trumps game. Win virtual credits to open more. Every card links to its real Card Passport.
        </p>
      </div>

      {/* Safety labels */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center', marginBottom: 26 }}>
        <span className="chip chip-sim">Simulated pack opening — no real money</span>
        <span className="chip chip-warn">Fictional game stats — not valuation or investment advice</span>
        <span className="chip">Read-only · no wallet signing · no on-chain action</span>
        <span className="chip">Data is saved only on this device</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start' }}>
        {/* Category picker */}
        <div className="panel" style={{ padding: 20 }}>
          <h3 style={{ margin: '0 0 14px', fontSize: 14, letterSpacing: '0.08em', color: 'var(--text-sub)' }}>CARD LINE</h3>
          <div style={{ display: 'flex', gap: 10 }}>
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                className="btn"
                style={{
                  flex: 1, flexDirection: 'column', display: 'flex', gap: 6, padding: '16px 10px',
                  borderColor: state.category === c.id ? 'var(--accent)' : 'var(--hairline)',
                  background: state.category === c.id ? 'var(--accent-soft)' : 'var(--raised)',
                }}
                onClick={() => dispatch({ type: 'SET_CATEGORY', category: c.id })}
              >
                <span style={{ fontSize: 26 }}>{c.glyph}</span>
                <span>{c.label}</span>
              </button>
            ))}
          </div>
          <p className="caveat" style={{ marginTop: 14 }}>
            Demo pool is built from the <b>real Renaiss marketplace</b> ({state.poolLoading ? 'loading...' : `${state.pool.length} cards`}).
          </p>
          <button
            className="btn btn-primary"
            style={{ width: '100%', marginTop: 10, padding: '15px', fontSize: 16 }}
            disabled={!canOpen}
            onClick={openFirst}
          >
            {state.poolLoading ? 'Opening the vault...' : state.credits < PACK_COST ? 'Not enough credits' : `Open first pack · ${PACK_COST} credits`}
          </button>
          {state.poolError && <p className="caveat" style={{ color: 'var(--loss)', marginTop: 8 }}>Pool load failed: {state.poolError}</p>}
        </div>

        {/* Transparent odds table */}
        <div className="panel" style={{ padding: 20 }}>
          <h3 style={{ margin: '0 0 6px', fontSize: 14, letterSpacing: '0.08em', color: 'var(--text-sub)' }}>TIER ODDS</h3>
          <p className="caveat" style={{ marginBottom: 12 }}>
            Odds are <b>estimated from the real marketplace pool composition</b>. On-chain gacha odds are not exposed by the alpha API;
            see README. This is an experimental reference, not verified market truth.
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
