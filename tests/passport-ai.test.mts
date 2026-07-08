import assert from 'node:assert/strict';
import { fallbackNarration } from '../lib/passport/prompt';
import { isPassportAiCacheFresh, passportAiFingerprint } from '../lib/passport/cache';

const input = {
  card: {
    name: 'PSA 10 Gem Mint 2023 One Piece Test Card',
    setName: 'Example Set',
    grade: '10 Gem Mint',
    gradingCompany: 'PSA',
    year: 2023,
    tokenId: '1234567890',
  },
  custody: {
    vaultLocation: 'platform',
    countryCode: 'HK',
  },
  onchain: {
    activities: [
      { type: 'transfer', timestamp: '1783363200', txHash: '0x1234567890abcdef', amount: null },
    ],
    lastSale: null,
  },
  reference: {
    source: 'Renaiss OS Index',
    priceUsd: 265.25,
    confidence: 'high',
    observationCount: 17,
    lastSaleAt: '2026-07-06',
    deltas: { d7: 3.9, d30: -18.2, d365: 55.6 },
    sourceBreakdown: [],
  },
  asOf: '2026-07-08T00:00:00.000Z',
};

const text = fallbackNarration(input);

assert.match(text, /experimental reference data/i);
assert.doesNotMatch(text, /Reference price:/);
assert.doesNotMatch(text, /Custody:/);
assert.doesNotMatch(text, /Provenance:/);
assert.ok(text.length < 900, 'fallback insight should stay concise');

const sameDataLater = { ...input, asOf: '2026-07-09T00:00:00.000Z' };
assert.equal(
  passportAiFingerprint(input),
  passportAiFingerprint(sameDataLater),
  'cache fingerprint should ignore fetch timestamp when source data is unchanged',
);

const changedReference = {
  ...input,
  reference: { ...input.reference, observationCount: 18 },
};
assert.notEqual(
  passportAiFingerprint(input),
  passportAiFingerprint(changedReference),
  'cache fingerprint should change when reference data changes',
);

assert.equal(
  isPassportAiCacheFresh({ generatedAt: '2026-07-01T00:00:00.000Z' }, new Date('2026-07-07T23:59:59.000Z')),
  true,
  'cache should be fresh inside seven days',
);
assert.equal(
  isPassportAiCacheFresh({ generatedAt: '2026-07-01T00:00:00.000Z' }, new Date('2026-07-08T00:00:01.000Z')),
  false,
  'cache should expire after seven days',
);

console.log('passport-ai tests passed');
