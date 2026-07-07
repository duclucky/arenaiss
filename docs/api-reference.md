# API Reference — nguồn dữ liệu Renaiss (ground truth)

Bám đúng file này, ĐỪNG bịa endpoint. Tất cả đều đang BETA — coi output là tham
chiếu thử nghiệm, không phải sự thật đã xác minh. Nếu tên field/method lệch với
thực tế khi chạy, tin vào type thật của package/response đang có và cập nhật lại
file này.

> ## ⚠️ RECONCILIATION 2026-07-07 (đối chiếu type/response THẬT — đọc trước)
> Đã cài `@renaiss-protocol/client@0.1.0-alpha.1` và probe live 3 nguồn. Khác biệt
> so với mô tả gốc bên dưới — chỗ nào lệch thì TIN mục này:
>
> **1. SDK KHÔNG có `chance` (odds thật) và gacha reads 404 trong môi trường này.**
> - Schema thật: `GachaMachineSchema = { slug, name, packType, stage, description,
>   author, priceInUsdt, expectedValueInUsd, featuredCardFmvInUsd, packBannerVideoUrl,
>   gachaMachineVideoUrl, gachaRippingPackAnimationVideoUrl }` — KHÔNG có mảng tier/chance.
> - `GachaMachineContentSchema = { name, tier: string, buybackBaseValueInUsd, frontImageUrl }`
>   — có tier LABEL nhưng KHÔNG có xác suất.
> - `client.listGachaMachines()` / raw `/v0/gacha/packs` → **404 Not Found** (public
>   read path chưa mở ở env này). ⇒ Không lấy được odds thật.
> - **HỆ QUẢ (đã chốt):** odds tier được ƯỚC LƯỢNG minh bạch từ THÀNH PHẦN POOL
>   `/v0/marketplace` (tier suy từ grade+fmv percentile — xem stat engine). Nhãn rõ:
>   "odds ước lượng từ thành phần pool marketplace thật; gacha odds on-chain chưa
>   công khai ở API alpha". Đây là giả định bắt buộc do dữ liệu, KHÔNG phải bịa.
> - Forbidden vẫn tuyệt đối: `createSecureClient`, `pullGacha`, `buybackGacha`,
>   `approvePermit2Usdt`, `deploySafeWallet`, signer.
>
> **2. `/v0/marketplace` — list item KHÔNG có ảnh, KHÔNG có `custodyProvider` object.**
> - List item thật: `{ tokenId, name, setName, cardNumber, pokemonName, ownerAddress,
>   askPriceInUSDT, fmvPriceInUSD, vaultLocation, grade, gradingCompany, year,
>   attributes[], owner }`. KHÔNG có `frontImageUrl`/`backImageUrl` ở list.
> - `askPriceInUSDT` là **wei (18 số thập phân)** → chia 1e18. `fmvPriceInUSD` là
>   **USD thường** (vd "2100"). `grade` là CHUỖI mô tả (vd "9 Mint", "10 Gem Mint")
>   → phải trích số grade ra.
> - Ảnh + custody chỉ có ở **`/v0/cards/{tokenId}`**: `collectible` thêm
>   `frontImageUrl, backImageUrl, frontWithoutStandImageUrl, vaultRegionCountryCode,
>   askExpiresAt`. KHÔNG có object `custodyProvider{businessName,countryCode}` — chỉ
>   có `vaultLocation` + `vaultRegionCountryCode` (mã quốc gia). ⇒ **Draw xong thì
>   HYDRATE từng lá qua `/v0/cards/{tokenId}`** để lấy ảnh + custody + passport.
> - `activities[]` item thật: `{ user, timestamp(unix string), blockNumber, txHash,
>   ordinal, tokenId, type, to? }`; `sell` thêm `amount` v.v.
>
> **3. Index API — href là `/card/` (số ít), endpoint detail là `/v1/cards/` (số nhiều).**
> - `/v1/search?q=` item đã kèm sẵn: `priceUsdCents, deltaPct, confidence, gradeLabel,
>   company, grade, imageUrl, lastSaleAt, href`. `href` dạng `/card/{game}/{set}/{card}`.
> - Detail: đổi `/card/`→`/cards/` rồi GET `/v1/cards/{game}/{set}/{card}`. Trả về
>   `priceUsdCents, deltas{d7,d30,d365}, confidence, sourceCount, observationCount,
>   totalObservationCount, observationWindowDays, updatedAt, lastSaleAt, refreshing,
>   sourceBreakdown[{source,bucket,displayName,count,medianUsdCents}],
>   sourceBreakdownAllTime[], trackedSources[]`. (`methods`/`otherGrades`/`similar`
>   có thể có tuỳ thẻ.) Proxy mẫu `app/api/index/card/[game]/[set]/[card]` ĐÚNG (plural).

