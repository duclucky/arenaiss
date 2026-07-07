# HANDOFF — trạng thái bàn giao giữa các phiên / agent

File TRẠNG THÁI SỐNG, dùng chung cho MỌI agent (Claude Code, Codex) và mọi phiên.
Đọc file này ĐẦU TIÊN để lấy bối cảnh, rồi ĐỐI CHIẾU với `git log --oneline -10`
và `git status` (git là nguồn sự thật về code; file này là nguồn sự thật về Ý
ĐỊNH & bối cảnh). Luật bất biến nằm ở CLAUDE.md / AGENTS.md — KHÔNG lặp ở đây.

QUY TẮC (bắt buộc): trước khi kết thúc phiên (hoặc khi sắp hết quota), agent PHẢI
cập nhật 4 mục: "Đang làm gì", "Đã xong", "Tiếp theo", "Nhật ký". Ghi ngắn gọn,
trung thực, kèm tên file cụ thể. Nếu để lại code viết dở/không build được, GHI RÕ
ở "Cảnh báo".

---

## Cập nhật phiên Codex 2026-07-07 21:37 UTC
- Agent: codex
- Commit gần nhất trước cập nhật này: `2f576e2` — "done: remove duplicate deck passport button"
- Commit phiên này: chuẩn bị commit "chore: clear lint debt"

### Đang làm gì
Không có code đang viết dở. Phiên này tập trung dọn lint debt còn lại sau auth/browser-comment work:
hook reset trong `components/Slab.tsx`, `features/pack-open/PackOpen.tsx`,
`features/passport/PassportDrawer.tsx`, và các unused warning ở battle/balance.

### Đã xong
- `components/Slab.tsx`: bỏ reset state trong effect; image fallback variant nay reset theo image key.
- `features/pack-open/PackOpen.tsx`: tách `PackOpenSequence` keyed by `pack.seed`, bỏ reset animation sync trong effect, bỏ import unused.
- `features/passport/PassportDrawer.tsx`: tách wrapper/content keyed by `tokenId`; loading/detail/narration reset bằng initial state khi đổi card.
- `features/battle/Battle.tsx`, `scripts/balance.mts`: dọn unused variables.
- Verify mới nhất: `npm.cmd run lint` PASS; `npm.cmd run test:unit` PASS; `npm.cmd run typecheck` PASS; `npm.cmd run build` PASS; production e2e qua server tạm `http://127.0.0.1:3002` PASS toàn hero loop, 0 console error; bundle scan `.next/static` không có secret/write-SDK symbols.

### Tiếp theo
1. Nếu còn polish UI từ browser comments, xử lý theo comment mới nhất và cập nhật e2e assertion tương ứng.
2. Test thủ công auth UI bằng `python run_local.py`: register → chuyển về login → login lại → xác nhận account save synced.
3. Khi deploy thật, thay JSON file store trong `data/` bằng DB/KV bền vững và đặt `AUTH_SECRET` random ở server env.

### Cảnh báo
- Auth vẫn là demo username/password JSON store theo yêu cầu hiện tại, chưa phải production auth.
- `ANTHROPIC_API_KEY` chưa cấu hình thì Passport AI chạy deterministic fallback.
- Gacha odds vẫn là ước lượng từ marketplace pool, không phải on-chain odds thật.

### Nhật ký
- 2026-07-07 codex: Dọn lint debt còn lại bằng refactor keyed component/state thay vì disable rule rộng; chạy lint/unit/typecheck/build/e2e/bundle scan đều đạt. Có thử launch server background trên 3001/3002; e2e ổn định nhất khi start production server trong cùng PowerShell job rồi cleanup.

---

## Cập nhật lần cuối
- Thời điểm: 2026-07-07 17:25 UTC
- Agent: codex
- Commit gần nhất trước cập nhật này: `f5697a1` — "done: add exact marketplace card links"
- Commit phiên này: chuẩn bị commit "done: remove duplicate deck passport button"

## Đang làm gì (current focus)
Không có file nào đang viết dở. Đã bỏ nút `Passport` phụ trong Deck collection vì
slab đã có nút `View Passport` cố định ở footer; e2e có regression assertion cho việc
không render nút phụ này.

## Đã xong (theo bước ở docs/build-plan.md mục 7)
- [x] B1. Data layer + proxy routes + Zod schema — `app/api/{pool,cards,packs,index/*,passport/narrate}/route.ts`, `lib/renaiss/{schemas,index.server,marketplace.server}.ts`
- [x] B2. Stat engine + gacha engine LAI — `lib/game/{stats,gacha}.ts`. LƯU Ý: SDK alpha
      KHÔNG có field `chance` thật (đã đối chiếu + sửa `docs/api-reference.md` mục
      "RECONCILIATION 2026-07-07") → odds hiển thị là ƯỚC LƯỢNG từ thành phần pool
      marketplace thật, có nhãn rõ, không phải xác suất on-chain.
