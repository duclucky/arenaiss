import type { GameCard } from './stats';
import { makeRng, shuffle } from './rng';

// Ghép đối thủ: chọn 5 thẻ từ pool có tổng power TƯƠNG ĐƯƠNG deck người chơi
// (hơi nhỉnh hơn ~4% để skill có đất diễn), đa dạng element. Deterministic theo seed.
export function buildOpponentDeck(pool: GameCard[], playerDeck: GameCard[], seed: string): GameCard[] {
  const exclude = new Set(playerDeck.map((c) => c.tokenId));
  const candidates = pool.filter((c) => !exclude.has(c.tokenId));
  if (candidates.length <= 5) return candidates.slice(0, 5);

  const avg = playerDeck.reduce((s, c) => s + c.power, 0) / Math.max(1, playerDeck.length);
  const target = avg * 1.04;

  // Sắp theo độ gần target power, lấy một cửa sổ rồi xáo có seed để đa dạng.
  const near = [...candidates].sort((a, b) => Math.abs(a.power - target) - Math.abs(b.power - target));
  const window = near.slice(0, Math.min(near.length, Math.max(24, playerDeck.length * 6)));
  const rng = makeRng('opp-' + seed);
  const shuffled = shuffle(rng, window);

  // Ưu tiên đa dạng element để trận có type-advantage.
  const picked: GameCard[] = [];
  const seenEl = new Set<string>();
  for (const c of shuffled) {
    if (picked.length >= 5) break;
    if (!seenEl.has(c.element) || shuffled.length < 10) {
      picked.push(c);
      seenEl.add(c.element);
    }
  }
  for (const c of shuffled) {
    if (picked.length >= 5) break;
    if (!picked.includes(c)) picked.push(c);
  }
  return picked.slice(0, 5);
}
