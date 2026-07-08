import assert from 'node:assert/strict';
import { initBattle, stepRound } from '../lib/game/battle';
import type { Element, GameCard } from '../lib/game/stats';

function card(tokenId: string, stats: { atk: number; def: number; aura: number }, element: Element = 'Aqua'): GameCard {
  return {
    tokenId,
    name: `Battle Test ${tokenId}`,
    setName: 'Arena Test',
    pokemonName: 'Test',
    cardNumber: tokenId,
    gradingCompany: 'PSA',
    grade: '10 Gem Mint',
    gradeNum: 10,
    year: 2024,
    fmvUsd: 100,
    askPriceInUSDT: null,
    askUsdt: null,
    vaultLocation: 'platform',
    ownerAddress: null,
    category: 'POKEMON',
    atk: stats.atk,
    def: stats.def,
    aura: stats.aura,
    power: Math.round((stats.atk + stats.def + stats.aura) / 3),
    element,
    tier: 'A',
    fmvKnown: true,
    serial: tokenId,
    imageUrl: null,
  };
}

{
  const state = initBattle(
    [card('p1', { atk: 100, def: 90, aura: 80 }), card('p2', { atk: 70, def: 70, aura: 70 })],
    [card('o1', { atk: 50, def: 50, aura: 50 }), card('o2', { atk: 70, def: 70, aura: 70 })],
    'initiative-best',
  );
  const result = stepRound(state, 'atk');
  assert.equal(result.round.winner, 'player');
  assert.equal(result.round.initiativeKept, true);
  assert.equal(result.state.attacker, 'player', 'best winning margin should keep initiative');
}

{
  const state = initBattle(
    [card('p1', { atk: 100, def: 90, aura: 80 }), card('p2', { atk: 70, def: 70, aura: 70 })],
    [card('o1', { atk: 50, def: 50, aura: 50 }), card('o2', { atk: 70, def: 70, aura: 70 })],
    'initiative-suboptimal',
  );
  const result = stepRound(state, 'aura');
  assert.equal(result.round.winner, 'player');
  assert.equal(result.round.initiativeKept, false);
  assert.equal(result.state.attacker, 'opponent', 'weaker winning margin should pass initiative');
}

console.log('battle-initiative tests passed');
