'use client';

import { useMemo } from 'react';
import { useArena, useArenaDispatch, deckCards } from '@/app/arena/state';
import { Slab } from '@/components/Slab';
import { buildOpponentDeck } from '@/lib/game/opponent';
import { makeBattleSeed } from '@/lib/client/pack';
import type { Tier } from '@/lib/game/stats';

const RANK: Record<Tier, number> = { TOP: 0, S: 1, A: 2, B: 3, C: 4, D: 5 };

export function DeckBuilder() {
  const state = useArena();
  const dispatch = useArenaDispatch();
  const deck = deckCards(state);
  const teamPower = deck.reduce((s, c) => s + c.power, 0);
  const full = deck.length === 5;

  const available = useMemo(
    () => [...state.roster].sort((a, b) => RANK[a.tier] - RANK[b.tier] || b.power - a.power),
    [state.roster],
  );

  function move(idx: number, dir: -1 | 1) {
    const tokens = [...state.deckTokens];
    const j = idx + dir;
    if (j < 0 || j >= tokens.length) return;
    [tokens[idx], tokens[j]] = [tokens[j], tokens[idx]];
    dispatch({ type: 'REORDER_DECK', tokens });
  }

  function startBattle() {
    if (!full) return;
    const seed = makeBattleSeed(state.deckTokens);
    const opponent = buildOpponentDeck(state.pool, deck, seed);
    dispatch({ type: 'START_BATTLE', playerDeck: deck, opponentDeck: opponent, seed });
  }

  return (
    <div className="anim-fade" style={{ maxWidth: 1120, margin: '0 auto', padding: '26px 22px 60px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap', marginBottom: 8 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 24 }}>Build deck</h2>
          <p className="caveat">Choose 5 cards. Order matters: the first card fights first. Arrange your deck to exploit type advantage.</p>
        </div>
        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
          <div style={{ fontSize: 10, letterSpacing: '0.14em', color: 'var(--text-dim)' }}>TEAM POWER</div>
          <div className="tabnums" style={{ fontSize: 32, fontWeight: 900, color: 'var(--accent)' }}>{teamPower}</div>
        </div>
      </div>

      {/* 5 slot deck */}
      <div className="panel" style={{ padding: 16, marginBottom: 22 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
          {Array.from({ length: 5 }).map((_, i) => {
            const card = deck[i];
            return (
              <div key={i} style={{ minHeight: 60 }}>
                {card ? (
                  <div className="anim-rise" style={{ animationDelay: `${i * 70}ms` }}>
                    <Slab card={card} selected onClick={(c) => dispatch({ type: 'OPEN_PASSPORT', tokenId: c.tokenId })} />
                    <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                      <button className="btn btn-ghost" style={{ flex: 1, padding: '5px' }} onClick={() => move(i, -1)} disabled={i === 0}>←</button>
                      <button className="btn btn-ghost" style={{ padding: '5px 8px' }} onClick={() => dispatch({ type: 'TOGGLE_DECK', tokenId: card.tokenId })} title="Remove from deck">✕</button>
                      <button className="btn btn-ghost" style={{ flex: 1, padding: '5px' }} onClick={() => move(i, 1)} disabled={i === deck.length - 1}>→</button>
                    </div>
                  </div>
                ) : (
                  <div style={{
                    aspectRatio: '2.5/4', border: '1.5px dashed var(--hairline-strong)', borderRadius: 14,
                    display: 'grid', placeItems: 'center', color: 'var(--text-dim)', fontSize: 13,
                  }}>
                    Slot {i + 1}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
          <button className="btn btn-primary" style={{ padding: '14px 34px', fontSize: 16 }} disabled={!full} onClick={startBattle}>
            {full ? '⚔ Start battle' : `Choose ${5 - deck.length} more`}
          </button>
        </div>
      </div>

      <h3 style={{ fontSize: 14, letterSpacing: '0.08em', color: 'var(--text-sub)', margin: '0 0 12px' }}>
        COLLECTION ({available.length})
      </h3>
      {available.length === 0 ? (
        <div className="panel" style={{ padding: 40, textAlign: 'center', color: 'var(--text-sub)' }}>
          No cards yet. <button className="btn btn-ghost" onClick={() => dispatch({ type: 'GOTO', screen: 'intro' })}>Open pack</button>
        </div>
      ) : (
        <div className="card-grid">
          {available.map((card) => {
            const inDeck = state.deckTokens.includes(card.tokenId);
            return (
              <div key={card.tokenId} style={{ position: 'relative' }}>
                <Slab
                  card={card}
                  selected={inDeck}
                  onClick={() => dispatch({ type: 'TOGGLE_DECK', tokenId: card.tokenId })}
                />
                {inDeck && (
                  <div style={{ position: 'absolute', top: 8, right: 8, background: 'var(--accent)', color: '#1a1408', borderRadius: 999, width: 22, height: 22, display: 'grid', placeItems: 'center', fontWeight: 900, fontSize: 13 }}>✓</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
