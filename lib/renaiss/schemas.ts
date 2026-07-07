import { z } from 'zod';

// Zod schema cho response THẬT của các nguồn Renaiss (đối chiếu probe 2026-07-07).
// Nguyên tắc: LỎNG (nullable/optional/catch) vì data beta có thể thiếu/trễ.
// Số/giá là CHUỖI ở nguồn — giữ nguyên chuỗi ở đây, chuẩn hoá ở stat/normalize layer.

// ---- A) Marketplace ----------------------------------------------------------
export const AttributeSchema = z.object({
  trait: z.string(),
  value: z.union([z.string(), z.number()]).nullable().optional(),
});

// List item /v0/marketplace (KHÔNG có ảnh ở list — ảnh lấy khi hydrate detail).
export const MarketplaceItemSchema = z.object({
  tokenId: z.string(),
  name: z.string(),
  setName: z.string().nullable().optional(),
  cardNumber: z.string().nullable().optional(),
  pokemonName: z.string().nullable().optional(),
  ownerAddress: z.string().nullable().optional(),
  askPriceInUSDT: z.string().nullable().optional(), // wei (18 decimals)
  fmvPriceInUSD: z.string().nullable().optional(),  // USD thường
  vaultLocation: z.string().nullable().optional(),
  grade: z.string().nullable().optional(),          // vd "9 Mint", "10 Gem Mint"
  gradingCompany: z.string().nullable().optional(),
  year: z.number().nullable().optional(),
  type: z.string().nullable().optional(),
  attributes: z.array(AttributeSchema).nullable().optional(),
  owner: z.any().optional(),
});
export type MarketplaceItem = z.infer<typeof MarketplaceItemSchema>;

export const PaginationSchema = z.object({
  total: z.number().optional(),
  limit: z.number().optional(),
  offset: z.number().optional(),
  hasMore: z.boolean().optional(),
});

export const MarketplaceResponseSchema = z.object({
  collection: z.array(MarketplaceItemSchema).default([]),
  pagination: PaginationSchema.optional(),
});
export type MarketplaceResponse = z.infer<typeof MarketplaceResponseSchema>;

// Card detail /v0/cards/{tokenId} — có ảnh + custody + activities.
export const CollectibleSchema = MarketplaceItemSchema.extend({
  frontImageUrl: z.string().nullable().optional(),
  backImageUrl: z.string().nullable().optional(),
  frontWithoutStandImageUrl: z.string().nullable().optional(),
  vaultRegionCountryCode: z.string().nullable().optional(),
  askExpiresAt: z.union([z.string(), z.number()]).nullable().optional(),
  ownerAcquiredAt: z.union([z.string(), z.number()]).nullable().optional(),
});
export type Collectible = z.infer<typeof CollectibleSchema>;

export const ActivitySchema = z.object({
  type: z.string(),
  user: z.string().nullable().optional(),
  to: z.string().nullable().optional(),
  from: z.string().nullable().optional(),
  bidder: z.string().nullable().optional(),
  asker: z.string().nullable().optional(),
  timestamp: z.union([z.string(), z.number()]).nullable().optional(),
  blockNumber: z.union([z.string(), z.number()]).nullable().optional(),
  txHash: z.string().nullable().optional(),
  amount: z.union([z.string(), z.number()]).nullable().optional(),
  ordinal: z.union([z.string(), z.number()]).nullable().optional(),
});
export type Activity = z.infer<typeof ActivitySchema>;

// Pricing sub-shapes ở beta rất biến thiên (amount có thể là object/null/…).
// Giữ LỎNG để một field lạ không làm hỏng cả payload; chuẩn hoá ở tầng dùng.
export const CardDetailSchema = z.object({
  collectible: CollectibleSchema,
  pricing: z
    .object({
      price: z.any().optional(),
      top_offer: z.any().optional(),
      last_sale: z.any().optional(),
      price_history: z.array(z.any()).nullable().optional(),
      offers: z.array(z.any()).nullable().optional(),
    })
    .loose()
    .nullable()
    .optional(),
  activities: z
    .object({
      activities: z.array(ActivitySchema).default([]),
      nextCursor: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});
export type CardDetail = z.infer<typeof CardDetailSchema>;

// Packs /v0/packs — nút "làm sao sở hữu thật".
export const CardPackSchema = z.object({
  slug: z.string(),
  name: z.string(),
  packType: z.string().nullable().optional(),
  stage: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  author: z.string().nullable().optional(),
  priceInUsdt: z.string().nullable().optional(),
  expectedValueInUsd: z.string().nullable().optional(),
  featuredCardFmvInUsd: z.string().nullable().optional(),
});
export type CardPack = z.infer<typeof CardPackSchema>;

export const PacksResponseSchema = z.object({
  cardPacks: z.array(CardPackSchema).default([]),
});

// ---- C) Index API ------------------------------------------------------------
export const IndexSearchItemSchema = z.object({
  game: z.string().nullable().optional(),
  type: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  setName: z.string().nullable().optional(),
  setCode: z.string().nullable().optional(),
  cardNumber: z.string().nullable().optional(),
  variation: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  imageUrlThumb: z.string().nullable().optional(),
  company: z.string().nullable().optional(),
  grade: z.string().nullable().optional(),
  gradeLabel: z.string().nullable().optional(),
  priceUsdCents: z.number().nullable().optional(),
  deltaPct: z.number().nullable().optional(),
  confidence: z.string().nullable().optional(),
  lastSaleAt: z.string().nullable().optional(),
  href: z.string().nullable().optional(),
});
export type IndexSearchItem = z.infer<typeof IndexSearchItemSchema>;

export const IndexSearchResponseSchema = z.object({
  query: z.string().optional(),
  results: z.array(IndexSearchItemSchema).default([]),
});

export const SourceBreakdownSchema = z.object({
  source: z.string().nullable().optional(),
  bucket: z.string().nullable().optional(),
  displayName: z.string().nullable().optional(),
  count: z.number().nullable().optional(),
  medianUsdCents: z.number().nullable().optional(),
});

export const IndexCardSchema = z.object({
  id: z.string().optional(),
  game: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  setName: z.string().nullable().optional(),
  company: z.string().nullable().optional(),
  grade: z.string().nullable().optional(),
  gradeLabel: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  imageUrlLg: z.string().nullable().optional(),
  priceUsdCents: z.number().nullable().optional(),
  deltas: z
    .object({ d7: z.number().nullable().optional(), d30: z.number().nullable().optional(), d365: z.number().nullable().optional() })
    .nullable()
    .optional(),
  confidence: z.string().nullable().optional(),
  sourceCount: z.number().nullable().optional(),
  observationCount: z.number().nullable().optional(),
  totalObservationCount: z.number().nullable().optional(),
  observationWindowDays: z.number().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
  lastSaleAt: z.string().nullable().optional(),
  refreshing: z.boolean().nullable().optional(),
  sourceBreakdown: z.array(SourceBreakdownSchema).nullable().optional(),
  methods: z
    .array(z.object({ method: z.string().nullable().optional(), priceUsdCents: z.number().nullable().optional(), confidence: z.string().nullable().optional() }))
    .nullable()
    .optional(),
});
export type IndexCard = z.infer<typeof IndexCardSchema>;

// Helper: parse + trả về Result thay vì throw.
export type Parsed<T> = { ok: true; data: T } | { ok: false; error: string };
export function safeParse<T>(schema: z.ZodType<T>, raw: unknown): Parsed<T> {
  const r = schema.safeParse(raw);
  if (r.success) return { ok: true, data: r.data };
  return { ok: false, error: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
}
