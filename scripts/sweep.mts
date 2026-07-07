// Sweep type-advantage multiplier để tìm điểm cân bằng: SKILL matters (greedy≫random
// ở deck cân bằng) VÀ low-tier không vô vọng. Chạy: npx tsx scripts/sweep.mts
import { buildCards, ELEMENTS, type GameCard, type Tier, type Element } from '@/lib/game/stats';
import { MarketplaceResponseSchema, type MarketplaceItem } from '@/lib/renaiss/schemas';
import { makeRng, shuffle, rngInt, type Rng } from '@/lib/game/rng';

type StatKey = 'atk' | 'def' | 'aura';
const STATS: StatKey[] = ['atk', 'def', 'aura'];

async function fetchPool(): Promise<MarketplaceItem[]> {
  const items: MarketplaceItem[] = [];
  for (const cat of ['POKEMON', 'ONE_PIECE']) {
    for (let offset = 0; offset < 600; offset += 100) {
      const res = await fetch(`https://api.renaiss.xyz/v0/marketplace?categoryFilter=${cat}&limit=100&offset=${offset}`);
      if (!res.ok) break;
      const p = MarketplaceResponseSchema.safeParse(await res.json());
      if (!p.success) break;
      items.push(...p.data.collection);
      if (!p.data.pagination?.hasMore) break;
    }
  }
  return items;
}

function mult(a: Element, d: Element, adv: number, dis: number): number {
  if (a === d) return 1;
  const diff = (ELEMENTS.indexOf(d) - ELEMENTS.indexOf(a) + 5) % 5;
  return diff === 1 || diff === 2 ? adv : dis;
}

// policy: 'greedy' | 'random'
function play(pDeck: GameCard[], oDeck: GameCard[], seed: string, policy: 'greedy' | 'random', adv: number, dis: number): boolean {
  const pol = makeRng(seed + 'pol');
  let pq = pDeck.slice(), oq = oDeck.slice();
  let attacker: 'p' | 'o' = 'p';
  let guard = 0;
  while (pq.length && oq.length && guard++ < 50) {
    const p = pq[0], o = oq[0];
    const pM = mult(p.element, o.element, adv, dis);
    const oM = mult(o.element, p.element, adv, dis);
    let stat: StatKey;
    if (attacker === 'o') {
      // opponent greedy
      stat = STATS.reduce((b, s) => (o[s] * oM - p[s] * pM > o[b] * oM - p[b] * pM ? s : b), 'atk' as StatKey);
    } else if (policy === 'greedy') {
      stat = STATS.reduce((b, s) => (p[s] * pM - o[s] * oM > p[b] * pM - o[b] * oM ? s : b), 'atk' as StatKey);
    } else {
      stat = STATS[rngInt(pol, 0, 3)];
    }
    const pEff = p[stat] * pM, oEff = o[stat] * oM;
    let winnerP: boolean;
    if (pEff === oEff) winnerP = attacker === 'p';
    else winnerP = pEff > oEff;
    if (winnerP) oq = oq.slice(1); else pq = pq.slice(1);
    attacker = attacker === 'p' ? 'o' : 'p';
  }
  return oq.length === 0 && pq.length > 0;
}

function tierOf(c: GameCard[], t: Tier) { return c.filter((x) => x.tier === t); }

(async () => {
  const raw = await fetchPool();
  if (raw.length < 30) { console.log('no pool'); return; }
  const pool = buildCards(raw);
  const high = [...tierOf(pool, 'TOP'), ...tierOf(pool, 'S'), ...tierOf(pool, 'A')];
  const low = [...tierOf(pool, 'C'), ...tierOf(pool, 'D')];
  const N = 400;
  const pick5 = (r: Rng, p: GameCard[]) => shuffle(r, p).slice(0, 5);

  console.log('adv/dis  | balanced greedy | balanced random | skillΔ | lowSkill vs high | lowRandom | lowΔ');
  for (const [adv, dis] of [[1.30, 0.82], [1.33, 0.80], [1.36, 0.78], [1.40, 0.75], [1.45, 0.72]]) {
    let bg = 0, br = 0, ls = 0, lr = 0;
    for (let i = 0; i < N; i++) {
      const r = makeRng(`b-${i}`);
      const a = pick5(r, pool), b = pick5(r, pool);
      if (play(a, b, `b-${i}`, 'greedy', adv, dis)) bg++;
      if (play(a, b, `b-${i}`, 'random', adv, dis)) br++;
      const rl = makeRng(`l-${i}`);
      const ld = pick5(rl, low), hd = pick5(rl, high);
      if (play(ld, hd, `l-${i}`, 'greedy', adv, dis)) ls++;
      if (play(ld, hd, `l-${i}`, 'random', adv, dis)) lr++;
    }
    const pc = (x: number) => (x / N * 100).toFixed(0).padStart(3);
    console.log(
      `${adv}/${dis} |       ${pc(bg)}%      |      ${pc(br)}%      |  ${pc(bg - br)} |       ${pc(ls)}%       |    ${pc(lr)}%   | ${pc(ls - lr)}`,
    );
  }
})();
