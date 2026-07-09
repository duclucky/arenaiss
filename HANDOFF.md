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

## Cập nhật phiên Antigravity 2026-07-09 force pack opening fx
- Agent: antigravity
- Commit phiên này: `fix: ensure pack opening fx runs everywhere`

### Đang làm gì
Không còn code đang viết dở. Phiên này xử lý yêu cầu bắt buộc hiệu ứng mở Pack phải chạy trên mọi hệ điều hành (kể cả khi tắt Animation effects) và hiển thị đúng màu ánh sáng trên mọi trình duyệt cũ (không dùng rgba from).

### Đã xong
- `features/pack-open/PackOpen.tsx`: Ép `reducedMotion = false` để bỏ qua cài đặt Accessibility của OS, đảm bảo sequence FX luôn chạy. Thêm helper `hexToRgbStr` và css var `--pack-tier-rgb`.
- `app/globals.css`: Đổi các biến CSS gốc thành dạng RGB (`--tier-top-rgb`, v.v.). Loại bỏ cú pháp `rgba(from var...)` bằng `rgba(var(--tier-rgb), alpha)` để hỗ trợ 100% trình duyệt. Xóa `@media (prefers-reduced-motion: reduce)` block.
- Verification: Đã chạy `npm run typecheck` PASS.

### Tiếp theo
1. Push code lên repo.

### Cảnh báo
- Việc ép hiệu ứng chạy đi ngược lại nguyên tắc Accessibility nhưng là yêu cầu bắt buộc của dự án (wow factor).

### Nhật ký
- 2026-07-09 antigravity: Hoàn tất force FX, chuẩn bị commit và push.

---

## Cập nhật phiên Codex 2026-07-09 pack cinematic CSS FX layer animation
- Agent: codex
- Commit gần nhất trước cập nhật này: `c2ad880` - "fx: show actual card during pack burst"
- Session commit: `e99ba84` - "fx(pack-cinematic): animate burst FX layers + add 5 keyframes (no JSX changes)"

### Đang làm gì
Không còn code pack FX đang viết dở. Phiên này xử lý yêu cầu đại tu visual các lớp FX pack-opening hiện có, tập trung vào CSS/motion presentation và không đổi gacha logic/RNG/credit/account/API.

### Đã xong
- `app/globals.css`: animate toàn bộ các lớp cinematic FX đã có thay vì để chúng chỉ là layer tĩnh.
- `.cinematic-burst-core`: thêm explosion core motion và blend sáng hơn.
- `.cinematic-shockwave`: thêm shockwave ring + dashed inner ring xoay.
- `.cinematic-flash-card`: thêm flash-card sweep/pop/blur animation.
- `.cinematic-foil-chip`: thêm chip burst stagger theo `--chip`.
- `.cinematic-showcase-field`: thêm aura nền khi reveal kết quả.
- `.cinematic-showcase-ring`: thêm rotating chromatic conic ring.
- `.cinematic-light-lance`: thêm glow halo overlay.
- Thêm keyframes mới: `packShockwave`, `packShockwaveSpin`, `packFlash`, `packChip`, `packShowcaseAura`.

### Verification
- `git log --oneline -3` xác nhận commit mới `e99ba84` trên `master`.
- `git diff HEAD~1 HEAD --stat`: `app/globals.css` changed only.
- Typecheck command đầu tiên lỗi do dùng `&&` trong PowerShell; lệnh sau không báo lỗi TypeScript trong output, nhưng chưa chạy full lint/build/e2e lại trong phiên này.

### Tiếp theo
1. Nếu cần deploy live, push `master` để GitHub Actions chạy deploy.
2. Nếu muốn chắc tuyệt đối trước deploy, chạy lại `npm.cmd run lint`, `npm.cmd run typecheck`, `npm.cmd run build`, và e2e.
3. Nếu user vẫn thấy FX chưa đủ mạnh, chỉ chỉnh `app/globals.css` / `features/pack-open/PackOpen.tsx`; không đổi game economy/RNG/API.

### Cảnh báo
- Thay đổi là CSS-only trong commit `e99ba84`, không có JSX change.
- Diff CSS lớn vì block cinematic trong `app/globals.css` được rewrite/tăng cường mạnh; nên review bằng `git show --stat e99ba84` và visual browser nếu cần.

### Nhật ký
- 2026-07-09 codex: Hoàn tất batch animate cinematic pack FX layers, commit `e99ba84`; cập nhật handoff ở commit kế tiếp.

---

## Cập nhật phiên Codex 2026-07-09 deploy prep Namecheap Stellar
- Agent: codex
- Commit gần nhất trước cập nhật này: `ca3d6a4` — "fix: rename product brand to Arenaiss"
- Commit phiên này: chuẩn bị commit `chore: prepare namecheap node deployment`

### Đang làm gì
Đang chuẩn bị deploy `Arenaiss` lên hosting Namecheap Stellar và domain `arenaiss.xyz`. User chọn repo GitHub private.

### Đã xong
- Kiểm tra repo: chưa có `origin`; GitHub CLI đã login account `duclucky`.
- `server.js`: thêm startup file production cho cPanel/Passenger Node.js app, chạy Next bằng `node server.js`.
- `docs/deploy-namecheap-stellar.md`: thêm hướng dẫn deploy trên Namecheap Stellar/cPanel, biến môi trường server-side, DNS `arenaiss.xyz`, SSL/AutoSSL, và cảnh báo persistence `data/*.json`.
- Verification startup file: `npm.cmd run build` PASS; chạy `node server.js -p 3036` + production e2e PASS, console errors none.

### Tiếp theo
1. Commit batch deploy prep.
2. Tạo GitHub repo private `duclucky/arenaiss`, set `origin`, push code.
3. Trong Namecheap cPanel: tạo Node.js app trỏ startup file `server.js`, clone/pull private repo hoặc upload zip, set env vars, chạy `npm ci`, `npm run build`, restart app.
4. Trỏ DNS `arenaiss.xyz` về hosting Namecheap và bật AutoSSL.

### Cảnh báo
- Stellar/cPanel cần Node.js 22+ (Node 24 đã verify local). Nếu Namecheap chỉ cho Node thấp hơn, cần đổi host hoặc runtime.
- Server-side account save hiện dùng persistent disk `data/`; ổn hơn serverless, nhưng vẫn chưa phải DB production.

### Nhật ký
- 2026-07-09 codex: Chuẩn bị deploy package cho Namecheap Stellar/cPanel Node.js.
- 2026-07-09 codex: Tạo GitHub private repo `duclucky/arenaiss` tại `https://github.com/duclucky/arenaiss` và push nhánh `master` lên `origin/master`.
- 2026-07-09 codex: Thêm GitHub Actions workflow deploy qua FTP Namecheap dùng secret `FTP_ARENAISS` làm password cho `Arenaiss@arenaiss.xyz`, bật Next standalone output, verify standalone payload bằng e2e local.

---

## Cập nhật phiên Codex 2026-07-09 Arenaiss brand
- Agent: codex
- Commit gần nhất trước cập nhật này: `fa12a7f` — "fix: clarify gacha demo notice"
- Commit phiên này: chuẩn bị commit `fix: rename product brand to Arenaiss`

### Đang làm gì
Không còn code đang viết dở. User chốt brand mới là `Arenaiss`; phiên này đổi brand hiển thị trong app, nhưng giữ `Renaiss API`, `Renaiss marketplace`, `Renaiss OS Index` khi nói về nguồn dữ liệu thật.

### Đã xong
- `components/Hud.tsx`: header brand đổi từ `RENAISS ARENA` thành `Arenaiss`.
- `features/intro/Intro.tsx`: hero headline đổi thành `Arenaiss Simulation`.
- `app/layout.tsx`: metadata title/description đổi sang brand `Arenaiss`.
- `scripts/e2e.mjs`: regression kiểm tra header `Arenaiss`, không còn `RENAISS ARENA`, và hero headline `Arenaiss Simulation`.

### Verification mới nhất
- E2E RED trước khi sửa: fail vì header chưa có `Arenaiss`.
- `npm.cmd run lint` PASS.
- `npm.cmd run typecheck` PASS.
- `npm.cmd run build` PASS.
- Production e2e PASS qua server tạm `http://127.0.0.1:3035`; console errors: none.
- Bundle scan `.next/static` cho secret/write-SDK symbols không có match.

### Tiếp theo
1. Reload `localhost:3001` nếu HMR chưa tự cập nhật.
2. Nếu muốn đổi README/video script sang brand `Arenaiss`, xử lý trong một batch docs riêng.

### Cảnh báo
- Không đổi attribution nguồn dữ liệu từ Renaiss vì đó vẫn là tên API/marketplace/index thật.

### Nhật ký
- 2026-07-09 codex: Đổi product brand hiển thị sang Arenaiss theo browser comment.

---

