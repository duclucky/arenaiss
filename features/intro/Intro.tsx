'use client';

import { useArena, useArenaDispatch } from '@/app/arena/state';
import { PackChoices } from '@/components/PackChoices';
import { TierLegend } from '@/components/TierLegend';
import { eligibleCardsForPack, getPack, oddsTable, openPack, packCategoryLabel } from '@/lib/game/gacha';
import { makePackSeed } from '@/lib/client/pack';

export function Intro() {
  const state = useArena();
  const dispatch = useArenaDispatch();
  const selectedPack = getPack(state.selectedPackId);
  const rows = oddsTable(state.pool, selectedPack.id);
  const eligibleCards = eligibleCardsForPack(state.pool, selectedPack.id);
  const ready = eligibleCards.length > 0 && !state.poolLoading;
  const enoughCredits = selectedPack.cost === 0 || state.credits >= selectedPack.cost;
  const canRip = ready && enoughCredits;

  function ripSelectedPack() {
    if (!canRip) return;
    const reveal = openPack(state.pool, makePackSeed(state.packCount), selectedPack.id);
    dispatch({ type: 'OPEN_PACK', reveal, openedAt: new Date().toISOString() });
  }

  return (
    <div className="anim-fade" style={{ maxWidth: 980, margin: '0 auto', padding: '34px 22px 60px' }}>
      <div style={{ textAlign: 'center', marginBottom: 30 }}>
        <div className="anim-float" style={{ fontSize: 34, marginBottom: 8, fontWeight: 900, color: 'var(--accent)', letterSpacing: '0.08em' }}>DEMO</div>
        <h1 style={{ fontSize: 34, margin: '0 0 8px', letterSpacing: '0' }}>
          Arenaiss <span style={{ color: 'var(--accent)' }}>Simulation</span>
        </h1>
        <p style={{ color: 'var(--text-sub)', maxWidth: 660, margin: '0 auto', lineHeight: 1.6 }}>
          This is a game-only simulation designed to demonstrate how Renaiss pack discovery,
          roster building, and arena battles can work. Cards opened here are fictional in-app
          game items with no real-world value, ownership, or claim. The demo uses official
          Renaiss API data to mirror real graded-card metadata as closely as possible.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center', marginBottom: 26 }}>
        <span className="chip chip-sim">Simulated pack opening - no real money</span>
        <span className="chip chip-warn">Fictional game stats - not valuation or investment advice</span>
        <span className="chip">Read-only - no wallet signing - no on-chain action</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start' }}>
        <div className="panel" style={{ padding: 20 }}>
          <h3 style={{ margin: '0 0 14px', fontSize: 14, letterSpacing: '0.08em', color: 'var(--text-sub)' }}>PACK VAULT</h3>
          <p className="caveat" style={{ marginTop: 14 }}>
            Demo pools are built from the <b>real Renaiss marketplace</b> ({state.poolLoading ? 'loading...' : `${state.pool.length} cards`}).
            Select a simulated pack to inspect its odds before ripping.
          </p>
          <div style={{ marginTop: 12 }}>
            <PackChoices compact />
          </div>
          {state.poolError && <p className="caveat" style={{ color: 'var(--loss)', marginTop: 8 }}>Pool load failed: {state.poolError}</p>}
        </div>

        <div className="panel" style={{ padding: 20 }}>
          <h3 style={{ margin: '0 0 6px', fontSize: 14, letterSpacing: '0.08em', color: 'var(--text-sub)' }}>{selectedPack.name.toUpperCase()} ODDS</h3>
          <p className="caveat" style={{ marginBottom: 12 }}>
            Simulated draw pool: {packCategoryLabel(selectedPack)}. Odds are estimated from real marketplace pool composition because public
            Renaiss pack odds are not exposed by the alpha read API here.
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
          <div style={{ marginTop: 16, display: 'grid', gap: 8 }}>
            <button className="btn btn-primary" style={{ width: '100%', padding: '13px 18px' }} disabled={!canRip} onClick={ripSelectedPack}>
              Rip a Pack · {selectedPack.cost === 0 ? 'Free' : `${selectedPack.cost} credits`}
            </button>
            {!ready && <p className="caveat" style={{ color: 'var(--loss)' }}>This pack has no eligible cards loaded yet.</p>}
            {ready && !enoughCredits && <p className="caveat" style={{ color: 'var(--loss)' }}>Not enough virtual credits for this pack.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
