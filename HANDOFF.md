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

## Cập nhật lần cuối
- Thời điểm: 2026-07-07 15:37 UTC
- Agent: codex
- Commit gần nhất trước phiên: `da53e48` — "docs: fill HANDOFF.md with real progress, flag Vietnamese-UI violation"
- Commit phiên này: chuẩn bị commit "done: english ui and anonymous local save"

## Đang làm gì (current focus)
Không có file nào đang viết dở. Phiên Codex vừa sửa các việc cấp thiết: UI/copy
sản phẩm đã chuyển sang tiếng Anh, Card Passport prompt/fallback đã tiếng Anh,
anonymous localStorage save đã có versioning + savedAt + reset, và daily credit
refill đã tách thành hàm thuần. Hero loop e2e headless pass, 0 console error.

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
- Stretch/Core còn lại: [ ] Google login + server-side account save  [ ] by-image scan.

## Tiếp theo (next steps — cụ thể, làm được ngay)
1. **Làm Google login + save server-side theo tài khoản** — chưa có auth/provider.
   Cần chọn hạ tầng (vd NextAuth/Auth.js + adapter/KV/DB), chỉ xin scope định danh
   tối thiểu, và thực thi cùng `applyDailyCreditRefill()` ở server. UI copy đã có
   anonymous local save; cần thêm copy bắt buộc: "Sign in with Google to play
   across devices with your full demo pull history."
2. Bật AI narration thật: thêm `ANTHROPIC_API_KEY=sk-ant-...` vào `.env.local`,
   test lại `/api/passport/narrate` để `mode` trả về `"ai"` thay vì `"fallback"`.
3. (Tuỳ) Quay video demo theo 6 gạch đầu dòng trong `README.md` mục cuối.

## Quyết định đã chốt (để agent sau không hỏi lại)
- App tiếng ANH toàn bộ (UI/copy/README/video). Trao đổi với chủ dự án có thể VN.
- Loop (bản chuẩn): Open packs using reference odds → collect fictional cards
  based on real graded-card data → build a deck → battle in a skill-based
  Top-Trumps game. Win VIRTUAL credits to open more. Every card links to its
  real Card Passport. (Thẻ game là "dựa trên dữ liệu thẻ thật", KHÔNG phải NFT
  người chơi sở hữu.)
- Hai chế độ lưu, LÀM CẢ HAI: (a) ẩn danh → localStorage; (b) Google login →
  chơi đa thiết bị, giữ lịch sử mở thẻ demo. Chỉ xin scope định danh tối thiểu.
- Credit: hồi mỗi ngày lúc 00:00 UTC, CHỈ với id có credit < 100, NẠP CHO ĐỦ VỀ
  200 (không cộng dồn). Là hàm thuần dùng chung; chế độ login thực thi ở server
  (đáng tin), chế độ ẩn danh tính ở client (kiểu "danh dự", không chống gian lận
  — chấp nhận được vì credit ẢO).
- Thẻ: layout lại để HẾT chồng chữ — thứ tự dọc [thanh tier]→[nhãn: tên+grade]→
  [ảnh]→[ATK·DEF·AURA 3 cột đều]→[POWER dải riêng]→[nút Passport tách khỏi hàng
  chỉ số]. Tên thẻ tối đa 2 dòng + ellipsis.
- CTA "bấm được": cả thẻ cursor:pointer + hover nhấc/sáng viền; overlay
  "View Passport →" khi hover; icon ⓘ luôn hiện (cho mobile); hint 1 lần sau gói
  đầu "Tap any card to view its real Card Passport". Màn kết quả có nút thoát rõ
  ("Add to collection →"/"Continue") tách khỏi CTA Passport.

## Cảnh báo / nợ kỹ thuật (đọc kỹ trước khi code tiếp)
- **Chưa có Google login / auth** — không có route, provider, hay server/KV save.
  Đây là phần còn lại của ràng buộc "hai chế độ lưu". Anonymous localStorage đã
  làm; đa thiết bị theo tài khoản chưa làm.
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
- Verify mới nhất phiên Codex: `npm.cmd run test:unit` PASS; `npm.cmd run
  typecheck` PASS; `npm.cmd run build` PASS; `npm.cmd run e2e` PASS toàn hero
  loop, 0 console error; bundle scan `.next/static` không có `rk_`/`rsk_`/
  `X-Api-Secret`/`ANTHROPIC_API_KEY`/`createSecureClient`/`pullGacha`/
  `buybackGacha`/`approvePermit2Usdt`/`deploySafeWallet`. `localStorage` hiện là
  mong muốn và chỉ dùng cho tiến trình game.

## Nhật ký ngắn (mới nhất lên đầu)
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