## Cập nhật phiên Codex 2026-07-09 hero demo notice
- Agent: codex
- Commit gần nhất trước cập nhật này: `b8d66d4` — "feat: add battle initiative and polish gacha"
- Commit phiên này: chuẩn bị commit `fix: clarify gacha demo notice`

### Đang làm gì
Không còn code đang viết dở. Phiên này xử lý feedback hero Gacha: chữ `RA` không rõ nghĩa và phần giới thiệu cần nói chuyên nghiệp hơn rằng đây là demo/mô phỏng, không tạo giá trị hay quyền sở hữu thật cho card.

### Đã xong
- `features/intro/Intro.tsx`: đổi label lớn `RA` thành `DEMO`.
- `features/intro/Intro.tsx`: đổi headline thành `Renaiss Arena Simulation`.
- `features/intro/Intro.tsx`: viết lại hero copy bằng tiếng Anh, nêu rõ đây là game-only simulation; card mở trong app là fictional in-app game items, không có real-world value/ownership/claim; demo dùng official Renaiss API data để mô phỏng metadata thẻ thật sát nhất có thể.
- `scripts/e2e.mjs`: cập nhật regression kiểm tra copy mới: `Renaiss Arena Simulation`, `game-only simulation`, `no real-world value`, `official Renaiss API data`.

### Verification mới nhất
- E2E RED trước khi sửa: fail vì chưa thấy `Renaiss Arena Simulation`.
- `npm.cmd run lint` PASS.
- `npm.cmd run typecheck` PASS.
- `npm.cmd run build` PASS.
- Production e2e PASS qua server tạm `http://127.0.0.1:3034`; console errors: none.
- Bundle scan `.next/static` cho secret/write-SDK symbols không có match.

### Tiếp theo
1. Reload `localhost:3001` nếu dev tab chưa tự cập nhật HMR.

### Cảnh báo
- Không đổi logic gacha/battle; chỉ đổi copy và e2e assertion.

### Nhật ký
- 2026-07-09 codex: Làm rõ hero notice theo feedback trực tiếp trên browser.

---

## Cập nhật phiên Codex 2026-07-08 battle initiative + gacha polish
- Agent: codex
- Commit gần nhất trước cập nhật này: `2222ba0` — "fix: explain effective battle scores"
- Commit phiên này: chuẩn bị commit `feat: add battle initiative and polish gacha`

### Đang làm gì
Không còn code đang viết dở. Phiên này xử lý feedback mới nhất: battle choices cần có ý nghĩa khi nhiều action đều thắng, PWR gây nhầm trong battle, gacha pack price/copy cần chỉnh, và header không nên có Reset.

### Đã xong
- `lib/game/battle.ts`: thêm initiative/momentum deterministic. Nếu action thắng với margin tốt nhất trong các action thắng, attacker giữ lượt kế tiếp; nếu chọn action thắng nhưng margin kém hơn, initiative chuyển bên kia. Kết quả KO vẫn dựa trên engine hiện có, không dùng RNG mới.
- `features/battle/Battle.tsx`: action buttons chỉ hiển thị effective score đã qua type multiplier, tô xanh/đỏ/trắng; outcome nói rõ `wins + keeps initiative`, `wins, passes turn`, hoặc `loses round`.
- `features/battle/Battle.tsx`: rules panel giải thích `Margin matters` và `PWR is lineup rating`; battle log có badge initiative mỗi round.
- `components/Slab.tsx`: ẩn `PWR` trong battle mode để tránh hiểu nhầm đây là chỉ số quyết định round.
- `app/globals.css`: tăng chiều cao action buttons, thêm style badge initiative.
- `lib/game/gacha.ts`, `tests/economy-pack.test.mts`: đổi giá pack theo yêu cầu mới: Eden 800, OMEGA 300, RenaCrypt 500; Welcome Pack vẫn free 5 cards một lần.
- `features/intro/Intro.tsx`: đổi hero copy thành mô tả rõ “simulated Renaiss pack vaults”, draft lineup, Pokemon/One Piece slabs, battle credits, Card Passport.
- `components/Hud.tsx`: bỏ nút `Reset` khỏi header; không còn UI xoá tiến trình tài khoản/anonymous một chạm.
- `scripts/e2e.mjs`: cập nhật regression cho hero copy mới, không có Reset, giá pack mới, credit expected mới, và rule text mới.

### Verification mới nhất
- `npm.cmd run test:unit` PASS.
- `npm.cmd run lint` PASS.
- `npm.cmd run typecheck` PASS.
- `npm.cmd run build` PASS.
- Production e2e PASS qua server tạm `http://127.0.0.1:3033`; console errors: none.
- Bundle scan `.next/static` cho secret/write-SDK symbols không có match.

### Tiếp theo
1. Reload `localhost:3001` nếu tab browser chưa tự HMR.
2. Nếu user muốn battle sâu hơn nữa, bước tiếp theo hợp lý là hiển thị preview “initiative kept/pass” bằng icon hoặc tooltip, không đổi engine thêm khi chưa cần.

### Cảnh báo
- Initiative là thay đổi gameplay có chủ đích theo feedback “chọn gì cũng thắng thì cần lý do để suy nghĩ”; đã có unit test `tests/battle-initiative.test.mts`.
- Giá/odds vẫn là mô phỏng dựa trên pool marketplace vì upstream chưa expose public pack odds qua alpha read API.

### Nhật ký
- 2026-07-08 codex: TDD đỏ-xanh cho giá pack mới; cập nhật battle initiative để action choice có hệ quả lượt kế; bỏ Reset header và cập nhật e2e.

---

## Cập nhật phiên Codex 2026-07-08 effective score explanation
- Agent: codex
- Commit gần nhất trước cập nhật này: `3354aae` — "fix: show base stats in battle actions"
- Commit phiên này: chuẩn bị commit `fix: explain effective battle scores`

### Đang làm gì
Không còn code đang viết dở. Phiên này xử lý feedback: user thích concept effective score nhưng cần giải thích rõ trong UI và tô màu điểm effective theo buff/nerf/neutral.

### Đã xong
- `features/battle/Battle.tsx`: thêm dòng giải thích ngay dưới `YOUR TURN`: `Effective score = visible stat x type multiplier`; xanh = boosted, đỏ = reduced, trắng = unchanged.
- `features/battle/Battle.tsx`: action buttons chỉ hiển thị điểm effective của hai bên, tô màu theo so sánh với chỉ số gốc; bỏ chỉ số gốc trong nút để đỡ rối.
- `features/battle/Battle.tsx`: Battle Log cũng tô màu effective score bằng cùng quy tắc.
- `features/battle/Battle.tsx`: rules panel giải thích effective score thay vì chỉ nói chung về type advantage.
- `app/globals.css`: thêm style cho `.battle-effective-help` và `.battle-effective-score`.

### Verification mới nhất
- `npm.cmd run lint` PASS.
- `npm.cmd run typecheck` PASS.

### Tiếp theo
1. Reload `localhost:3001` nếu HMR chưa tự cập nhật.

### Cảnh báo
- Chưa chạy lại e2e vì thay đổi chỉ ở presentation/label battle; lint/typecheck đã pass.

### Nhật ký
- 2026-07-08 codex: Làm rõ effective score trong action buttons và battle log.

---

## Cập nhật phiên Codex 2026-07-08 battle action stat display
- Agent: codex
- Commit gần nhất trước cập nhật này: `94da646` — "fix: polish roster filters"
- Commit phiên này: chuẩn bị commit `fix: show base stats in battle actions`

### Đang làm gì
Không còn code đang viết dở. Phiên này xử lý feedback battle: các nút ATK/DEF/AURA hiển thị số khác chỉ số trên thẻ vì đang show effective score sau type multiplier, gây hiểu nhầm là sai chỉ số.

### Đã xong
- `features/battle/Battle.tsx`: các nút hành động giờ hiển thị chỉ số gốc đang thấy trên thẻ (`card[stat]`) thay vì effective score.
- `features/battle/Battle.tsx`: logic thắng/thua vẫn dùng `previewRound`/battle engine effective score như trước, không đổi kết quả trận.
- `features/battle/Battle.tsx`: đổi copy lượt chơi thành `YOUR TURN - choose an action. Type advantage can swing the round.`
- `features/battle/Battle.tsx`: rules panel đổi từ `Choose a stat` sang `Choose an action` để thống nhất copy.

### Verification mới nhất
- `npm.cmd run lint` PASS.
- `npm.cmd run typecheck` PASS.

### Tiếp theo
1. Reload `localhost:3001` để thấy battle action buttons hiển thị đúng base stat.

### Cảnh báo
- Chưa chạy lại e2e vì thay đổi chỉ ở presentation battle action labels; lint/typecheck đã pass.

### Nhật ký
- 2026-07-08 codex: Sửa battle action UI để không hiển thị effective score như chỉ số gốc.

---

## Cập nhật phiên Codex 2026-07-08 roster filter polish
- Agent: codex
- Commit gần nhất trước cập nhật này: `956a29b` — "feat: split gacha packs and arena lines"
- Commit phiên này: chuẩn bị commit `fix: polish roster filters`

