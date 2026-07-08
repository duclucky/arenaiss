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

function sampleCard(tokenId: string, tier: Tier, category: 'POKEMON' | 'ONE_PIECE' = 'POKEMON'): GameCard {
  return {
    tokenId,
    name: `Sample ${category} ${tier} ${tokenId}`,
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
    category,
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
const mixedPool = [
  ...Array.from({ length: 12 }, (_, i) => sampleCard(`p-${i + 1}`, tiers[i % tiers.length], 'POKEMON')),
  ...Array.from({ length: 12 }, (_, i) => sampleCard(`op-${i + 1}`, tiers[i % tiers.length], 'ONE_PIECE')),
];

assert.equal(STARTING_CREDITS, 10000);
assert.equal(BATTLE_STAKE, 100);

assert.deepEqual(
  PACKS.filter((pack) => pack.id !== WELCOME_PACK_ID).map((pack) => [pack.id, pack.cost, pack.size, pack.categories]),
  [
    ['eden', 300, 1, ['ONE_PIECE']],
    ['omega', 500, 1, ['POKEMON']],
    ['renacrypt', 800, 1, ['POKEMON', 'ONE_PIECE']],
  ],
);

const welcome = openPack(pool, 'welcome-seed', WELCOME_PACK_ID);
assert.equal(welcome.cards.length, 5);
assert.equal(welcome.cost, 0);

for (const pack of PACKS.filter((p) => p.id !== WELCOME_PACK_ID)) {
  const reveal = openPack(mixedPool, `seed-${pack.id}`, pack.id);
  assert.equal(reveal.cards.length, 1, `${pack.name} should reveal one card`);
  assert.equal(reveal.cost, pack.cost);
  assert.equal(reveal.packName, pack.name);
}

const eden = openPack(mixedPool, 'eden-category-seed', 'eden');
assert.equal(eden.cards.length, 1);
assert.ok(eden.cards.every((card) => card.category === 'ONE_PIECE'), 'Eden Pack should draw from One Piece cards');

const omega = openPack(mixedPool, 'omega-category-seed', 'omega');
assert.equal(omega.cards.length, 1);
assert.ok(omega.cards.every((card) => card.category === 'POKEMON'), 'OMEGA Pack should draw from Pokemon cards');

const renacryptSeen = new Set<string>();
for (let i = 0; i < 40; i++) {
  const reveal = openPack(mixedPool, `renacrypt-mixed-${i}`, 'renacrypt');
  if (reveal.cards[0]?.category) renacryptSeen.add(reveal.cards[0].category);
}
assert.ok(renacryptSeen.has('POKEMON'), 'RenaCrypt Pack should be able to draw Pokemon cards');
assert.ok(renacryptSeen.has('ONE_PIECE'), 'RenaCrypt Pack should be able to draw One Piece cards');

assert.equal(settleBattleCredits(10000, 'start'), 9900);
assert.equal(settleBattleCredits(9900, 'player_win'), 10099);
assert.equal(settleBattleCredits(9900, 'opponent_win'), 9900);
assert.equal(settleBattleCredits(9900, 'draw'), 10000);

console.log('economy-pack tests passed');
