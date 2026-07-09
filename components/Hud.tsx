'use client';

import { useArena, useArenaDispatch, deckCards } from '@/app/arena/state';
import type { Screen } from '@/app/arena/state';
import { AuthPanel } from './AuthPanel';

// Header: logo, virtual credit, nav, and account controls.

const NAV: { screen: Screen; label: string }[] = [
  { screen: 'intro', label: 'Gacha' },
  { screen: 'roster', label: 'Roster' },
  { screen: 'deck', label: 'Lineup' },
];

export function Hud() {
  const state = useArena();
  const dispatch = useArenaDispatch();
  const deckN = deckCards(state).length;

  return (
    <header
      style={{
        display: 'flex', alignItems: 'center', gap: 16, padding: '14px 22px',
        borderBottom: '1px solid var(--hairline)', position: 'sticky', top: 0, zIndex: 20,
        background: 'rgba(11,14,20,0.82)', backdropFilter: 'blur(12px)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }} onClick={() => dispatch({ type: 'GOTO', screen: 'intro' })}>
        <span style={{ fontSize: 22 }}>🃏</span>
        <div>
          <div style={{ fontWeight: 800, letterSpacing: '0.06em', fontSize: 15 }}>Arenaiss</div>
          <div style={{ fontSize: 9.5, color: 'var(--text-dim)', letterSpacing: '0.14em' }}>GACHA-AS-DRAFT · SIMULATED</div>
        </div>
      </div>

      <nav style={{ display: 'flex', gap: 4, marginLeft: 10 }}>
        {NAV.map((n) => (
          <button
            key={n.screen}
            className="btn btn-ghost"
            style={{
              padding: '7px 13px', fontSize: 13,
              borderColor: state.screen === n.screen ? 'var(--accent)' : 'transparent',
              color: state.screen === n.screen ? 'var(--accent)' : 'var(--text-sub)',
            }}
            onClick={() => dispatch({ type: 'GOTO', screen: n.screen })}
          >
            {n.label}{n.screen === 'deck' && deckN > 0 ? ` (${deckN}/5)` : ''}
          </button>
        ))}
      </nav>

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
        {state.signedIn && (
          <div
            className="chip"
            style={{ fontSize: 14, fontWeight: 800, color: 'var(--accent)', borderColor: 'rgba(229,192,123,0.4)' }}
            title="Virtual credits earned by playing. Not money and not redeemable."
          >
            <span className="tabnums">{state.credits}</span>
            <span style={{ fontSize: 9, color: 'var(--text-dim)', fontWeight: 600 }}>VIRTUAL CREDITS</span>
          </div>
        )}
        <AuthPanel />
      </div>
    </header>
  );
}