### Đang làm gì
Không còn code đang viết dở. Phiên này xử lý feedback Roster: tier legend bị lặp và chữ `PACK` trong empty state không có ý nghĩa.

### Đã xong
- `features/roster/Roster.tsx`: bỏ dòng `TierLegend` dưới filter vì các tier đã nằm trong filter.
- `features/roster/Roster.tsx`: tô màu các nút tier filter bằng đúng palette tier (`TOP/S/A/B/C/D`) giống legend.
- `features/roster/Roster.tsx`: bỏ chữ `PACK` khỏi empty state; chỉ giữ thông báo có nghĩa và nút `Back to Gacha`.

### Verification mới nhất
- `npm.cmd run lint` PASS.
- `npm.cmd run typecheck` PASS.

### Tiếp theo
1. Reload `localhost:3001` để xem Roster filter polish.

### Cảnh báo
- Chưa chạy lại e2e vì thay đổi chỉ ở Roster presentation và lint/typecheck đã pass.

### Nhật ký
- 2026-07-08 codex: Polish Roster filter/empty state theo comment trực tiếp trên browser.

---

## Cập nhật phiên Codex 2026-07-08 gacha arena split
- Agent: codex
- Commit gần nhất trước cập nhật này: `fb6d652` — "docs: handoff gacha arena scope"
- Commit phiên này: chuẩn bị commit `feat: split gacha packs and arena lines`

### Đang làm gì
Không còn code đang viết dở. Phiên này tiếp tục yêu cầu gacha/arena từ handoff: pack chọn odds trước khi mở, Roster có filter, Lineup chọn arena Pokemon/One Piece và chỉ hiển thị đúng card line.

### Đã xong
- `lib/game/gacha.ts`: thêm metadata category/source cho pack; `Eden Pack` rút One Piece, `OMEGA Pack` rút Pokemon, `RenaCrypt Pack` và `Welcome Pack` rút mixed Pokemon + One Piece; `openPack` lọc eligible pool trước khi rút.
- `lib/client/api.ts`: chuẩn hóa `GameCard.category` theo category request từ `/api/pool` để marketplace item thiếu `type` vẫn lọc đúng Pokemon/One Piece.
- `app/arena/ArenaApp.tsx`, `app/arena/state.tsx`: load cả hai pool Pokemon/One Piece cùng lúc; thêm `poolsByCategory`, `selectedPackId`, `arenaCategory`; mở Welcome xong tự chuyển selected pack về Eden để không mở Welcome lần hai.
- `features/intro/Intro.tsx`, `components/PackChoices.tsx`: bỏ selector `Pokemon`/`One Piece` ở Gacha; pack xếp dọc, mỗi pack có màu riêng; click pack chỉ chọn pack và cập nhật odds; odds panel có nút `Rip a Pack`.
- `features/roster/Roster.tsx`: thêm filter `All`, `Pokemon`, `One Piece`, và từng tier; mặc định `All`; bỏ pack list khỏi Roster để màn này chỉ quản lý thẻ.
- `features/deck-builder/DeckBuilder.tsx`: Lineup có bước chọn `Pokemon Arena` hoặc `One Piece Arena`; sau khi chọn chỉ thấy thẻ đúng category, opponent deck cũng lấy từ đúng pool.
- `lib/game/save.ts`: lưu/parse thêm `selectedPackId` và `arenaCategory` với default tương thích save cũ.
- `tests/economy-pack.test.mts`, `tests/credit-save.test.mts`: thêm unit test cho pack category rules và save fields.
- `scripts/e2e.mjs`: cập nhật flow mới chọn pack → `Rip a Pack`, Roster filters, chọn Pokemon Arena trước khi battle.

### Verification mới nhất
- `npm.cmd run lint` PASS.
- `npm.cmd run typecheck` PASS.
- `npm.cmd run test:unit` PASS.
- `npm.cmd run build` PASS.
- Production e2e PASS qua server tạm `http://127.0.0.1:3030`; console errors: none.
- Bundle scan `.next/static` cho secret/write-SDK symbols không có match.

### Tiếp theo
1. Reload `localhost:3001` để xem UI mới.
2. Nếu muốn sát dữ liệu pack thật hơn nữa, cần lấy được detail `/v0/packs/{slug}` hoặc SDK odds public khi upstream mở; hiện implementation dùng metadata `/api/packs` + reconciliation trong `docs/api-reference.md`, không bịa odds thật.

### Cảnh báo
- `Eden/OMEGA/RenaCrypt` mapping dựa trên metadata pack hiện có trong `/api/packs` và handoff trước; upstream không trả full pack contents/odds trong môi trường này.
- Vẫn tuyệt đối read-only; không dùng write SDK/on-chain.

### Nhật ký
- 2026-07-08 codex: Hoàn tất tách gacha pack selection, roster filters, arena-specific lineup/battle.

---

## Cập nhật phiên Codex 2026-07-08 gacha/arena scope pause
- Agent: codex
- Commit gần nhất trước cập nhật này: `a5d07cb` — "fix: split battle log and rules panels"
- Commit phiên này: chưa có commit mới; user yêu cầu tạm lưu handoff trước khi triển khai.

### Đang làm gì
Tạm dừng trước khi sửa code. Yêu cầu mới của user cần làm tiếp:
- Gacha: bỏ nút chọn `Pokemon` / `One Piece` ở panel `CARD LINE`; pack xếp dọc, mỗi pack có nền/màu riêng.
- Click pack chỉ chọn pack và cập nhật bảng odds; bảng odds thêm nút `Rip a Pack` để mở pack đang chọn.
- Mở pack theo logic Renaiss tạm thời dựa trên dữ liệu có thật: `/v0/packs` chỉ có metadata pack; docs ghi SDK/public odds chưa mở và `/v0/packs/{slug}` không trả full odds. Không được bịa odds thật; nếu map pack-game thì phải ghi minh bạch.
- Lineup: khi click `Lineup`, user chọn arena `Pokemon` hoặc `One Piece`; arena Pokemon chỉ dùng thẻ Pokemon, arena One Piece chỉ dùng thẻ One Piece.
- Roster: thêm filter `All`, `Pokemon`, `One Piece`, và từng tier; mặc định `All`.

### Đã xong trong phiên tạm này
- Đọc lại `CLAUDE.md`, `docs/art-direction.md`, `docs/api-reference.md`, `HANDOFF.md`.
- Đối chiếu `git log --oneline -10` và `git status --short`; working tree sạch trước khi dừng.
- Audit file liên quan: `lib/game/gacha.ts`, `app/arena/state.tsx`, `features/intro/Intro.tsx`, `components/PackChoices.tsx`, `features/roster/Roster.tsx`, `features/deck-builder/DeckBuilder.tsx`, `lib/game/opponent.ts`, `lib/game/save.ts`, `lib/client/api.ts`.
- Kiểm tra `/api/packs` local: có `eden-pack`, `omega`, `renacrypt-pack`; `OMEGA` mô tả rõ Pokemon; `Eden Pack` mô tả treasure/paradise at sea; `RenaCrypt` là collab/perpetual vault pool. API list không có field category/odds.
- Thử probe trực tiếp `/v0/packs/{slug}` bằng PowerShell/curl nhưng môi trường TLS/curl lỗi, chưa lấy được detail. Không có code thay đổi.

### Tiếp theo
1. Viết test trước cho `openPack`/pack definitions: pack có `categories`/`poolFilter`, paid pack mở 1 card, welcome mở 5 cards; pack One Piece không rút Pokemon; Pokemon pack không rút One Piece; mixed pack rút từ cả hai nếu pool có.
2. Cân nhắc kiến trúc pool: hiện app chỉ load một `state.pool` theo `state.category`. Nên chuyển sang pool tổng hợp hoặc cache theo category (`poolsByCategory`) để gacha/roster/lineup có thể lọc cả Pokemon và One Piece mà không mất dữ liệu.
3. Cập nhật save/state tối thiểu: thêm `selectedPackId` và `arenaCategory` nếu cần; giữ backward compatibility với save v1 hoặc bump version có migration.
4. Sửa `Intro`/`PackChoices`: bỏ selector card line; pack list vertical; selected pack drives `oddsTable`; odds panel có `Rip a Pack`.
5. Sửa `DeckBuilder`: trước khi chọn 5 thẻ, hiển thị arena chooser Pokemon/One Piece; lọc available/deck/opponent pool theo arena category; khi đổi arena, loại deck tokens sai category.
6. Sửa `Roster`: filter local state `all | pokemon | one-piece | tier`; default `All`.
7. Chạy `lint`, `typecheck`, `test:unit`, `build`, e2e, bundle secret scan; cập nhật handoff và commit.

### Cảnh báo
- Chưa sửa code cho yêu cầu mới.
- `docs/api-reference.md` có mâu thuẫn lịch sử: phần reconciliation nói SDK odds thật chưa có, phần cuối vẫn mô tả logic gacha lai cũ. Khi làm tiếp, tin phần reconciliation mới nhất.
- Không được dùng endpoint write/on-chain; chỉ GET/proxy server-side.

