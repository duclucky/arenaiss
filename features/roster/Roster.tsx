'use client';

import { useMemo } from 'react';
import { useArena, useArenaDispatch } from '@/app/arena/state';
import { Slab } from '@/components/Slab';
import { TierLegend } from '@/components/TierLegend';
import { openPack, PACK_COST } from '@/lib/game/gacha';
import { makePackSeed } from '@/lib/client/pack';
import type { Tier } from '@/lib/game/stats';

const RANK: Record<Tier, number> = { TOP: 0, S: 1, A: 2, B: 3, C: 4, D: 5 };

export function Roster() {
  const state = useArena();
  const dispatch = useArenaDispatch();
  const sorted = useMemo(
    () => [...state.roster].sort((a, b) => RANK[a.tier] - RANK[b.tier] || b.power - a.power),
    [state.roster],
  );

  function openAnother() {
    if (state.pool.length === 0 || state.credits < PACK_COST) return;
    dispatch({ type: 'OPEN_PACK', reveal: openPack(state.pool, makePackSeed(state.packCount)) });
  }

  return (
    <div className="anim-fade" style={{ maxWidth: 1120, margin: '0 auto', padding: '26px 22px 60px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 24 }}>Bộ sưu tập</h2>
          <p className="caveat">{state.roster.length} mẫu thẻ · click để soi Passport thật · các chỉ số là HƯ CẤU cho gameplay.</p>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
          <button className="btn" disabled={state.pool.length === 0 || state.credits < PACK_COST} onClick={openAnother}>
            Mở gói · {PACK_COST}
          </button>
          <button className="btn btn-primary" disabled={state.roster.length === 0} onClick={() => dispatch({ type: 'GOTO', screen: 'deck' })}>
            Lắp deck →
          </button>
        </div>
      </div>
      <div style={{ marginBottom: 18 }}><TierLegend /></div>

      {sorted.length === 0 ? (
        <div className="panel" style={{ padding: 50, textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>📦</div>
          <p style={{ color: 'var(--text-sub)' }}>Chưa có thẻ nào. Mở gói đầu tiên để bắt đầu.</p>
          <button className="btn btn-primary" style={{ marginTop: 10 }} onClick={() => dispatch({ type: 'GOTO', screen: 'intro' })}>Về Vault</button>
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