Ranh giới an toàn (áp cho MỌI nguồn): CHỈ đọc (GET / public client). TUYỆT ĐỐI
KHÔNG: private key, ký ví, `pullGacha`, `buyback`, `createSecureClient`, giao dịch
on-chain. Mọi key đặt server-side.

---

## A) Marketplace API — `https://api.renaiss.xyz` (v0)

Tầng marketplace/gacha on-chain. Chỉ dùng các GET dưới đây.

### GET /v0/marketplace  → dùng làm POOL rút thẻ
Query: `search`, `categoryFilter` (POKEMON | ONE_PIECE), `listedOnly`,
`gradingCompanyFilter` (PSA | BGS | CGC | SGC), `gradeFilter`, `yearRange`,
`priceRangeFilter`, `sortBy` (fmvPriceInUsd | year | grade | name | listDate |
mintDate), `sortOrder`, `limit`, `offset`.

Trả về `collection[]` mỗi phần tử:
- `tokenId`, `name`, `setName`, `cardNumber`, `pokemonName`
- `ownerAddress`, `owner { id, username }`
- `askPriceInUSDT`  → có thể là `"NO-ASK-PRICE"`
- `fmvPriceInUSD`   → có thể là `"NO-FMV-PRICE"`
- `frontImageUrl`, `backImageUrl`
- `attributes[] { trait, value }`
- `vaultLocation` ("third-party" | "platform")
- `gradingCompany`, `grade`, `year`
- `custodyProvider { id, businessName, countryCode }`
- `type` (POKEMON | ONE_PIECE | SPORTS)
+ `pagination { total, limit, offset, hasMore }`

LƯU Ý: không có filter theo owner ở đây. Muốn "thẻ của một ví" phải quét nhiều
trang rồi lọc client-side theo `ownerAddress` (chỉ thấy thẻ đang list).

### GET /v0/cards/{tokenId}?includeActivities=true&verbosePrice=true → Card Passport
Trả về:
- `collectible { ...như trên..., ownerAcquiredAt }`
- `pricing { price, top_offer, last_sale, price_history[] { timestamp, amount },
  offers[] { from { username, address }, timestamp, amount, status, expiresAt } }`
- `activities { activities[]: mint | burn | transfer | sell }` — mỗi activity có
  `user, timestamp, blockNumber, txHash, ordinal, tokenId`; riêng `sell` có
  `bidder, asker, nftTokenId, erc20Token, amount, feeAccrued`. Phân trang bằng
  `nextCursor` (query `activitiesCursor`, `activitiesLimit`).

### GET /v0/packs  và  GET /v0/packs/{slug} → nút "làm sao sở hữu thật"
`/v0/packs` → `cardPacks[] { slug, name, packType (limited|perpetual), stage,
description, author, priceInUsdt, expectedValueInUsd, featuredCardFmvInUsd }`
(KHÔNG kèm nội dung/odds gói).
`/v0/packs/{slug}` → như trên + `recentOpenedPacks[] { collectibleTokenId, tier,
fmv, pulledAtTimestamp }`. Nội dung/odds đầy đủ của gói KHÔNG trả về ở đây.

### GET /v0/users/{id} → (stretch) My Collection mode
`username, avatarUrl, favoritedCollectibles[], favoritedSBTs[] { id, title,
description, imageUrl }`.