### Nhật ký
- 2026-07-08 codex: User yêu cầu tạm dừng; đã lưu scope và phát hiện hiện trạng code/data để phiên sau tiếp tục.

---

## Cập nhật phiên Codex 2026-07-08 battle log split panels
- Agent: codex
- Commit gần nhất trước cập nhật này: `654c2d7` — "fix: strengthen battle fx visuals"
- Commit phiên này: chuẩn bị commit `fix: split battle log and rules panels`

### Đang làm gì
Không còn code đang viết dở. Phiên này xử lý phản hồi user rằng phần log battle khó đọc và cần chia thành 2 panel: log riêng, giải thích luật chơi riêng.

### Đã xong
- `features/battle/Battle.tsx`: thay block log cũ bằng `BattleInfo`, gồm panel `BATTLE LOG / Round history` và panel `RULES / How battles work`.
- `features/battle/Battle.tsx`: log từng round được tách ý rõ hơn: ai chọn stat, ai thắng, điểm You/Opponent, card nào KO, ghi chú type matchup.
- `features/battle/Battle.tsx`: panel luật chơi giải thích stat, type advantage, tie, KO, stake/payout virtual credit bằng hằng số economy hiện tại.
- `app/globals.css`: thêm layout hai panel responsive, row log dễ quét, badge KO và màu thắng/thua.
- `scripts/e2e.mjs`: thêm regression kiểm tra battle screen có panel `How battles work` và dòng luật `Type advantage matters`.

### Verification mới nhất
- `npm.cmd run lint` PASS.
- `npm.cmd run typecheck` PASS.
- `npm.cmd run test:unit` PASS.
- `npm.cmd run build` PASS.
- Production e2e PASS qua server tạm `http://127.0.0.1:3026`; console errors: none.
- Bundle scan `.next/static` cho secret/write-SDK symbols không có match.

### Tiếp theo
1. Reload `localhost:3001` để xem battle log mới.
2. Nếu user muốn đọc luật nhanh hơn nữa, có thể rút gọn panel rules thành icon/badge nhưng hiện tại đã tách khỏi log đúng yêu cầu.

### Cảnh báo
- Không có cảnh báo build/test mới.

### Nhật ký
- 2026-07-08 codex: Tách battle log thành log panel và rules panel, không chạm battle engine.

---

## Cập nhật phiên Codex 2026-07-08 battle FX visual polish
- Agent: codex
- Commit gần nhất trước cập nhật này: `6106d10` — "feat: battle FX timeline (framer-motion)"
- Commit phiên này: chuẩn bị commit `fix: strengthen battle fx visuals`

### Đang làm gì
Không còn code đang viết dở. Phiên này xử lý phản hồi user: FX vẫn chưa đặc sắc và đường kẻ dọc giữa arena gây khó chịu.

### Đã xong
- `app/globals.css`: bỏ divider dọc giữa battle arena; thay bằng stage glow ngang và nền arena đổi theo stat đang clash.
- `app/globals.css`: tăng độ rõ của ATK beam/slash, DEF shield, AURA pulse, impact ring, sparks và stage overlay.
- `features/battle/BattleFx.tsx`: tăng lunge distance/scale/impact shake cho card motion; thêm spark streak elements và stage FX variants.
- `features/battle/Battle.tsx`: thêm `data-combat-stat` cho arena để CSS đổi motif theo stat mà không chạm battle engine.

### Verification mới nhất
- `npm.cmd run lint` PASS.
- `npm.cmd run typecheck` PASS.
- `npm.cmd run test:unit` PASS.
- `npm.cmd run build` PASS.
- Production e2e PASS qua server tạm `http://127.0.0.1:3025`; console errors: none.
- Bundle scan `.next/static` cho secret/write-SDK symbols không có match.
- Visual spot-check screenshot: `.e2e-output/06-battle-fx.png` xác nhận không còn đường kẻ dọc và ATK slash rõ hơn.

### Tiếp theo
1. Reload `localhost:3001` để xem FX mới.
2. Nếu user vẫn muốn “đặc sắc” hơn nữa, ưu tiên tăng art direction ở battle stage/FX assets riêng thay vì đổi engine.

### Cảnh báo
- Không có cảnh báo build/test mới.

### Nhật ký
- 2026-07-08 codex: Polish visual battle FX sau phản hồi trực tiếp; giữ battle logic deterministic.

---

## Cập nhật phiên Codex 2026-07-08 battle FX timeline
- Agent: codex
- Commit gần nhất trước cập nhật này: `a722544` — "feat: update gacha economy and battle ui"
- Commit phiên này: chuẩn bị commit `feat: battle FX timeline (framer-motion)`

### Đang làm gì
Không còn code đang viết dở trong batch FX. Phiên này xử lý phản hồi user rằng màn battle chưa thấy hiệu ứng thẻ khi chiến đấu.

### Đã xong
- `features/battle/useCombatTimeline.ts`: thêm state machine trình diễn round tách khỏi battle engine: `idle -> lockIn -> clash -> impact -> resolve -> settle -> idle`, timing cấu hình một chỗ, hỗ trợ skip/tua nhanh bằng click/tap, tôn trọng `prefers-reduced-motion`.
- `features/battle/BattleFx.tsx`: thêm lớp FX bằng Framer Motion/AnimatePresence: ATK slash beam, DEF shield motif, AURA radial pulse, impact flash, burst particles, floating damage number, label phase.
- `features/battle/Battle.tsx`: tích hợp FX chỉ đọc `RoundResult` đã có; không sửa battle engine/kết quả/RNG. Trong lúc FX chạy, card hiển thị dùng `round.playerCard/opponentCard`, AI/player input chờ tới khi FX settle để tránh overlap.
- `app/globals.css`: thêm styling premium-vault cho FX layer, stat glow, beam/shield/aura/burst/floating number và reduced-motion CSS.
- `scripts/e2e.mjs`: thêm regression kiểm tra battle FX xuất hiện sau khi chọn stat (`data-testid="battle-fx"`, non-idle phase, stat motif, beam/pulse) và lưu screenshot `.e2e-output/06-battle-fx.png`.
- `app/api/passport/narrate/route.ts`: thêm timeout server-side mặc định 12s cho AI provider để modal Passport không kẹt skeleton nếu provider chậm; fallback deterministic vẫn dùng dữ liệu validated như trước.

### Verification mới nhất
- `npm.cmd run lint` PASS.
- `npm.cmd run typecheck` PASS.
- `npm.cmd run test:unit` PASS.
- `npm.cmd run build` PASS.
- Production e2e PASS qua server tạm `http://127.0.0.1:3024`; console errors: none.
- Bundle scan `.next/static` cho secret/write-SDK symbols không có match.
- Visual spot-check screenshot: `.e2e-output/06-battle-fx.png`.

### Tiếp theo
1. Restart dev server `localhost:3001` để browser user thấy FX mới.
2. Nếu muốn nâng thêm sau này: thêm nhiều frame particle hơn cho DEF/AURA hoặc sound cue, nhưng hiện tại không cần đổi battle logic.

### Cảnh báo
- Không có cảnh báo build/test mới.

### Nhật ký
- 2026-07-08 codex: Hoàn tất battle FX timeline bằng Framer Motion theo yêu cầu hướng 3, giữ determinism và engine untouched.

---

## Cập nhật phiên Codex 2026-07-08 07:20 UTC
- Agent: codex
- Commit gần nhất trước cập nhật này: `10110a1` — "fix: collapse marketplace panel"
- Commit phiên này: chuẩn bị commit `feat: update gacha economy and battle ui`

### Đang làm gì
Không còn code đang viết dở trong batch này. Phiên heartbeat đã tiếp tục từ handoff 04:18 UTC, chạy verification, sửa lỗi save parser và cập nhật e2e theo flow economy/pack/battle mới.

### Đã xong
- `lib/game/gacha.ts`: chốt economy ảo mới: starting credits `10000`, battle stake `100`, winner payout `199`, loser payout `0`, helper refund draw; thêm catalog `Welcome Pack`, `Eden Pack`, `OMEGA Pack`, `RenaCrypt Pack`.
- `components/PackChoices.tsx`, `features/intro/Intro.tsx`, `features/roster/Roster.tsx`, `features/pack-open/PackOpen.tsx`: UI mở pack mới; Welcome Pack free mở 5 thẻ một lần, paid packs 300/500/800 credits mở 1 thẻ.
- `app/arena/state.tsx`, `lib/game/save.ts`, `components/AuthPanel.tsx`: lưu `welcomePackOpened`, lưu `packId` trong lịch sử pull, trừ credit khi mở paid pack, trừ stake khi start battle và cộng payout khi kết thúc.
- `components/Hud.tsx`, `features/deck-builder/DeckBuilder.tsx`, `features/result/Result.tsx`: đổi nav/copy sang `Gacha`, `Roster`, `Lineup`; start battle hiển thị stake; result hiển thị payout/balance mới.
- `features/battle/Battle.tsx`, `components/Slab.tsx`, `app/globals.css`: battle UI lớn hơn, ẩn slab label/cert trong battle mode, thêm role chip ATTACKING/DEFENDING, round title nổi bật, stat buttons tách dòng không chồng chữ.
- `tests/economy-pack.test.mts`, `tests/credit-save.test.mts`: thêm/điều chỉnh unit test cho economy, pack catalog, welcome pack và save.
- `scripts/e2e.mjs`: cập nhật flow production e2e theo nav mới, Welcome Pack 5 cards, paid pack 1 card/price 300, battle stake deduction, Passport regressions.

