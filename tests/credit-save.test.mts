import assert from 'node:assert/strict';
import { applyDailyCreditRefill } from '../lib/game/credit';
import { parseSavedArena, serializeArenaSave, SAVE_VERSION } from '../lib/game/save';
import type { GameCard } from '../lib/game/stats';

function sampleCard(tokenId: string): GameCard {
  return {
    tokenId,
    name: `Sample Card ${tokenId}`,
    setName: 'Base Set',
    pokemonName: 'Sample',
    cardNumber: '1',
    gradingCompany: 'PSA',
    grade: '10 Gem Mint',
    gradeNum: 10,
    year: 1999,
    fmvUsd: 100,
    askPriceInUSDT: null,
    askUsdt: null,
    vaultLocation: 'Demo vault',
    ownerAddress: null,
    category: 'POKEMON',
    atk: 95,
    def: 80,
    aura: 70,
    power: 83,
    element: 'Ember',
    tier: 'A',
    fmvKnown: true,
    serial: 'ABC123',
    imageUrl: null,
  };
}

const day1 = new Date('2026-07-06T12:00:00.000Z');
const beforeNextMidnight = new Date('2026-07-06T23:59:59.000Z');
const afterNextMidnight = new Date('2026-07-07T00:00:01.000Z');

{
  const result = applyDailyCreditRefill({ credits: 80, lastRefillAt: day1.toISOString(), now: beforeNextMidnight });
  assert.equal(result.credits, 80);
  assert.equal(result.refilled, false);
  assert.equal(result.lastRefillAt, day1.toISOString());
}

{
  const result = applyDailyCreditRefill({ credits: 80, lastRefillAt: day1.toISOString(), now: afterNextMidnight });
  assert.equal(result.credits, 200);
  assert.equal(result.refilled, true);
  assert.equal(result.lastRefillAt, '2026-07-07T00:00:00.000Z');
}

{
  const result = applyDailyCreditRefill({ credits: 100, lastRefillAt: day1.toISOString(), now: afterNextMidnight });
  assert.equal(result.credits, 100);
  assert.equal(result.refilled, false);
  assert.equal(result.lastRefillAt, '2026-07-07T00:00:00.000Z');
}

{
  const result = applyDailyCreditRefill({ credits: 50, lastRefillAt: null, now: afterNextMidnight });
  assert.equal(result.credits, 50);
  assert.equal(result.refilled, false);
  assert.equal(result.lastRefillAt, '2026-07-07T00:00:00.000Z');
}

{
  const card = sampleCard('101');
  const saved = serializeArenaSave(
    {
      category: 'POKEMON',
      credits: 240,
      roster: [card],
      deckTokens: [card.tokenId],
      packCount: 3,
      pullHistory: [{ seed: 'pack-1', tokenIds: [card.tokenId], openedAt: afterNextMidnight.toISOString() }],
      lastCreditRefillAt: afterNextMidnight.toISOString(),
      passportHintSeen: true,
      welcomePackOpened: true,
    },
    afterNextMidnight,
  );
  assert.equal(saved.version, SAVE_VERSION);
  assert.equal(saved.savedAt, afterNextMidnight.toISOString());
  assert.deepEqual(parseSavedArena(JSON.stringify(saved)), saved);
}

{
  assert.equal(parseSavedArena('not json'), null);
  assert.equal(parseSavedArena(JSON.stringify({ version: -1 })), null);
}

console.log('credit-save tests passed');
