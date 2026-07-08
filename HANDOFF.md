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
