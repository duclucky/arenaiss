import type { MarketplaceItem } from '@/lib/renaiss/schemas';
import { hashSeed } from './rng';

// ============================================================================
// STAT ENGINE — chỉ số game HƯ CẤU, suy ra minh bạch từ dữ liệu thẻ THẬT.
// CAVEAT (bắt buộc hiển thị ở UI): các chỉ số này KHÔNG phản ánh giá trị đầu tư
// hay định giá tài sản. Chúng chỉ là thuộc tính chơi game.
// Công thức công bố công khai (docs/build-plan.md §4).
// ============================================================================

export type Tier = 'TOP' | 'S' | 'A' | 'B' | 'C' | 'D';
export const TIERS: Tier[] = ['TOP', 'S', 'A', 'B', 'C', 'D'];

// Odds ƯỚC LƯỢNG theo THÀNH PHẦN pool (gacha odds on-chain chưa công khai ở API
// alpha — xem docs/api-reference.md). Đây cũng là các mốc percentile để gán tier.
export const TIER_ODDS: Record<Tier, number> = {
  TOP: 0.03,
  S: 0.07,
  A: 0.15,
  B: 0.25,
  C: 0.3,
  D: 0.2,
};

// Ngưỡng percentile tích luỹ (từ CAO xuống) để gán tier theo rarityScore.
const TIER_CUTOFFS: { tier: Tier; topFrac: number }[] = [
  { tier: 'TOP', topFrac: 0.03 },
  { tier: 'S', topFrac: 0.1 },
  { tier: 'A', topFrac: 0.25 },
  { tier: 'B', topFrac: 0.5 },
  { tier: 'C', topFrac: 0.8 },
  { tier: 'D', topFrac: 1.0 },
];

// ---- Elements (type-advantage kiểu RPSLS 5 chiều) ---------------------------
export type Element = 'Ember' | 'Aqua' | 'Terra' | 'Gale' | 'Umbra';
export const ELEMENTS: Element[] = ['Ember', 'Aqua', 'Terra', 'Gale', 'Umbra'];
export const ELEMENT_GLYPH: Record<Element, string> = {
  Ember: '🔥', Aqua: '💧', Terra: '⛰️', Gale: '🌪️', Umbra: '🌑',
};

// Mỗi element THẮNG 2 element kế tiếp (mod 5), THUA 2 element trước → mọi cặp
// khác nhau đều phân thắng bại (trừ đấu gương). Type-advantage đủ mạnh để quyết
// định người chơi có trọng số ≥ độ hiếm.
// Type-advantage là ĐÒN BẨY LỚN NHẤT trong trận (mạnh hơn khoảng cách tier) để
// bảo đảm quyết định người chơi có trọng số ≥ độ hiếm (build-plan §3.3, §7.3).
export const TYPE_ADVANTAGE_MULT = 1.36;
export const TYPE_DISADVANTAGE_MULT = 0.78;
export function typeMultiplier(attacker: Element, defender: Element): number {
  if (attacker === defender) return 1.0;
  const ai = ELEMENTS.indexOf(attacker);
  const di = ELEMENTS.indexOf(defender);
  const diff = (di - ai + 5) % 5;
  if (diff === 1 || diff === 2) return TYPE_ADVANTAGE_MULT; // attacker khắc defender
  return TYPE_DISADVANTAGE_MULT; // attacker bị khắc
}
export function typeVerdict(attacker: Element, defender: Element): 'advantage' | 'disadvantage' | 'neutral' {
  const m = typeMultiplier(attacker, defender);
  return m > 1 ? 'advantage' : m < 1 ? 'disadvantage' : 'neutral';
}

// ---- Parsing dữ liệu thật -----------------------------------------------------
const CURRENT_YEAR = 2026;