- [x] B3. Battle engine + cân bằng — `lib/game/battle.ts`, `lib/game/opponent.ts`.
      Tự-test bằng `scripts/balance.mts` + `scripts/sweep.mts`: type-mult 1.36/0.78
      cho fairness ~52%, deck khéo tier thấp thắng tier cao ~42% (skill ≥ rarity).
- [x] B4. UI hero loop — `app/arena/{ArenaApp,state}.tsx`, `components/{Slab,Hud,TierLegend}.tsx`,
      `features/{intro,pack-open,roster,deck-builder,battle,result}/*.tsx`. Ảnh thẻ
      dựng thẳng từ Serial (attributes) → `graded-cards-renders/{serial}/nft_image[_silver|_golden].jpg`,
      KHÔNG cần gọi thêm API/thẻ (tránh rate-limit marketplace). Verify bằng
      `scripts/e2e.mjs` (Playwright headless) — chạy hết vòng, 0 console error.
      Browser-comment polish mới nhất: header chỉ giữ credits/reset/auth; slab có tier
      trong badge grade và nút `View Passport` cố định ở footer.
- [x] B5. Card Passport drawer + AI narration + nút "own it for real" —
      `features/passport/PassportDrawer.tsx`, `lib/passport/prompt.ts`,
      `app/api/passport/narrate/route.ts`. AI narration DÙNG FALLBACK deterministic
      (chưa có `ANTHROPIC_API_KEY` trong `.env.local`) — vẫn tôn trọng đủ 6 nguyên
      tắc bất biến của prompt (nguồn+thời điểm, không bịa, không khẳng định gian lận...).
- [x] B6. Polish + README nộp bài + kịch bản video — `README.md` (tiếng Anh, đầy đủ
      data sources/attribution/assumptions/limitations/safety + 6 gạch đầu dòng demo).
      Đã build production + quét bundle client (xem "Cảnh báo" bên dưới về kết quả).
- [x] B2 bổ sung còn thiếu: credit pure function + anonymous save layer —
      `lib/game/credit.ts`, `lib/game/save.ts`, `app/arena/state.tsx`,
      `tests/credit-save.test.mts`. Luật refill: qua mốc 00:00 UTC, nếu credit
      <100 thì đặt về 200; credit >=100 không đổi; không cộng dồn.
- Stretch/Core còn lại: [x] Simple username/password login + server-side account save
  [ ] by-image scan.

## Tiếp theo (next steps — cụ thể, làm được ngay)
1. Test thủ công auth UI: chạy `python run_local.py` rồi bấm `Register`, nhập
   username/password/confirm; sau khi tạo xong UI tự chuyển về `Login`; đăng nhập
   lại bằng username/password.
2. Khi cần deploy thật, thay JSON file store trong `data/users.json` và
   `data/account-saves.json` bằng DB/KV bền vững; nhớ đặt `AUTH_SECRET` random trong
   môi trường server.
3. Bật AI narration thật: thêm `ANTHROPIC_API_KEY=sk-ant-...` vào `.env.local`,
   test lại `/api/passport/narrate` để `mode` trả về `"ai"` thay vì `"fallback"`.
4. (Tuỳ) Quay video demo theo 6 gạch đầu dòng trong `README.md` mục cuối.

## Quyết định đã chốt (để agent sau không hỏi lại)
- App tiếng ANH toàn bộ (UI/copy/README/video). Trao đổi với chủ dự án có thể VN.
- Loop (bản chuẩn): Open packs using reference odds → collect fictional cards
  based on real graded-card data → build a deck → battle in a skill-based
  Top-Trumps game. Win VIRTUAL credits to open more. Every card links to its
  real Card Passport. (Thẻ game là "dựa trên dữ liệu thẻ thật", KHÔNG phải NFT
  người chơi sở hữu.)
- Hai chế độ lưu đã có: (a) ẩn danh → localStorage; (b) username/password test account →
  server-side JSON save. Google login đã bị bỏ theo yêu cầu mới nhất của chủ dự án.
- Credit: hồi mỗi ngày lúc 00:00 UTC, CHỈ với id có credit < 100, NẠP CHO ĐỦ VỀ
  200 (không cộng dồn). Là hàm thuần dùng chung; chế độ login thực thi ở server
  (đáng tin), chế độ ẩn danh tính ở client (kiểu "danh dự", không chống gian lận
  — chấp nhận được vì credit ẢO).
