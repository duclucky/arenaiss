'use client';

import { useArena, useArenaDispatch } from '@/app/arena/state';
import { eligibleCardsForPack, getPack, packCategoryLabel, PAID_PACKS, WELCOME_PACK_ID, type PackDefinition, type PackId } from '@/lib/game/gacha';

const PACK_SKIN: Record<PackId, { accent: string; background: string }> = {
  welcome: { accent: '#E5C07B', background: 'linear-gradient(135deg, rgba(229,192,123,0.20), rgba(21,26,35,0.92))' },
  eden: { accent: '#4C8DFF', background: 'linear-gradient(135deg, rgba(76,141,255,0.24), rgba(21,26,35,0.92))' },
  omega: { accent: '#F5B301', background: 'linear-gradient(135deg, rgba(245,179,1,0.20), rgba(21,26,35,0.92))' },
  renacrypt: { accent: '#A277FF', background: 'linear-gradient(135deg, rgba(162,119,255,0.22), rgba(47,211,165,0.10), rgba(21,26,35,0.94))' },
};

function PackButton({ pack, primary }: { pack: PackDefinition; primary?: boolean }) {
  const state = useArena();
  const dispatch = useArenaDispatch();
  const eligibleCount = eligibleCardsForPack(state.pool, pack.id).length;
  const selected = state.selectedPackId === pack.id;
  const skin = PACK_SKIN[pack.id];

  return (
    <button
      className={`btn${primary ? ' btn-primary' : ''}`}
      style={{
        padding: '14px 16px',
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        gap: 10,
        alignItems: 'center',
        minHeight: 82,
        textAlign: 'left',
        borderColor: selected ? skin.accent : 'var(--hairline)',
        background: selected ? skin.background : 'var(--raised)',
        boxShadow: selected ? `0 0 22px -14px ${skin.accent}` : 'none',
      }}
      onClick={() => dispatch({ type: 'SELECT_PACK', packId: pack.id })}
    >
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontWeight: 900 }}>{pack.name}</span>
        <span className="caveat" style={{ display: 'block', textAlign: 'left' }}>
          {packCategoryLabel(pack)} · {pack.size} card{pack.size === 1 ? '' : 's'} · {pack.cost === 0 ? 'free once' : `${pack.cost} credits`}
        </span>
        <span className="caveat" style={{ display: 'block', textAlign: 'left' }}>{pack.theme} pool · {eligibleCount} eligible cards</span>
      </span>
      <span className="chip" style={{ borderColor: selected ? skin.accent : undefined, color: selected ? skin.accent : undefined }}>
        {selected ? 'Selected' : 'View odds'}
      </span>
    </button>
  );
}

export function PackChoices({ compact = false }: { compact?: boolean }) {
  const state = useArena();
  const welcome = !state.welcomePackOpened ? [getPack(WELCOME_PACK_ID)] : [];
  const packs = [...welcome, ...PAID_PACKS];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 10 : 12 }}>
      {packs.map((pack) => (
        <PackButton key={pack.id} pack={pack} primary={pack.id === WELCOME_PACK_ID} />
      ))}
    </div>
  );
}
