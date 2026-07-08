'use client';

import { useArena, useArenaDispatch } from '@/app/arena/state';
import { openPack, getPack, PAID_PACKS, WELCOME_PACK_ID, type PackDefinition } from '@/lib/game/gacha';
import { makePackSeed } from '@/lib/client/pack';

function PackButton({ pack, primary }: { pack: PackDefinition; primary?: boolean }) {
  const state = useArena();
  const dispatch = useArenaDispatch();
  const ready = state.pool.length > 0 && !state.poolLoading;
  const enoughCredits = pack.cost === 0 || state.credits >= pack.cost;
  const disabled = !ready || !enoughCredits;

  function openSelected() {
    if (disabled) return;
    const reveal = openPack(state.pool, makePackSeed(state.packCount), pack.id);
    dispatch({ type: 'OPEN_PACK', reveal, openedAt: new Date().toISOString() });
  }

  return (
    <button
      className={`btn${primary ? ' btn-primary' : ''}`}
      style={{ padding: '13px 14px', display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start', minHeight: 76 }}
      disabled={disabled}
      onClick={openSelected}
    >
      <span style={{ fontWeight: 850 }}>{pack.name}</span>
      <span className="caveat" style={{ textAlign: 'left' }}>
        {pack.size} card{pack.size === 1 ? '' : 's'} · {pack.cost === 0 ? 'free once' : `${pack.cost} credits`}
      </span>
    </button>
  );
}

export function PackChoices({ compact = false }: { compact?: boolean }) {
  const state = useArena();
  const welcome = !state.welcomePackOpened ? [getPack(WELCOME_PACK_ID)] : [];
  const packs = [...welcome, ...PAID_PACKS];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: compact ? 'repeat(2, minmax(0, 1fr))' : 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
      {packs.map((pack) => (
        <PackButton key={pack.id} pack={pack} primary={pack.id === WELCOME_PACK_ID} />
      ))}
    </div>
  );
}
