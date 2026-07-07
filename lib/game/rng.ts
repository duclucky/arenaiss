// Seeded, deterministic RNG. Mọi ngẫu nhiên trong game (rút gói, tie-break AI)
// đều đi qua đây để TÁI LẬP được (seed từ tokenId → cùng seed cho cùng kết quả).
// Không dùng Math.random ở logic game.

// FNV-1a hash → uint32 seed từ một string bất kỳ.
export function hashSeed(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// mulberry32 PRNG — nhỏ, nhanh, đủ tốt cho game-feel.
export function makeRng(seed: number | string) {
  let a = (typeof seed === 'string' ? hashSeed(seed) : seed) >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rng = () => number;

export function rngInt(rng: Rng, minInclusive: number, maxExclusive: number): number {
  return minInclusive + Math.floor(rng() * (maxExclusive - minInclusive));
}

// Chọn 1 phần tử theo trọng số. weights song song với items.
export function weightedPick<T>(rng: Rng, items: T[], weights: number[]): T {
  const total = weights.reduce((s, w) => s + Math.max(0, w), 0);
  if (total <= 0) return items[rngInt(rng, 0, items.length)];
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= Math.max(0, weights[i]);
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

// Fisher–Yates dùng rng có seed (shuffle tái lập).
export function shuffle<T>(rng: Rng, arr: readonly T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rngInt(rng, 0, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