### Verification mới nhất
- `npm.cmd run test:unit` PASS.
- `npm.cmd run typecheck` PASS.
- `npm.cmd run lint` PASS.
- `npm.cmd run build` PASS.
- Production e2e PASS qua server tạm `http://127.0.0.1:3020`; console errors: none.
- Bundle scan `.next/static` với `rg` cho secret/write-SDK symbols (`PASSPORT_AI_API_KEY`, `ANTHROPIC_API_KEY`, `createSecureClient`, `pullGacha`, v.v.) không có match.
- Visual spot-check screenshots: `.e2e-output/03-eden-pack.png`, `.e2e-output/05-lineup.png`, `.e2e-output/06-battle.png`.

### Tiếp theo
1. Restart server dev/user-visible ở `localhost:3001` để browser thấy bản mới nhất.
2. Nếu muốn nâng thêm battle animation, làm một batch riêng tập trung vào motion/FX; bản hiện tại đã có layout lớn hơn, role chip và stat buttons không overlap.

### Cảnh báo
- Không có cảnh báo build/test mới.
- `HANDOFF.md` vẫn có các đoạn cũ hiển thị mojibake trong terminal PowerShell do codepage, không phải thay đổi logic app.

### Nhật ký
- 2026-07-08 codex: Heartbeat đã chạy đúng lịch, tiếp tục từ dirty tree, hoàn tất verification và chuẩn bị commit batch economy/pack/battle UI.

---

## Cập nhật phiên Codex 2026-07-08 04:18 UTC
- Agent: codex
- Commit gần nhất trước cập nhật này: `10110a1` — "fix: collapse marketplace panel"
- Commit phiên này: **chưa commit**; đang dở theo yêu cầu dừng vì sắp hết quota.

### Đang làm gì
Đang triển khai batch lớn theo browser comments + yêu cầu economy mới:
1. Nav labels: `Vault` -> `Gacha`, `Collection` -> `Roster`, `Deck` -> `Lineup`.
2. Economy: starting credits `10000`; battle stake `100` trừ khi start; thắng cộng `199`, thua cộng `0`; draw helper hoàn `100`.
3. Pack model: paid packs `Eden Pack` 300, `OMEGA Pack` 500, `RenaCrypt Pack` 800; mỗi paid pack mở 1 thẻ. `Welcome Pack` mở 5 thẻ, free, chỉ dùng một lần theo `welcomePackOpened`.
4. Battle UI: đang thay arena lớn hơn, thẻ battle ẩn label/cert để nhìn artwork rõ hơn, role chip ATTACKING/DEFENDING, stat buttons không chồng text, round title nổi bật.

### Đã xong nhưng chưa verify đầy đủ
- `lib/game/gacha.ts`: rewrite sạch ASCII, thêm `PACKS`, `PackId`, `WELCOME_PACK_ID`, `STARTING_CREDITS=10000`, `BATTLE_STAKE=100`, `WIN_REWARD=199`, `openPack(pool, seed, packId)`, `settleBattleCredits()`. Unit test `tests/economy-pack.test.mts` đã được thêm và **đã pass một lần** sau khi sửa gacha.
- `tests/economy-pack.test.mts`: test đỏ rồi xanh cho economy/pack catalog/welcome pack.
- `lib/game/save.ts`: thêm `welcomePackOpened` và `packId` trong pull history. Lưu ý: vừa sửa lỗi cú pháp thiếu `))` ở `parsePullHistory`; **chưa chạy lại test sau fix cú pháp này**.
- `app/arena/state.tsx`: nối `welcomePackOpened`, `OPEN_PACK` trừ `action.reveal.cost`, set welcome opened, `START_BATTLE` trừ stake, `END_BATTLE` cộng reward qua `settleBattleCredits`.
- `components/AuthPanel.tsx`: thêm `welcomePackOpened` vào server save sync.
- `components/PackChoices.tsx`: file mới, UI chọn Welcome/Paid packs, dispatch `OPEN_PACK` theo pack id.
- `features/intro/Intro.tsx`: rewrite sang màn `Gacha`, dùng `PackChoices`, copy English sạch hơn.
- `features/roster/Roster.tsx`: rewrite sang `Roster`, thêm pack choices, bỏ copy Collection.
- `features/pack-open/PackOpen.tsx`: rewrite để paid pack 1 card hiển thị gọn, Welcome Pack 5 cards; bỏ nút mở pack mặc định 100.
- `features/result/Result.tsx`: rewrite payout theo stake/win reward; bỏ nút open pack 100.
- `features/deck-builder/DeckBuilder.tsx`: rewrite thành `Build lineup`, start battle requires stake.
- `components/Hud.tsx`: đổi nav label thành `Gacha` / `Roster` / `Lineup`.
- `components/Slab.tsx`: rewrite sạch ASCII, thêm prop `battleMode`.
- `features/battle/Battle.tsx`: rewrite battle UI với arena mới, role chip, stat buttons mới.
- `app/globals.css`: thêm CSS battle arena, battle stat buttons, battle-mode slab.

### Cảnh báo
- Working tree hiện đang dirty và **chưa commit**. Không revert các file này.
- Verification mới nhất trước khi dừng: `npm.cmd run test:unit` fail do `lib/game/save.ts` thiếu `))`; lỗi đó vừa được sửa, nhưng **chưa chạy lại** `test:unit`, `typecheck`, `lint`, `build`, `e2e`.
- E2E chắc chắn cần cập nhật vì text cũ `Collection`, `Deck`, `Open pack · 100`, `Build deck` đã đổi.
- `components/PackChoices.tsx` đang tạo grid 4 cột hoặc 2 cột; cần kiểm tra mobile/desktop visual.
- User đang mở `localhost:3001`, có thể vẫn là process cũ; sau khi hoàn tất phải restart local server.

### Tiếp theo
1. Chạy `npm.cmd run test:unit`; nếu fail, sửa các type/call site liên quan `welcomePackOpened`/save.
2. Chạy `npm.cmd run typecheck` và `npm.cmd run lint`; sửa lỗi import/type sau các rewrite.
3. Cập nhật `scripts/e2e.mjs` cho flow mới:
   - `Gacha` nav thay `Vault`
   - `Roster` thay `Collection`
   - `Lineup` thay `Deck`
   - Welcome Pack mở 5 cards một lần
   - Paid pack mở 1 card với price 300/500/800
   - Start battle stake copy/credit behavior
4. Chạy `npm.cmd run build` + production e2e.
5. Kiểm tra visual battle: thẻ có đủ lớn không, label đã ẩn trong battle chưa, stat buttons không overlap.
6. Nếu verify pass, cập nhật handoff lần nữa và commit, gợi ý message: `feat: update gacha economy and battle ui`.

### Nhật ký
- 2026-07-08 codex: Tạm dừng giữa batch economy/pack/battle UI theo yêu cầu user. Đã ghi lại đầy đủ file và trạng thái; chưa commit vì chưa verify xanh.

---

## Cập nhật phiên Codex 2026-07-08 03:52 UTC
- Agent: codex
- Commit gần nhất trước cập nhật này: `b8ce9c2` — "fix: polish passport bullet copy"
- Commit phiên này: chuẩn bị commit "fix: collapse marketplace panel"

### Đang làm gì
Không có code đang viết dở. Phiên này xử lý browser comment trong Passport modal: bỏ link `View all Renaiss packs` và thay bằng nút thu gọn để user quay lại đọc Passport AI mà không cần cuộn xuống.

### Đã xong
- `features/passport/PassportDrawer.tsx`: bỏ link `View all Renaiss packs`; thay bằng button `Collapse marketplace`.
- `features/passport/PassportDrawer.tsx`: bỏ import `renaissGachaUrl` không còn dùng.
- `scripts/e2e.mjs`: thêm regression đảm bảo link `View all Renaiss packs` không render, nút collapse tồn tại, collapse ẩn panel marketplace và khôi phục CTA `Check on Renaiss Marketplace`.
- Verify mới nhất: `npm.cmd run lint` PASS; `npm.cmd run typecheck` PASS; `npm.cmd run build` PASS; production e2e qua server tạm `http://127.0.0.1:3018` PASS, console errors none; bundle scan `.next/static` không có secret/write-SDK symbols.

