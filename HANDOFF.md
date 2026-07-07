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
- Thời điểm: 2026-07-07 11:16 UTC
- Agent: claude-code
- Commit gần nhất: `6e56231` — "feat: hero loop end-to-end (pack open -> deck -> battle -> passport)"
  (đây là **commit đầu tiên của repo** — trước phiên này thư mục KHÔNG có git;
  đã `git init` + commit toàn bộ code hiện có để agent sau có mốc tham chiếu)

## Đang làm gì (current focus)
Không có file nào đang viết dở. Phiên vừa xong đã build trọn hero loop (B1→B6),
build production pass, e2e headless chạy hết vòng lặp không lỗi console. Việc
CẤP THIẾT nhất để lại cho phiên sau là dịch toàn bộ copy UI sang tiếng Anh (xem
"Cảnh báo" — đây là vi phạm một ràng buộc bất biến, không phải polish tuỳ chọn).

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
- Stretch: [ ] localStorage save  [ ] Google login  [ ] by-image scan — CHƯA làm
  (đúng chủ ý chống scope-creep — nhưng xem cảnh báo về localStorage/Google login,
  đây KHÔNG phải stretch thuần tuý mà là một ràng buộc trong CLAUDE.md, xem dưới).

## Tiếp theo (next steps — cụ thể, làm được ngay)
1. **[ƯU TIÊN CAO] Dịch toàn bộ UI copy sang tiếng Anh** — hiện TOÀN BỘ đang tiếng
   Việt (vi phạm CLAUDE.md "App TIẾNG ANH toàn bộ"). Cần sửa hết các file trong
   `components/*.tsx` và `features/**/*.tsx` (Hud, TierLegend, Slab, Intro, PackOpen,
   Roster, DeckBuilder, Battle, Result, PassportDrawer) + comment trong
   `lib/game/stats.ts` (`STAT_FORMULA_NOTES`, hiển thị trực tiếp trong Passport).
   README.md đã tiếng Anh — không cần sửa. Docs nội bộ (`docs/`, `prompts/`,
   `CLAUDE.md`, `HANDOFF.md`) giữ nguyên tiếng Việt (đúng quy ước).
2. Cân nhắc triển khai lưu tiến trình theo đúng CLAUDE.md: "Hai chế độ lưu (làm cả
   hai): ẩn danh → localStorage máy user; Google login → chơi đa thiết bị". HIỆN
   TẠI game state chỉ nằm trong React (`useReducer` ở `app/arena/state.tsx`) —
   refresh trang là mất hết tiến trình. Đây LÀ một ràng buộc trong CLAUDE.md
   ("Hai chế độ lưu (làm cả hai)"), không phải optional — cần làm trước khi nộp
   nếu thời gian cho phép. Bắt đầu bằng bản ẩn danh (localStorage + versioning),
   Google login có thể để stretch nếu hết giờ.
3. Bật AI narration thật: thêm `ANTHROPIC_API_KEY=sk-ant-...` vào `.env.local`,
   test lại `/api/passport/narrate` để `mode` trả về `"ai"` thay vì `"fallback"`.
4. (Tuỳ) Quay video demo theo 6 gạch đầu dòng trong `README.md` mục cuối, SAU KHI
   đã dịch UI sang tiếng Anh (đừng quay video với UI tiếng Việt).

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
- **[VI PHẠM RÀNG BUỘC — sửa trước khi nộp] UI đang 100% tiếng Việt.** CLAUDE.md
  và AGENTS.md đều ghi rõ "App TIẾNG ANH toàn bộ (UI, copy, README, video demo)".
  Toàn bộ copy trong `components/` và `features/` (nhãn nút, tiêu đề, caveat,
  nhật ký trận, Passport...) hiện là tiếng Việt vì phiên build ban đầu (một task
  prompt tiếng Việt) đã code trực tiếp bằng tiếng Việt mà không đối chiếu lại quy
  tắc ngôn ngữ sản phẩm. README.md thì ĐÃ tiếng Anh (không cần sửa). Đây là việc
  ưu tiên #1 của phiên sau.
- **Không có persistence.** Game state chỉ sống trong `useReducer` (React), mất
  hết khi refresh/đóng tab. CLAUDE.md yêu cầu "Hai chế độ lưu (làm cả hai): ẩn
  danh → localStorage; Google login → đa thiết bị" — CHƯA làm cái nào. Không phải
  bug (không có code lỗi), mà là tính năng bắt buộc chưa bắt đầu.
- **Chưa có Google login / auth** — không có route, không có provider nào được
  cấu hình. Cần quyết định thư viện (NextAuth?) nếu làm tiếp mục lưu đa thiết bị.
- **Chưa cấu hình `ANTHROPIC_API_KEY`** trong `.env.local` → Card Passport AI
  narration đang chạy ở chế độ fallback (tóm tắt deterministic từ dữ liệu, KHÔNG
  gọi LLM thật). Route `/api/passport/narrate` đã sẵn code gọi Anthropic Messages
  API khi có key — chỉ cần điền key là chuyển sang `mode: "ai"`.
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
- Build production + `tsc --noEmit` đều PASS tại thời điểm commit `6e56231`. Đã
  quét bundle client (`.next/static`) xác nhận KHÔNG có `rk_`/`rsk_`/`X-Api-Secret`/
  `ANTHROPIC_API_KEY`/`createSecureClient`/`pullGacha`/`buybackGacha`/
  `approvePermit2Usdt`/`deploySafeWallet`/`localStorage`/`sessionStorage`.
- **Đối chiếu mục "Quyết định đã chốt" (dưới) với code hiện tại — CHƯA khớp hết:**
  mục "Credit: hồi mỗi ngày lúc 00:00 UTC..." và "CTA 'bấm được': overlay 'View
  Passport →' khi hover, icon ⓘ luôn hiện, hint 1 lần sau gói đầu" đều CHƯA được
  code (không tìm thấy logic hồi credit theo ngày, không có overlay/icon/hint nào
  trong `components/Slab.tsx`). Mục layout thẻ ("thứ tự dọc tier→nhãn→ảnh→3 chỉ
  số→power tách riêng") thì Slab.tsx HIỆN TẠI đã đúng cấu trúc này, chỉ khác ở
  chỗ tên thẻ đang cắt theo ký tự (44 ký tự + "…") chứ không phải line-clamp 2
  dòng CSS — có thể chấp nhận được, nhưng chưa đúng 100% tinh thần bản gốc.

## Nhật ký ngắn (mới nhất lên đầu)
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