- Thẻ: layout lại để HẾT chồng chữ — thứ tự dọc [thanh tier]→[nhãn: tên+grade]→
  [ảnh]→[ATK·DEF·AURA 3 cột đều]→[POWER dải riêng]→[nút Passport tách khỏi hàng
  chỉ số]. Tên thẻ tối đa 2 dòng + ellipsis.
- CTA "bấm được": cả thẻ cursor:pointer + hover nhấc/sáng viền; nút `View Passport`
  luôn hiện ở footer cạnh `PWR`, không dùng overlay hover-only và không dùng icon info
  ở góc thẻ; hint 1 lần sau gói đầu "Tap any card to view its real Card Passport".
  Màn kết quả có nút thoát rõ ("Add to collection →"/"Continue") tách khỏi CTA Passport.

## Cảnh báo / nợ kỹ thuật (đọc kỹ trước khi code tiếp)
- **Auth hiện là local/demo JSON store, không phải production auth.** Password được
  hash bằng scrypt, session là HttpOnly signed cookie, save nằm server-side trong
  `data/` (đã gitignore). Theo yêu cầu chủ dự án, không có rate-limit/captcha/email
  verification. Nếu deploy thật cần DB/KV bền vững và `AUTH_SECRET` random.
- **Chưa cấu hình `ANTHROPIC_API_KEY`** trong `.env.local` → Card Passport AI
  narration đang chạy ở chế độ fallback (deterministic summary từ dữ liệu đã
  validate, tiếng Anh). Route `/api/passport/narrate` đã sẵn code gọi Anthropic
  Messages API khi có key — chỉ cần điền key là chuyển sang `mode: "ai"`.
- **Odds gacha là ước lượng, không phải on-chain thật** — do SDK alpha
  `@renaiss-protocol/client@0.1.0-alpha.1` không có field `chance` và
  `listGachaMachines()`/`/v0/gacha/packs` trả 404 trong môi trường này (đã xác
  nhận bằng probe trực tiếp, ghi trong `docs/api-reference.md` mục
  "RECONCILIATION 2026-07-07"). Nếu sau này Renaiss mở endpoint odds thật, cần
  sửa `lib/game/gacha.ts` (`TIER_ODDS`, `oddsTable`) để đọc odds thật thay vì ước
  lượng — hiện đang đúng ý CLAUDE.md ("đừng bịa endpoint", có nhãn rõ) nhưng vẫn
  là một giả định cần biết.
- **Marketplace upstream rate-limit khá gắt** khi burst nhiều request liên tiếp
  (`/v0/marketplace` trả 403/5xx nếu gọi dồn dập) — đã có retry+backoff ở
  `lib/renaiss/marketplace.server.ts` và `lib/client/api.ts`, và ảnh thẻ đã
  chuyển sang dựng từ serial (không gọi API) để giảm tải. Nếu thêm tính năng gọi
  `/api/cards/{tokenId}` hàng loạt (vd batch passport), nhớ giới hạn concurrency.
- **`.venv/` là thư mục lạ** (Python venv, ~7MB) nằm ở gốc repo, không liên quan
  Next.js — đã thêm vào `.gitignore`, KHÔNG commit, KHÔNG xoá (không rõ nguồn gốc,
  để an toàn). `env.example.txt` là bản sao y hệt `.env.example` — vô hại, không
  cần sửa.
- Verify mới nhất phiên Codex: `npm.cmd run lint` PASS; `npm.cmd run test:unit`
  PASS; `npm.cmd run typecheck` PASS; `npm.cmd run build` PASS; production e2e qua
  server tạm `http://127.0.0.1:3002` PASS toàn hero loop + browser-comment assertions,
  0 console error; HTTP API smoke test register/login/session/account-save PASS từ
  phiên auth; bundle scan `.next/static` không có `rk_`/`rsk_`/`X-Api-Secret`/
  `ANTHROPIC_API_KEY`/`createSecureClient`/`pullGacha`/`buybackGacha`/
  `approvePermit2Usdt`/`deploySafeWallet`.

## Nhật ký ngắn (mới nhất lên đầu)
- 2026-07-07 codex: Xử lý browser comment Deck: bỏ nút `Passport` overlay phụ trong
  `features/deck-builder/DeckBuilder.tsx`; giữ CTA duy nhất là `View Passport` trong
  `components/Slab.tsx`. `scripts/e2e.mjs` thêm assertion không còn `.card-grid`
  button text `Passport`.
- 2026-07-07 codex: Làm rõ ownership trong Passport: thêm `lib/renaiss/links.ts`
  với `renaissCardUrl()` = `https://www.renaiss.xyz/card/{tokenId}` (đã probe 200),
  `renaissGachaPackUrl()`, `renaissGachaUrl()`; `features/passport/PassportDrawer.tsx`
  hiện nút `Buy this card on marketplace` khi `askPriceInUSDT` có giá, fallback
  `Open this card page` khi không listed. `lib/game/stats.ts` giữ raw
  `askPriceInUSDT` trong `GameCard`; thêm `tests/renaiss-links.test.mts`; e2e assert
  ownership links dùng `/card/` và không trỏ homepage.