### Tiếp theo
1. Restart server đang chạy ở `localhost:3001` để browser thấy nút collapse mới.

### Cảnh báo
- Không có cảnh báo mới.

### Nhật ký
- 2026-07-08 codex: Marketplace panel trong Passport giờ có thể collapse, không còn link tổng `View all Renaiss packs`.

---

## Cập nhật phiên Codex 2026-07-08 03:34 UTC
- Agent: codex
- Commit gần nhất trước cập nhật này: `ee5b907` — "feat: restore cached passport ai"
- Commit phiên này: chuẩn bị commit "fix: polish passport bullet copy"

### Đang làm gì
Không có code đang viết dở. Phiên này xử lý browser comments về trình bày trong Passport modal: Reference metadata và Passport AI đang là đoạn văn dài khó đọc; CTA ownership cần đổi copy.

### Đã xong
- `features/passport/PassportDrawer.tsx`: Reference estimate metadata chuyển sang bullet list, mỗi ý một dòng: observations/source count, last sale, source/asOf, listing-price caveat, thin-data caveat.
- `features/passport/PassportDrawer.tsx`: Passport AI renderer chuyển từ paragraph sang bullet list; nếu provider trả một paragraph dài thì tách thành nhiều bullet để dễ scan.
- `features/passport/PassportDrawer.tsx`: CTA đổi từ `How to own it for real` sang `Check on Renaiss Marketplace`; section sau click đổi thành `Renaiss Marketplace`.
- `scripts/e2e.mjs`: thêm regression cho CTA mới và bullet rendering; e2e đợi AI list render xong để không fail khi provider/cache chậm.
- Verify mới nhất: `npm.cmd run lint` PASS; `npm.cmd run typecheck` PASS; `npm.cmd run build` PASS; production e2e qua server tạm `http://127.0.0.1:3016` PASS, console errors none.

### Tiếp theo
1. Restart server đang chạy ở `localhost:3001` để browser thấy bản UI mới.
2. Nếu muốn đổi naming trong README/video từ "Own it for real" sang "Check on Renaiss Marketplace", cập nhật docs/demo script riêng.

### Cảnh báo
- AI provider có thể mất vài giây; UI vẫn skeleton trong khi đợi. Cache server-side giảm quota sau lần generate đầu.

### Nhật ký
- 2026-07-08 codex: Polish Passport modal theo browser comments: bullet lists cho Reference/AI và CTA marketplace mới.

---

## Cập nhật phiên Codex 2026-07-08 03:05 UTC
- Agent: codex
- Commit gần nhất trước cập nhật này: `a028856` — "fix: de-duplicate passport content"
- Commit phiên này: chuẩn bị commit "feat: restore cached passport ai"

### Đang làm gì
Không có code đang viết dở. Phiên này khôi phục Passport AI sau khi nhận ra bước trước đã bỏ quá tay, đồng thời đổi provider sang OpenAI-compatible endpoint `https://v98store.com/v1` với model `deepseek-v4-flash` và thêm cache server-side để không tốn quota mỗi lần user mở Passport.

### Đã xong
- `features/passport/PassportDrawer.tsx`: khôi phục section `Passport AI` dạng insight ngắn, đặt sau CTA ownership để `How to own it for real` vẫn dễ thấy; UI không nhắc tên env/provider kỹ thuật.
- `app/api/passport/narrate/route.ts`: đổi từ Anthropic hard-code sang OpenAI-compatible `/chat/completions`; đọc `PASSPORT_AI_API_KEY`, `PASSPORT_AI_BASE_URL`, `PASSPORT_AI_MODEL`; mặc định base/model theo v98store/deepseek-v4-flash.
- `lib/passport/cache.ts`, `lib/passport/cache.server.ts`: thêm cache theo `tokenId` + fingerprint dữ liệu thật, TTL 7 ngày, lưu server-side ở `data/passport-ai-cache.json` (đã gitignore). Chỉ cache kết quả AI thật; fallback không cache để khi thêm key có thể generate AI ngay.
- `lib/passport/prompt.ts`, `prompts/passport-narration.md`: đổi prompt sang insight ngắn 2-4 câu, không lặp nhãn `Reference price:`, `Custody:`, `Provenance:`.
- `tests/passport-ai.test.mts`, `scripts/e2e.mjs`: thêm regression cho fallback insight, fingerprint bỏ qua `asOf`, fingerprint đổi khi data đổi, TTL 7 ngày, và modal phải render Passport AI.
- `README.md`, `.env.example`, `env.example.txt`: cập nhật hướng dẫn `PASSPORT_AI_*` và ghi rõ server cache 7 ngày.
- Verify mới nhất: `npm.cmd run test:unit` PASS; `npm.cmd run lint` PASS; `npm.cmd run typecheck` PASS; `npm.cmd run build` PASS; production e2e qua server tạm `http://127.0.0.1:3012` PASS, console errors none; bundle scan `.next/static` không có `rk_`/`rsk_`/`X-Api-Secret`/`PASSPORT_AI_API_KEY`/`ANTHROPIC_API_KEY`/write-SDK symbols.

### Tiếp theo
1. Nếu muốn test AI thật, thêm `PASSPORT_AI_API_KEY=...` vào `.env.local`, giữ mặc định `PASSPORT_AI_BASE_URL=https://v98store.com/v1` và `PASSPORT_AI_MODEL=deepseek-v4-flash`, restart server, mở một Passport và kiểm tra `data/passport-ai-cache.json` được tạo.
2. Khi deploy production, thay file cache JSON bằng Redis/KV/DB nếu cần chạy nhiều instance.

### Cảnh báo
- Server `localhost:3001` trong browser có thể vẫn là process cũ; cần restart local server để thấy Passport AI/cache mới.
- `data/passport-ai-cache.json` không được commit; đây là cache runtime.

### Nhật ký
- 2026-07-08 codex: Khôi phục Passport AI theo insight gọn, đổi provider sang OpenAI-compatible v98store/deepseek-v4-flash, thêm cache quota-safe 7 ngày theo fingerprint dữ liệu.

---

## Cập nhật phiên Codex 2026-07-08 01:44 UTC
- Agent: codex
- Commit gần nhất trước cập nhật này: `5a91b77` — "feat: make passport a wide modal"
- Commit phiên này: chuẩn bị commit "fix: de-duplicate passport content"

### Đang làm gì
Không có code đang viết dở. Phiên này xử lý browser comments mới trong Passport modal: các vùng Reference/Index note/AI summary bị lặp cùng thông tin, và CTA ownership bị nằm quá thấp.

### Đã xong
- `features/passport/PassportDrawer.tsx`: bỏ panel Passport AI khỏi UI để không lặp lại card/provenance/custody/reference price đã có ở các section chuyên trách.
- `features/passport/PassportDrawer.tsx`: bỏ note riêng bên ngoài Reference panel; giữ giải thích `not this token listing price` ngay trong panel Reference estimate.
- `features/passport/PassportDrawer.tsx`: đưa `How to own it for real` lên đầu cột phải của modal, trước Fictional game stats.
- `features/passport/PassportDrawer.tsx`: rewrite sạch component về ASCII để tránh mojibake cũ trong JSX, giữ UI copy tiếng Anh.
- `scripts/e2e.mjs`: thêm regression checks: không lặp note Index, AI panel không lặp Reference/Custody/Provenance, ownership CTA phải nằm gần đầu modal body; e2e đợi dữ liệu async thay vì sleep cứng.
- Verify mới nhất: `npm.cmd run lint` PASS; `npm.cmd run typecheck` PASS; `npm.cmd run build` PASS; `npm.cmd run e2e` PASS trên production server tạm, console errors none; `npm.cmd run test:unit` PASS; bundle scan `.next/static` không có secret/write-SDK symbols.

### Tiếp theo
1. Refresh/rerun local server để kiểm tra trực quan modal sau khi de-duplicate.
2. Nếu muốn vẫn giữ AI, cần thiết kế lại thành 1 câu insight không lặp dữ liệu; hiện UI ưu tiên không trùng thông tin.

### Cảnh báo
- `/api/passport/narrate` route vẫn còn trong codebase, nhưng Passport modal hiện không gọi nó để tránh trùng lặp nội dung.

### Nhật ký
- 2026-07-08 codex: De-duplicate Passport modal, chuyển ownership CTA lên cao, e2e đỏ-xanh cho comment 1/2/3/4.

---

## Cập nhật phiên Codex 2026-07-07 22:24 UTC
- Agent: codex
- Commit gần nhất trước cập nhật này: `4979fa7` — "feat: add rainbow slab hover"
- Commit phiên này: chuẩn bị commit "feat: make passport a wide modal"

### Đang làm gì
Không có code đang viết dở. Phiên này xử lý browser comments về giá trong Card Passport và đổi Passport UI từ drawer trượt ngang sang modal lớn khoảng 2/3 màn hình.

