import assert from 'node:assert/strict';
import { renaissCardUrl, renaissGachaPackUrl } from '../lib/renaiss/links';

assert.equal(renaissCardUrl('379132983'), 'https://www.renaiss.xyz/card/379132983');
assert.equal(renaissCardUrl(' token 123 '), 'https://www.renaiss.xyz/card/token%20123');
assert.equal(renaissGachaPackUrl('eden-pack'), 'https://www.renaiss.xyz/gacha/eden-pack');

console.log('renaiss-links tests passed');