- 2026-07-07 codex: Xử lý browser comments Passport: `features/passport/PassportDrawer.tsx`
  thêm note nguồn `Renaiss /v0/packs` qua proxy `/api/packs`, format `priceInUsdt`
  từ base units 18 decimals, format EV/top prize từ cent-like strings, đổi từng pack
  thành link riêng `https://www.renaiss.xyz/gacha/{slug}`, và thay dòng delta toàn
  `—` bằng empty state "Recent trend unavailable". `scripts/e2e.mjs` thêm regression
  assertions cho raw price/link pack/delta; `docs/api-reference.md` ghi lại units.
- 2026-07-07 codex: Xử lý browser comments: `components/AuthPanel.tsx` đổi message
  logged-out sang "Log in to sync progress on the server."; `components/Hud.tsx`
  bỏ hai chip "Read-only"/"Local save"; `components/Slab.tsx` + `app/globals.css`
  bỏ icon info/overlay hover, hiện tier trong badge grade và thêm nút `View Passport`
  cố định cạnh `PWR`; `scripts/e2e.mjs` thêm assertion cho các yêu cầu này và sửa
  catch để e2e trả exit code 1 khi fail.
- 2026-07-07 codex: Triển khai đăng ký/đăng nhập đơn giản theo yêu cầu mới nhất
  (không Google/email code): `lib/auth/{credentials,session,store}.ts`,
  `app/api/auth/{register,login,logout,session}/route.ts`,
  `app/api/account/save/route.ts`, `lib/auth/account-save.server.ts`,
  `components/AuthPanel.tsx`, `lib/client/auth.ts`. Register chỉ tạo account rồi
  chuyển về Login; login set HttpOnly cookie; server save dùng cùng pure daily
  credit refill. Thêm `tests/auth.test.mts`, cập nhật README/env mẫu và e2e nhận
  `E2E_BASE_URL`.
- 2026-07-07 codex: Thêm `run_local.py` để chủ dự án chạy local dễ hơn:
  `python run_local.py` sẽ gọi `npm run dev -- --hostname localhost --port 3000`,
  đợi server phản hồi rồi mở browser. Verify helper bằng `python -m py_compile
  run_local.py` và `python run_local.py --help`. Chưa bắt đầu code Google login.
- 2026-07-07 codex: Dịch UI/copy sản phẩm sang tiếng Anh (`components/`,
  `features/`, `app/layout.tsx`, `README.md`, `prompts/passport-narration.md`,
  `lib/passport/prompt.ts`); thêm CTA slab `ⓘ` + overlay "View Passport →" +
  hint một lần sau gói đầu; thêm anonymous localStorage save (`lib/game/save.ts`,
  `app/arena/state.tsx`) với version/savedAt/reset/pullHistory; thêm pure daily
  credit refill (`lib/game/credit.ts`) + unit test (`tests/credit-save.test.mts`).
  Verify: unit/typecheck/build/e2e đều pass, bundle scan không lộ key/secret/write
  SDK symbols. Dev server đang chạy ở `http://localhost:3000` trong phiên này.
- 2026-07-07 claude-code: `git init` + commit đầu tiên (`6e56231`) vì repo chưa hề
  có git trước đó. Cập nhật HANDOFF.md với tiến độ THẬT (B1→B6 xong), xác nhận lại
  bằng build production sạch + quét bundle an toàn. Ghi rõ nợ kỹ thuật quan trọng
  nhất: UI đang tiếng Việt (vi phạm CLAUDE.md), chưa có persistence/Google login.
- 2026-07-07 claude-code: Build trọn hero loop từ đầu (dự án trước đó chỉ có
  starter kit, chưa có `package.json`/code app). Scaffold Next.js, cài SDK +
  zod + framer-motion, probe 3 nguồn data thật (phát hiện SDK alpha không có
  `chance`, marketplace list thiếu ảnh, Index href số ít vs endpoint số nhiều —
  đã sửa `docs/api-reference.md`), viết data layer (proxy + Zod + Result), stat
  engine, gacha engine lai, battle engine (tự-test cân bằng bằng self-play +
  sweep tham số type-advantage), toàn bộ UI hero loop (premium-vault dark theme
  theo art-direction.md), Card Passport drawer + AI narration (fallback khi
  chưa có key), README nộp bài. Verify bằng headless e2e (Playwright) chạy hết
  vòng lặp 0 lỗi console, và quét bundle production xác nhận không lộ key/SDK
  giao dịch/localStorage.
