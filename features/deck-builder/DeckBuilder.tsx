'use client';

import { useMemo, useState } from 'react';
import { useArena, useArenaDispatch, deckCards } from '@/app/arena/state';
import { CardFilterBar, filterCardsByFilter, type CardFilter } from '@/components/CardFilterBar';
import { Slab } from '@/components/Slab';
import { BATTLE_STAKE } from '@/lib/game/gacha';
import { buildOpponentDeck } from '@/lib/game/opponent';
import { makeBattleSeed } from '@/lib/client/pack';
import type { Tier } from '@/lib/game/stats';
import type { Category } from '@/lib/client/api';

const RANK: Record<Tier, number> = { TOP: 0, S: 1, A: 2, B: 3, C: 4, D: 5 };
const ARENAS: { id: Category; title: string; copy: string }[] = [
  { id: 'POKEMON', title: 'Pokemon Arena', copy: 'Build and battle with Pokemon slabs only.' },
  { id: 'ONE_PIECE', title: 'One Piece Arena', copy: 'Build and battle with One Piece slabs only.' },
];

export function DeckBuilder() {
  const state = useArena();
  const dispatch = useArenaDispatch();
  const [filter, setFilter] = useState<CardFilter>('ALL');
  const arenaCategory = state.arenaCategory;
  const deck = arenaCategory ? deckCards(state).filter((card) => card.category === arenaCategory) : [];
  const teamPower = deck.reduce((s, c) => s + c.power, 0);
  const full = arenaCategory !== null && deck.length === 5;
  const canStake = state.credits >= BATTLE_STAKE;

  const available = useMemo(
    () => filterCardsByFilter([...state.roster]
      .filter((card) => !arenaCategory || card.category === arenaCategory), filter)
      .sort((a, b) => RANK[a.tier] - RANK[b.tier] || b.power - a.power),
    [state.roster, arenaCategory, filter],
  );

  function changeFilter(next: CardFilter) {
    setFilter(next);
    if (next === 'POKEMON' || next === 'ONE_PIECE') {
      dispatch({ type: 'SET_ARENA_CATEGORY', category: next });
    }
  }

  function move(idx: number, dir: -1 | 1) {
    const tokens = [...state.deckTokens];
    const j = idx + dir;
    if (j < 0 || j >= tokens.length) return;
    [tokens[idx], tokens[j]] = [tokens[j], tokens[idx]];
    dispatch({ type: 'REORDER_DECK', tokens });
  }

  function startBattle() {
    if (!full || !canStake || !arenaCategory) return;
    const seed = makeBattleSeed(state.deckTokens);
    const opponentPool = state.poolsByCategory[arenaCategory].length > 0
      ? state.poolsByCategory[arenaCategory]
      : state.pool.filter((card) => card.category === arenaCategory);
    const opponent = buildOpponentDeck(opponentPool, deck, seed);
    dispatch({ type: 'START_BATTLE', playerDeck: deck, opponentDeck: opponent, seed });
  }

  return (
    <div className="anim-fade" style={{ maxWidth: 1120, margin: '0 auto', padding: '26px 22px 60px' }}>
      {!arenaCategory ? (
        <div className="panel" style={{ padding: 22, marginBottom: 22 }}>
          <h2 style={{ margin: 0, fontSize: 24 }}>Choose arena</h2>
          <p className="caveat" style={{ marginTop: 6 }}>Pick a card line before building your lineup. Each arena only shows matching cards.</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14, marginTop: 18 }}>
            {ARENAS.map((arena) => {
              const count = state.roster.filter((card) => card.category === arena.id).length;
              return (
                <button
                  key={arena.id}
                  className="btn"
                  style={{
                    minHeight: 118,
                    padding: 18,
                    textAlign: 'left',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    background: arena.id === 'POKEMON' ? 'linear-gradient(135deg, rgba(245,179,1,0.14), var(--raised))' : 'linear-gradient(135deg, rgba(76,141,255,0.16), var(--raised))',
                  }}
                  onClick={() => dispatch({ type: 'SET_ARENA_CATEGORY', category: arena.id })}
                >
                  <span>
                    <span style={{ display: 'block', fontSize: 18, fontWeight: 900 }}>{arena.title}</span>
                    <span className="caveat" style={{ display: 'block', marginTop: 4 }}>{arena.copy}</span>
                  </span>
                  <span className="chip">{count} roster cards</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {arenaCategory ? (
        <>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap', marginBottom: 8 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 24 }}>Build lineup</h2>
          <p className="caveat">Choose 5 {arenaCategory === 'POKEMON' ? 'Pokemon' : 'One Piece'} cards. Order matters: the first card fights first. Starting a battle stakes 100 virtual credits.</p>
        </div>
        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
          <div style={{ fontSize: 10, letterSpacing: '0.14em', color: 'var(--text-dim)' }}>TEAM POWER</div>
          <div className="tabnums" style={{ fontSize: 32, fontWeight: 900, color: 'var(--accent)' }}>{teamPower}</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {ARENAS.map((arena) => (
          <button
            key={arena.id}
            className="btn btn-ghost"
            style={{
              padding: '7px 12px',
              borderColor: arenaCategory === arena.id ? 'var(--accent)' : 'var(--hairline)',
              color: arenaCategory === arena.id ? 'var(--accent)' : 'var(--text-sub)',
            }}
            onClick={() => {
              setFilter(arena.id);
              dispatch({ type: 'SET_ARENA_CATEGORY', category: arena.id });
            }}
          >
            {arena.title}
          </button>
        ))}
      </div>

      <CardFilterBar value={filter} onChange={changeFilter} />

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
                      <button className="btn btn-ghost" style={{ flex: 1, padding: '5px' }} onClick={() => move(i, -1)} disabled={i === 0}>Left</button>
                      <button className="btn btn-ghost" style={{ padding: '5px 8px' }} onClick={() => dispatch({ type: 'TOGGLE_DECK', tokenId: card.tokenId })} title="Remove from lineup">X</button>
                      <button className="btn btn-ghost" style={{ flex: 1, padding: '5px' }} onClick={() => move(i, 1)} disabled={i === deck.length - 1}>Right</button>
                    </div>
                  </div>
                ) : (
                  <div style={{
                    aspectRatio: '2.5/4',
                    border: '1.5px dashed var(--hairline-strong)',
                    borderRadius: 14,
                    display: 'grid',
                    placeItems: 'center',
                    color: 'var(--text-dim)',
                    fontSize: 13,
                  }}>
                    Slot {i + 1}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
          <button className="btn btn-primary" style={{ padding: '14px 34px', fontSize: 16 }} disabled={!full || !canStake} onClick={startBattle}>
            {!full ? `Choose ${5 - deck.length} more` : canStake ? `Start battle - stake ${BATTLE_STAKE}` : 'Not enough credits to stake'}
          </button>
        </div>
      </div>

      <h3 style={{ fontSize: 14, letterSpacing: '0.08em', color: 'var(--text-sub)', margin: '0 0 12px' }}>
        {arenaCategory === 'POKEMON' ? 'POKEMON' : 'ONE PIECE'} ROSTER ({available.length})
      </h3>
      {available.length === 0 ? (
        <div className="panel" style={{ padding: 40, textAlign: 'center', color: 'var(--text-sub)' }}>
          No cards match this lineup filter. <button className="btn btn-ghost" onClick={() => dispatch({ type: 'GOTO', screen: 'intro' })}>Gacha</button>
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
                  <div style={{ position: 'absolute', top: 8, right: 8, background: 'var(--accent)', color: '#1a1408', borderRadius: 999, width: 22, height: 22, display: 'grid', placeItems: 'center', fontWeight: 900, fontSize: 13 }}>IN</div>
                )}
              </div>
            );
          })}
        </div>
      )}
        </>
      ) : null}
    </div>
  );
}
