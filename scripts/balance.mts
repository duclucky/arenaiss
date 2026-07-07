// Balance self-test cho battle engine (build-plan §7.3).
// Mục tiêu: (1) SKILL (greedy) phải thắng RANDOM đáng kể; (2) deck tier CAO
// KHÔNG auto thắng — người chơi tier thấp chơi khéo vẫn có cửa nhờ chọn thuộc
// tính + type-advantage + thứ tự bài. Chạy: npx tsx scripts/balance.ts
import { buildCards, type GameCard, type Tier } from '@/lib/game/stats';
import { MarketplaceResponseSchema, type MarketplaceItem } from '@/lib/renaiss/schemas';
import { simulate, chooseStatGreedy, type BattleState, type StatKey, STAT_KEYS } from '@/lib/game/battle';
import { makeRng, shuffle, rngInt, type Rng } from '@/lib/game/rng';

async function fetchPool(): Promise<MarketplaceItem[]> {
  const items: MarketplaceItem[] = [];
  for (const cat of ['POKEMON', 'ONE_PIECE']) {
    for (let offset = 0; offset < 600; offset += 100) {
      try {
        const res = await fetch(`https://api.renaiss.xyz/v0/marketplace?categoryFilter=${cat}&limit=100&offset=${offset}`);
        if (!res.ok) { console.error('  http', res.status, cat, offset); break; }
        const parsed = MarketplaceResponseSchema.safeParse(await res.json());
        if (!parsed.success) { console.error('  zod fail', cat, offset, JSON.stringify(parsed.error.issues.slice(0, 2))); break; }
        items.push(...parsed.data.collection);
        if (!parsed.data.pagination?.hasMore) break;
      } catch (e) { console.error('  fetch throw', cat, offset, (e as Error).message); break; }
    }
  }
  return items;
}

function tierOf(cards: GameCard[], tier: Tier) { return cards.filter((c) => c.tier === tier); }
function pick5(rng: Rng, pool: GameCard[]): GameCard[] { return shuffle(rng, pool).slice(0, 5); }

const randomPolicy = (rng: Rng) => (): StatKey => STAT_KEYS[rngInt(rng, 0, 3)];
const greedyPolicy = (s: BattleState): StatKey => chooseStatGreedy(s, 'player');

function main(pool: GameCard[]) {
  console.log(`Pool: ${pool.length} thẻ.`);
  const comp: Record<string, number> = {};
  for (const c of pool) comp[c.tier] = (comp[c.tier] || 0) + 1;
  console.log('Tier composition:', comp);

  const N = 400;

  // --- Test 1: greedy vs random, deck cân bằng (rút ngẫu nhiên cả hai) ---
  let greedyWins = 0;
  for (let i = 0; i < N; i++) {
    const seed = `t1-${i}`;
    const r = makeRng(seed);
    const pDeck = pick5(r, pool);
    const oDeck = pick5(r, pool);
    // player greedy; opponent luôn greedy (AI). So sánh: nếu player DÙNG random.
    const stRandom = simulate(pDeck, oDeck, seed, randomPolicy(makeRng(seed + 'x')));
    if (stRandom.status === 'player_win') greedyWins++; // player(random) thắng AI(greedy)
  }
  const randomWinRate = greedyWins / N;
  // Player greedy vs opponent greedy (đối xứng) — kỳ vọng ~50% (fairness).
  let gWin = 0;
  for (let i = 0; i < N; i++) {
    const seed = `t1b-${i}`;
    const r = makeRng(seed);
    const st = simulate(pick5(r, pool), pick5(r, pool), seed, greedyPolicy);
    if (st.status === 'player_win') gWin++;
  }
  console.log(`\n[Fairness] player(GREEDY) vs opp(GREEDY), deck ngẫu nhiên: player win ${(gWin / N * 100).toFixed(1)}% (kỳ vọng ~50%)`);
  console.log(`[Skill] player(RANDOM) vs opp(GREEDY): player win ${(randomWinRate * 100).toFixed(1)}% (kỳ vọng THẤP → skill có giá trị)`);

  // --- Test 2: deck tier THẤP (C/D) khéo léo vs deck tier CAO (TOP/S/A) ---
  const high = [...tierOf(pool, 'TOP'), ...tierOf(pool, 'S'), ...tierOf(pool, 'A')];
  const low = [...tierOf(pool, 'C'), ...tierOf(pool, 'D')];
  if (high.length >= 5 && low.length >= 5) {
    let lowSkillWins = 0;
    let lowRandomWins = 0;
    for (let i = 0; i < N; i++) {
      const seed = `t2-${i}`;
      const r = makeRng(seed);
      const lowDeck = pick5(r, low);   // player = tier thấp
      const highDeck = pick5(r, high); // opponent = tier cao (greedy AI)
      const skill = simulate(lowDeck, highDeck, seed, greedyPolicy);
      if (skill.status === 'player_win') lowSkillWins++;
      const rnd = simulate(lowDeck, highDeck, seed, randomPolicy(makeRng(seed + 'y')));
      if (rnd.status === 'player_win') lowRandomWins++;
    }
    console.log(`\n[Anti-pay-to-win] deck TIER THẤP (player) vs TIER CAO (opp greedy):`);
    console.log(`  - player chơi KHÉO (greedy): thắng ${(lowSkillWins / N * 100).toFixed(1)}%`);
    console.log(`  - player chơi ẨU (random):   thắng ${(lowRandomWins / N * 100).toFixed(1)}%`);
    console.log(`  → chênh lệch = giá trị của SKILL: ${((lowSkillWins - lowRandomWins) / N * 100).toFixed(1)} điểm %`);
  } else {
    console.log(`\n[Anti-pay-to-win] không đủ thẻ tier cao/thấp để test (high=${high.length}, low=${low.length}).`);
  }

  // --- Test 3: xác nhận DETERMINISTIC (cùng seed + policy → cùng kết quả) ---
  const r = makeRng('det');
  const pd = pick5(r, pool), od = pick5(r, pool);
  const a = simulate(pd, od, 'det-battle', greedyPolicy);
  const b = simulate(pd, od, 'det-battle', greedyPolicy);
  console.log(`\n[Deterministic] hai lần chạy cùng input: ${a.status === b.status && a.rounds.length === b.rounds.length ? 'KHỚP ✓' : 'LỆCH ✗'} (${a.status}, ${a.rounds.length} lượt)`);
}

(async () => {
  const live = await fetchPool();
  if (live.length >= 30) {
    main(buildCards(live));
  } else {
    console.log('Không lấy được pool live, bỏ qua (cần mạng).');
  }
})();