### Đã xong
- `features/passport/PassportDrawer.tsx`: đổi `aside` sang modal centered (`passport-modal`) thay vì side drawer; body chia 2 cột để hiển thị Reference/Custody/Provenance và AI/Stats/Ownership trong một khung rộng.
- `features/passport/PassportDrawer.tsx`: đổi copy giá thành `Reference estimate · Renaiss OS Index`; thêm giải thích Index estimate không phải exact-token listing price; CTA ownership thành `Buy exact listed card · Ask ...`; fallback thành `Open exact card page`.
- `features/passport/PassportDrawer.tsx`: ẩn note kỹ thuật `ANTHROPIC_API_KEY` khỏi UI, thay bằng câu thân thiện `AI narration is running in data-summary mode.`
- `app/globals.css`: thêm class `passport-backdrop`, `passport-modal`, `passport-header`, `passport-body`, `passport-column`, responsive mobile fallback.
- `scripts/e2e.mjs`: thêm regression checks modal rộng/centered, copy estimate vs ask, không expose env var name, ownership CTA phân biệt ask exact token.
- TDD check: e2e fail trước ở `Passport should render as a centered wide modal... width 460`; sau implementation e2e PASS.
- Verify mới nhất: `npm.cmd run lint` PASS; `npm.cmd run typecheck` PASS; `npm.cmd run build` PASS; `npm.cmd run test:unit` PASS; e2e production server tạm PASS hero loop + modal/copy assertions, console errors none; bundle scan `.next/static` không có secret/write-SDK symbols.

### Tiếp theo
1. Nếu browser hiện chưa refresh được `localhost:3001`, chạy `python run_local.py` hoặc `npm.cmd run dev -- -p 3001`; trong phiên này build/e2e đã chạy qua server tạm 3002, còn các cách launch nền 3001 bằng `Start-Process` không giữ process ổn định trong sandbox.
2. Nếu muốn modal cao hơn/thấp hơn, chỉnh `width`/`max-height` trong `.passport-modal`.

### Cảnh báo
- Modal cố gắng hiển thị nhiều thông tin trong một khung; dữ liệu async vẫn có skeleton nếu upstream chậm.
- Giá `Reference estimate` và `Ask` là hai nguồn khác nhau: Index observations vs seller listing của exact token.

### Nhật ký
- 2026-07-07 codex: Cập nhật Passport thành wide modal và copy phân biệt giá; e2e đỏ-xanh cho modal/copy; visual screenshot mới ở `.e2e-output/07-passport.png`.

---

## Cập nhật phiên Codex 2026-07-07 21:58 UTC
- Agent: codex
- Commit gần nhất trước cập nhật này: `73a5d62` — "chore: clear lint debt"
- Commit phiên này: chuẩn bị commit "feat: add rainbow slab hover"

### Đang làm gì
Không có code đang viết dở. Phiên này xử lý yêu cầu UI: khi user hover vào card interactive, card có viền 7 sắc cầu vồng giống ảnh tham chiếu.

### Đã xong
- `app/globals.css`: thêm pseudo-element `.slab.interactive::before` với rainbow gradient border; chỉ hiện khi hover/focus-visible, không thêm DOM và không che nội dung card.
- `scripts/e2e.mjs`: thêm regression assertion hover card phải có gradient border visible.
- TDD check: e2e fail trước khi có CSS với lỗi `Interactive slab hover should show a visible rainbow border`, sau đó pass sau implementation.
- Verify mới nhất: `npm.cmd run lint` PASS; `npm.cmd run test:unit` PASS; `npm.cmd run typecheck` PASS; `npm.cmd run build` PASS; e2e production server tạm PASS hero loop và hover assertion. Bundle scan `.next/static` không có secret/write-SDK symbols.

### Tiếp theo
1. Nếu muốn hiệu ứng mạnh hơn nữa, chỉnh riêng độ dày `padding` của `.slab.interactive::before` hoặc glow hover trong `app/globals.css`.
2. Refresh `http://localhost:3001/` để xem bản đang chạy local.

### Cảnh báo
- E2E lần xanh vẫn log 2 console errors `502 Bad Gateway` từ resource upstream; script không fail vì hero loop và assertion UI đều pass. Nếu cần console sạch tuyệt đối, cần điều tra upstream resource/image/API trả 502.

### Nhật ký
- 2026-07-07 codex: Thêm rainbow border hover cho `.slab.interactive`; chụp visual check ở `.e2e-output/rainbow-hover.png`; `localhost:3001` trả HTTP 200 sau build.

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
- 2026-07-09 codex: Thêm disclaimer tiếng Anh dưới hero intro:
  "This is not an official website or product of renaiss.xyz." trong
  `features/intro/Intro.tsx`; thêm `hosting/boot.log` vào `.gitignore` để tránh
  commit log diagnostic. Verify local `npm.cmd run lint` PASS, `npm.cmd run build`
  PASS. Deploy GitHub Actions run `29002679171` SUCCESS; `curl -I
  https://arenaiss.xyz` trả HTTP 200 và HTML thật có disclaimer mới.
- 2026-07-09 codex: Workflow `Deploy` đã chạy tới bước FTP, tức lint/typecheck/unit
  tests/build/syntax checks đều qua trên GitHub Actions. Run `28982198568` fail ở
  `Upload to Namecheap FTP` với `Input required and not supplied: password`.
  `gh secret list` cho thấy repo hiện chỉ có `FTP_ARENAISS_HOST`; cần thêm
  `FTP_PASSWORD` (và nên thêm đủ `FTP_SERVER`, `FTP_USERNAME`, `FTP_SERVER_DIR`)
  trước khi chạy lại workflow.
- 2026-07-09 codex: Đồng bộ workflow với mô hình CI/CD tự động chủ dự án yêu cầu:
  đổi workflow thành `.github/workflows/deploy.yml`, trigger `main` và `master`,
  runner Node 20, thêm `node --check` cho startup wrapper + deploy payload, dùng
  GitHub Secrets chuẩn `FTP_SERVER`, `FTP_USERNAME`, `FTP_PASSWORD`,
  `FTP_SERVER_DIR` (vẫn fallback secret cũ nếu còn). Lỗi Actions trước đó là lint
  chặn CommonJS wrapper; đã thêm disable hẹp trong `hosting/namecheap-server.js`
  và ignore `deploy/**` trong ESLint. Verify local: `npm.cmd run lint` PASS,
  `node --check hosting/namecheap-server.js`, `deploy/server.js`,
  `deploy/app/server.js` PASS.
- 2026-07-09 codex: Debug Namecheap 503 từ `stderr.log`: lỗi hiện tại là
  `Cannot find module 'next'` trong `/home/fundvmbn/arenaiss/app/server.js`, tức
  server thấy root wrapper nhưng thiếu runtime module trong `app/node_modules`.
  Chốt hướng tự động: GitHub Actions build Next standalone, upload payload qua FTP
  với root sạch (`server.js`, minimal `package.json`, `app/`, `tmp/restart.txt`),
  giữ dependencies bên trong `app/node_modules`, và chạm `tmp/restart.txt` để
  app reload; không dùng manual ZIP/Run NPM Install làm đường chính. Verify local:
  `npm.cmd run build` PASS; `node deploy/server.js` trên port 3010 trả HTTP 200.
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
# Codex update 2026-07-09 cinematic pack-opening FX
- Agent: codex
- Latest commit before this update: `67e052d` - "fx: amplify pack reveal explosion"
- Session commit: `a326832` - "feat: cinematic pack-opening FX"

## Current work
No unfinished code is intentionally left. This batch completes, commits, pushes, and deploys the new "AAA gacha reveal" pack-opening FX from attachment
`C:\Users\TBC\.codex\attachments\654a82a0-b272-4cd4-b7ee-246fcdb6a0a4\pasted-text.txt`.

## Done
- `features/pack-open/PackOpen.tsx`: replaced the old lightweight pack reveal with a cinematic Framer Motion sequence.
  - Phase model: `charge -> crack -> burst -> reveal -> settle`.
  - Reads the already-created `PackReveal` only; no changes to pack RNG/gacha logic.
  - Uses tier intensity map, tier colors, ordered card reveal, skip-on-tap, `prefers-reduced-motion`, and a `ParticleCanvas`.
  - Uses the existing `Slab` component for the revealed cards.
- `app/globals.css`: added cinematic pack CSS classes:
  - `.cinematic-pack-shell`
  - `.cinematic-particle-canvas`
  - `.cinematic-pack-stage`
  - `.cinematic-pack-object`
  - `.cinematic-burst`
  - `.cinematic-card-grid`
  - `.cinematic-card-reveal`
  - related aura/crack/half/godray/tier-badge styles.
- `scripts/e2e.mjs`: pack-opening helper now asserts the cinematic shell, stage, explosion, particle canvas, and reveal card grid.