// grade là chuỗi mô tả: "10 Gem Mint", "9 Mint", "8.5 NM-MT+"... → trích số đầu.
export function parseGradeNumber(grade: string | null | undefined): number | null {
  if (!grade) return null;
  const m = grade.match(/\d+(\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

// fmvPriceInUSD là USD thường ("2100"); "NO-FMV-PRICE" → null.
export function parseFmvUsd(raw: string | null | undefined): number | null {
  if (!raw || raw === 'NO-FMV-PRICE') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// askPriceInUSDT là WEI (18 số thập phân); "NO-ASK-PRICE" → null.
export function parseAskUsdt(raw: string | null | undefined): number | null {
  if (!raw || raw === 'NO-ASK-PRICE') return null;
  try {
    const n = Number(raw) / 1e18;
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// ATK = f(grade). Khoảng cách giữa các tier được NÉN CHỦ Ý (band ~58–96) để type-
// advantage có thể lật kèo — thẻ grade thấp không bị bỏ quá xa (build-plan §7.3).
export function computeAtk(gradeNum: number | null): number {
  if (gradeNum == null) return 62; // RAW / unknown
  return Math.round(clamp(58 + gradeNum * 3.7, 58, 96));
}

// DEF = f(year): vintage (năm nhỏ) có legacy bonus → "bền" hơn. Band ~62–92.
export function computeDef(year: number | null | undefined): number {
  if (!year) return 68;
  const age = clamp(CURRENT_YEAR - year, 0, 45);
  return Math.round(clamp(62 + age * 0.7, 62, 92));
}

// Element suy từ IDENTITY của set (đa dạng hơn dùng grading company, để
// type-advantage kích hoạt thường xuyên → chiều sâu chiến thuật).
export function computeElement(item: Pick<MarketplaceItem, 'setName' | 'name' | 'tokenId'>): Element {
  const key = item.setName || item.name || item.tokenId || 'x';
  return ELEMENTS[hashSeed(key) % ELEMENTS.length];
}

// Trích SERIAL giám định từ attributes (dùng để dựng URL ảnh thẳng, không cần gọi
// thêm API card-detail → tránh rate-limit khi hiển thị nhiều thẻ).
export function extractSerial(item: Pick<MarketplaceItem, 'attributes'>): string | null {
  const a = (item.attributes ?? []).find((x) => /serial/i.test(x.trait) && x.value != null);
  return a?.value != null ? String(a.value) : null;
}

// URL ảnh render slab THẬT theo serial. Biến thể phổ biến: nft_image.jpg và
// nft_image_silver.jpg (Slab tự fallback qua onError). Cùng một host cố định.
const IMG_HOST = 'https://8nothtoc5ds7a0x3.public.blob.vercel-storage.com';
// Các biến thể file quan sát được: nft_image.jpg | _silver | _golden (slab đặc biệt).
export const IMG_VARIANTS = ['nft_image.jpg', 'nft_image_silver.jpg', 'nft_image_golden.jpg'] as const;
export function imageUrlFromSerial(serial: string | null, variantIndex = 0): string | null {
  if (!serial || variantIndex >= IMG_VARIANTS.length) return null;
  return `${IMG_HOST}/graded-cards-renders/${encodeURIComponent(serial)}/${IMG_VARIANTS[variantIndex]}`;
}

// ---- Card game model ---------------------------------------------------------
export interface GameCard {
  tokenId: string;
  name: string;
  setName: string | null;
  pokemonName: string | null;
  cardNumber: string | null;
  gradingCompany: string | null;
  grade: string | null;
  gradeNum: number | null;
  year: number | null;
  fmvUsd: number | null;
  askUsdt: number | null;
  vaultLocation: string | null;
  ownerAddress: string | null;
  category: string | null;
  // stats
  atk: number;
  def: number;
  aura: number;   // 0..100 (percentile fmv trong pool)
  power: number;  // overall có trọng số
  element: Element;
  tier: Tier;
  fmvKnown: boolean;
  serial: string | null;
  // ảnh render slab THẬT, dựng thẳng từ serial (không cần gọi API card-detail).
  imageUrl: string | null;
}

// Trọng số overall power (công bố ở UI).
export const POWER_WEIGHTS = { atk: 0.42, aura: 0.3, def: 0.28 } as const;
export function computePower(atk: number, aura: number, def: number): number {
  return Math.round(POWER_WEIGHTS.atk * atk + POWER_WEIGHTS.aura * aura + POWER_WEIGHTS.def * def);
}

// percentile của value trong sorted-ascending array (0..1).
function percentileOf(sortedAsc: number[], value: number): number {
  if (sortedAsc.length === 0) return 0.5;
  let lo = 0, hi = sortedAsc.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedAsc[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo / sortedAsc.length;
}

// Xây GameCard[] từ pool marketplace: tính aura (percentile fmv) + tier
// (percentile rarityScore) TƯƠNG ĐỐI trong chính pool.
export function buildCards(items: MarketplaceItem[]): GameCard[] {
  const base = items.map((it) => {
    const gradeNum = parseGradeNumber(it.grade);
    const fmvUsd = parseFmvUsd(it.fmvPriceInUSD);
    const atk = computeAtk(gradeNum);
    const def = computeDef(it.year ?? null);
    return {
      raw: it,
      gradeNum,
      fmvUsd,
      atk,
      def,
      element: computeElement(it),
    };
  });

  // aura = percentile của fmv trong pool (thẻ thiếu fmv → aura thấp cố định).
  const fmvs = base.map((b) => b.fmvUsd).filter((v): v is number => v != null).sort((a, b) => a - b);
  // AURA band NÉN vào 48–95 (thay vì 1–100) để độ hiếm không áp đảo type/ skill.
  const withAura = base.map((b) => {
    const pct = b.fmvUsd == null ? 0.15 : percentileOf(fmvs, b.fmvUsd);
    const aura = Math.round(clamp(48 + pct * 47, 48, 95));
    return { ...b, aura, auraPct: b.fmvUsd == null ? 15 : Math.round(pct * 100) };
  });

  // rarityScore để gán tier: dùng percentile fmv THẬT (auraPct, 0–100) + grade.
  const scored = withAura.map((b) => ({
    ...b,
    rarityScore: 0.68 * b.auraPct + 0.32 * ((b.gradeNum ?? 5) / 10) * 100,
  }));
  const scoresAsc = scored.map((s) => s.rarityScore).sort((a, b) => a - b);

  return scored.map((s) => {
    const pct = percentileOf(scoresAsc, s.rarityScore); // 0..1 (thấp = kém hiếm)
    const topFrac = 1 - pct; // fraction cards ranked at/above → 0 = hiếm nhất
    const tier = TIER_CUTOFFS.find((c) => topFrac <= c.topFrac)?.tier ?? 'D';
    const power = computePower(s.atk, s.aura, s.def);
    const it = s.raw;
    const serial = extractSerial(it);
    return {
      tokenId: it.tokenId,
      name: it.name,
      setName: it.setName ?? null,
      pokemonName: it.pokemonName ?? null,
      cardNumber: it.cardNumber ?? null,
      gradingCompany: it.gradingCompany ?? null,
      grade: it.grade ?? null,
      gradeNum: s.gradeNum,
      year: it.year ?? null,
      fmvUsd: s.fmvUsd,
      askUsdt: parseAskUsdt(it.askPriceInUSDT),
      vaultLocation: it.vaultLocation ?? null,
      ownerAddress: it.ownerAddress ?? null,
      category: it.type ?? null,
      atk: s.atk,
      def: s.def,
      aura: s.aura,
      power,
      element: s.element,
      tier,
      fmvKnown: s.fmvUsd != null,
      serial,
      imageUrl: imageUrlFromSerial(serial),
    } satisfies GameCard;
  });
}

// Mô tả công thức để hiển thị minh bạch trong UI.
export const STAT_FORMULA_NOTES = {
  atk: 'ATK = 58 + (số grade × 3.7), giới hạn 58–96. RAW/không rõ grade = 62.',
  def: 'DEF = 62 + tuổi thẻ × 0.7 (vintage có legacy bonus), giới hạn 62–92.',
  aura: 'AURA = 48 + 47·percentile(FMV) trong pool, giới hạn 48–95 (band nén để độ hiếm không áp đảo).',
  power: `POWER = ${POWER_WEIGHTS.atk}·ATK + ${POWER_WEIGHTS.aura}·AURA + ${POWER_WEIGHTS.def}·DEF.`,
  element: `ELEMENT suy từ định danh set (deterministic). Type-advantage RPSLS 5 chiều: mỗi element khắc 2 element kế tiếp (×${TYPE_ADVANTAGE_MULT}), bị 2 element trước khắc (×${TYPE_DISADVANTAGE_MULT}). Đây là đòn bẩy mạnh nhất — khéo chọn khắc chế có thể lật thẻ tier cao (đã cân bằng qua self-test: deck khéo tier thấp thắng deck tier cao ~43%).`,
  tier: 'TIER gán theo percentile rarityScore (0.68·percentile-FMV + 0.32·grade) trong pool.',
} as const;
