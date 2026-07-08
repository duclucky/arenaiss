import assert from 'node:assert/strict';
import {
  BATTLE_STAKE,
  PACKS,
  STARTING_CREDITS,
  WELCOME_PACK_ID,
  openPack,
  settleBattleCredits,
} from '../lib/game/gacha';
import type { GameCard, Tier } from '../lib/game/stats';

function sampleCard(tokenId: string, tier: Tier): GameCard {
  return {
    tokenId,
    name: `Sample ${tier} ${tokenId}`,
    setName: 'Arena Test',
    pokemonName: 'Sample',
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
    atk: 90,
    def: 80,
    aura: 70,
    power: 80,
    element: 'Aqua',
    tier,
    fmvKnown: true,
    serial: tokenId,
    imageUrl: null,
  };
}

const tiers: Tier[] = ['TOP', 'S', 'A', 'B', 'C', 'D'];
const pool = Array.from({ length: 24 }, (_, i) => sampleCard(String(i + 1), tiers[i % tiers.length]));

assert.equal(STARTING_CREDITS, 10000);
assert.equal(BATTLE_STAKE, 100);

assert.deepEqual(
  PACKS.filter((pack) => pack.id !== WELCOME_PACK_ID).map((pack) => [pack.id, pack.cost, pack.size]),
  [
    ['eden', 300, 1],
    ['omega', 500, 1],
    ['renacrypt', 800, 1],
  ],
);

const welcome = openPack(pool, 'welcome-seed', WELCOME_PACK_ID);
assert.equal(welcome.cards.length, 5);
assert.equal(welcome.cost, 0);

for (const pack of PACKS.filter((p) => p.id !== WELCOME_PACK_ID)) {
  const reveal = openPack(pool, `seed-${pack.id}`, pack.id);
  assert.equal(reveal.cards.length, 1, `${pack.name} should reveal one card`);
  assert.equal(reveal.cost, pack.cost);
  assert.equal(reveal.packName, pack.name);
}

assert.equal(settleBattleCredits(10000, 'start'), 9900);
assert.equal(settleBattleCredits(9900, 'player_win'), 10099);
assert.equal(settleBattleCredits(9900, 'opponent_win'), 9900);
assert.equal(settleBattleCredits(9900, 'draw'), 10000);

console.log('economy-pack tests passed');