---

## B) SDK chính thức — `@renaiss-protocol/client` (npm, tag `alpha`)

Wrap gacha API `api.renaiss.xyz`. Cài: `npm i @renaiss-protocol/client@alpha`
(Node ≥ 22). Các Zod schema lấy QUA package này (package `schema-validation`
không publish riêng).

Chỉ dùng client READ-ONLY:
```ts
import { createPublicClient } from "@renaiss-protocol/client";
const renaiss = createPublicClient(/* { environment } */);
```
Public reads dùng cho game (xác nhận tên chính xác với type đã cài — đây là alpha):
- `listGachaMachines()` — danh sách máy gacha (≈ "gói").
- `fetchGachaMachine(idOrSlug)` — chi tiết + trạng thái.
- `listGachaMachineContents(idOrSlug)` — pool + tier.
- (`listGachaBuybackOffers` — nếu là public read; nếu cần auth thì BỎ.)

Schema liên quan: `GachaMachine`, `GachaMachineDetail`, `GachaMachineContent`,
`GachaMachineTier { tier, name, chance }`. → `chance` là ODDS thật theo tier.

TUYỆT ĐỐI KHÔNG dùng: `createSecureClient`, `signer`, `pullGacha`, `buybackGacha`,
`deploySafeWallet`, `approvePermit2Usdt` — đều là đường transactional/ký ví.

Pattern SDK cần áp cho TOÀN bộ app (kể cả phần fetch tay): validate bằng Zod;
errors-as-values (`Result`, `isSuccess`/`isFailed`) thay vì throw; `list*` cho
phân trang, `fetch*` cho đọc đơn lẻ.

---

## C) Index API — `https://api.renaissos.com` (v1) → Card Passport

Tầng giá reference đa nguồn + định giá. Auth partner (server-side):
headers `X-Api-Key: rk_...` và `X-Api-Secret: rsk_...`. Public tier không key bị
giới hạn ~10 req/ngày/IP → luôn đi qua proxy có key. Khi hiển thị số công khai:
attribution "Renaiss OS Index".

- `GET /v1/search?q=` → `results[]` có `href` dạng `/card/{game}/{set}/{card}`.
  Dùng để resolve tên thẻ → slug.
- `GET /v1/cards/{game}/{set}/{card}` →
  `priceUsdCents`, `deltas { d7, d30, d365 }`,
  `confidence` (high | medium | low), `sourceCount`, `observationCount`,
  `observationWindowDays`, `lastSaleAt`,
  `sourceBreakdown[] { source, bucket (public | renaiss | partner), count,
  medianUsdCents }`,
  `methods[] { method (median | mean | vwap), priceUsdCents, confidence }`,
  `otherGrades[]`, `similar[]`.
- (Tuỳ) `GET /v1/graded/{cert}` → `{ found, grade, gradeLabel, card,
  certImages { front, back, item }, reason }`.
- (Wow, tuỳ) `POST /v1/graded/by-image` (multipart, field `file`, ≤15MB) → SSE:
  event `progress` (PipelineProgress), rồi `result` (kiểm tra `found`) hoặc
  `failed`. Tiêu thụ bằng reader; proxy relay SSE về client.

Explorer/spec: `https://api.renaissos.com/docs`, `https://api.renaissos.com/v1/openapi.json`.

---

## Logic gacha LAI (đã chốt) — odds thật + pool marketplace
1. Đọc `GachaMachineTier.chance` (SDK) → lấy xác suất theo tier. Hiển thị bảng
   odds này minh bạch trong UI mở gói.
2. Khi "mở gói": bốc tier theo `chance` thật, rồi RÚT ngẫu nhiên một mẫu thẻ
   thuộc tier đó từ `/v0/marketplace` (lọc theo tier/grade tương ứng).
3. Ghi nhãn: odds tham chiếu từ gói Renaiss thật; pool minh hoạ từ marketplace.
Lý do: pool marketplace đủ rộng & đa dạng để cân bằng; odds vẫn "thật".