## Verification
- `npm.cmd run lint` PASS.
- `npm.cmd run typecheck` PASS.
- `npm.cmd run build` PASS.
- `npm.cmd run test:unit` PASS.
- Production local e2e against `http://127.0.0.1:3037` PASS; console errors none.
- `git diff --check` PASS, only Windows line-ending warnings.
- GitHub Actions Deploy run `29020512939` PASS.
- Live `https://arena-card.xyz/` PASS: HTTP 200, HTML contains `Arenaiss`, production CSS contains
  `cinematic-pack-shell`, `cinematic-particle-canvas`, `cinematic-burst`, and `cinematic-card-grid`.

## Next steps
1. User should hard-refresh `https://arena-card.xyz/` before judging the new FX, because browser cache may keep the old CSS for a short time.
2. If the user still wants more spectacle, tune only `features/pack-open/PackOpen.tsx` timing/intensity and the cinematic CSS block; do not change gacha logic.

## Warnings
- Product UI/copy must remain English.
- Do not change gacha logic, RNG, credits, account logic, or Renaiss API behavior for this FX task.
- Visual particle randomness is presentation-only; it must not feed back into game state.

## Log
- 2026-07-09 codex: Started full cinematic pack-opening FX rewrite, added Framer Motion phase orchestration and canvas particles, then paused per user request before typecheck was green.
- 2026-07-09 codex: Resumed, fixed TypeScript easing/context issues, added e2e assertions for cinematic FX, and completed local verification.
- 2026-07-09 codex: Committed and pushed `a326832`; GitHub Actions deploy succeeded and live CSS verification passed on `arena-card.xyz`.

---
# Codex update 2026-07-09 premium vault pack reveal
- Agent: codex
- Latest commit before this update: `19d52bd` - "docs: update cinematic FX handoff"
- Session commit: preparing `fx: replace pack reveal with premium vault sequence`

## Current work
No unfinished code is intentionally left. This batch replaces the previous neon/godray pack-opening style because the user judged it ugly. The new direction is Premium Vault Pack Reveal: clearer pack object, vault seal, foil sweep, crack, short flash-card burst, and cleaner card reveal.

## Done
- `features/pack-open/PackOpen.tsx`:
  - Reduced particle counts and lengthened the visible burst phase so the reveal reads as a pack opening rather than a brief neon blink.
  - Changed pack motion to calmer hover/wind-up, crack, and split-open behavior.
  - Added pack face layers, vault seal, lock bar, side cracks, flash-card silhouette, and foil chips.
  - Hid the phase copy during burst so the visual is not cluttered by text.
- `app/globals.css`:
  - Replaced godray/blob-heavy styling with darker premium-vault spotlight, foil pack face, RA seal, lock rail, controlled tier glow, flash card, and foil chips.
  - Added `vaultFoilSweep` keyframes.
  - Brightened the stage enough that the pack/result no longer disappears into the dark background.

## Verification
- `npm.cmd run lint` PASS.
- `npm.cmd run typecheck` PASS.
- `npm.cmd run test:unit` PASS.
- `npm.cmd run build` PASS.
- Production local e2e against `http://127.0.0.1:3037` PASS; console errors none.
- `git diff --check` PASS, only Windows line-ending warnings.
- Manual visual screenshots captured locally:
  - `.e2e-output/pack-vault2-charge.png`
  - `.e2e-output/pack-vault2-burst.png`
  - `.e2e-output/pack-vault2-result.png`

## Next steps
1. Commit and push this batch.
2. Watch GitHub Actions deploy.
3. Verify live `https://arena-card.xyz/` CSS contains the updated vault classes and the site returns HTTP 200.

## Warnings
- This is still a CSS/Framer presentation layer only. Gacha logic/RNG/credits/auth were not intentionally touched.
- Product copy remains English.

## Log
- 2026-07-09 codex: Reworked the pack reveal away from neon/godray into a premium vault-pack opening sequence and verified local production flow.

---
# Codex update 2026-07-09 visible card emergence in pack reveal
- Agent: codex
- Latest commit before this update: `f3843a2` - "fx: replace pack reveal with premium vault sequence"
- Session commit: preparing `fx: show actual card during pack burst`

## Current work
No unfinished code is intentionally left. User reported the new visual still looked like the old one because the burst did not clearly show a card. This batch makes the visual explicit: the actual highest-tier card from the pack emerges large in the center during the burst phase.

## Done
- `features/pack-open/PackOpen.tsx`: during `burst`, renders `cinematic-emerge-card` using the existing `Slab` component for the spotlight/highest-tier card.
- `app/globals.css`: added `cinematic-emerge-card` and halo styling so the card visibly flies up from the pack.
- `scripts/e2e.mjs`: now asserts `.cinematic-emerge-card .slab` appears during pack opening, preventing regressions back to a vague particle-only reveal.

## Verification
- `npm.cmd run lint` PASS.
- `npm.cmd run typecheck` PASS.
- `npm.cmd run build` PASS.
- Production local e2e against `http://127.0.0.1:3037` PASS; console errors none.
- Manual screenshot confirming the real card appears during burst:
  - `.e2e-output/pack-emerge-card-burst.png`
- `git diff --check` PASS, only Windows line-ending warnings.

## Next steps
1. Commit and push this batch.
2. Watch GitHub Actions deploy.
3. Verify live bundle includes `cinematic-emerge-card`.

## Warnings
- Presentation layer only; no intended changes to gacha logic/RNG/credits/auth.

## Log
- 2026-07-09 codex: Added actual spotlight card emergence in pack burst because the previous vault visual still did not read clearly enough.

---
# Codex update 2026-07-09 hero cleanup + lineup filter
- Agent: codex
- Latest commit before this update: `9f34436` - "copy: add unofficial site disclaimer"
- Session commit: preparing `ui: add lineup filter, login-gated ripping, and pack reveal fx`

## Current work
No unfinished code is intentionally left. This batch removes the intro `DEMO` label, adds the Roster-style filter bar to Lineup, gates pack ripping behind login, and improves the pack reveal FX.

## Done
- `features/intro/Intro.tsx`: removed the standalone `DEMO` label above `Arenaiss Simulation`.
- `components/CardFilterBar.tsx`: extracted the shared `All / Pokemon / One Piece / TOP / S / A / B / C / D` filter UI and card filtering helper.
- `features/roster/Roster.tsx`: switched to the shared filter bar, preserving existing roster behavior and tier colors.
- `features/deck-builder/DeckBuilder.tsx`: added the same filter bar to Lineup. `Pokemon` / `One Piece` switch the active arena; tier buttons filter the active arena roster.
- `app/arena/state.tsx` + `components/AuthPanel.tsx`: track signed-in state globally so gameplay screens can enforce login-only actions.
- `features/intro/Intro.tsx`: disables `Rip a Pack` until the user is signed in and shows login guidance.
- `features/pack-open/PackOpen.tsx` + `app/globals.css`: added vault-seal crack, halo, sparks, flare, and staged card reveal visuals for pack opening.
- `scripts/e2e.mjs`: added regression checks that intro no longer shows `DEMO`, pack ripping is disabled before login, Lineup renders/uses the filter bar, and pack FX appears during opening.

## Verification
- `npm.cmd run lint` PASS.
- `npm.cmd run typecheck` PASS.
- `npm.cmd run build` PASS.
- Production local e2e against `http://127.0.0.1:3037` PASS; console errors none.

## Next
1. Commit and push this batch.
2. Confirm GitHub Actions deploy succeeds.
3. Verify live `https://arenaiss.xyz/` no longer shows the `DEMO` label, keeps the unofficial-site disclaimer, disables pack ripping before login, and deploys the pack reveal FX.

## Warnings
- None known.

## Log
- 2026-07-09 codex: Implemented requested hero cleanup, Lineup filter reuse, login-gated pack ripping, and improved pack reveal FX.

---
# Codex update 2026-07-09 stronger pack reveal FX
- Agent: codex
- Latest commit before this update: `0e73930` - "ui: add lineup filter and pack reveal fx"
- Session commit: preparing `fx: amplify pack reveal explosion`

## Current work
No unfinished code is intentionally left. This batch only strengthens pack-opening presentation; pack logic/RNG is unchanged.

## Done
- `features/pack-open/PackOpen.tsx`: added an explicit `detonating` phase between charge and reveal.
- `app/globals.css`: added stronger shake, chromatic halo, explosion core, shards, brighter cracks, and stronger tier-colored burst visuals.
- `scripts/e2e.mjs`: now waits for `.pack-explosion` before result reveal so the burst phase is regression-tested.

## Verification
- `npm.cmd run lint` PASS.
- `npm.cmd run typecheck` PASS.
- `npm.cmd run build` PASS.
- Production local e2e against `http://127.0.0.1:3037` PASS; console errors none.

## Next
1. Commit and push this batch.
2. Confirm GitHub Actions deploy succeeds.
3. Verify the live domain loads the CSS containing `pack-explosion`.

## Warnings
- None known.

## Log
- 2026-07-09 codex: Amplified pack reveal FX with stronger vibration, chromatic color, and pre-reveal explosion.

---
