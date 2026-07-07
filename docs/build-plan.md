# Build Plan — Renaiss Arena

Kế hoạch xây dựng đầy đủ. Đọc cùng `CLAUDE.md` (ràng buộc), `docs/api-reference.md`
(endpoint), `docs/art-direction.md` (thẩm mỹ), `prompts/passport-narration.md`
(lớp AI). Ưu tiên hero loop; chống scope-creep.

## 1. Sản phẩm
Webapp card-battler **gacha-as-draft** cho hệ sinh thái Renaiss. Dùng ĐÚNG cơ chế
gacha lõi (mở gói theo odds thật) làm cách xây deck, thay vì bắt người chơi
search/kéo-thả. Mỗi thẻ đã có sẵn chỉ số game từ data thật (grade, tier, fmv,
year, set, grading company) — game "mọc ra" từ dữ liệu, không phải gắn data
trang trí. Chơi bằng MẪU THẺ, không chiếm hữu NFT của ví nào.

## 2. Vòng chơi cốt lõi (HERO — làm sâu nhất)
Câu mô tả chuẩn (dùng nguyên trong sản phẩm, TIẾNG ANH): "Open packs using
reference odds → collect fictional cards based on real graded-card data → build a
deck → battle in a skill-based Top-Trumps game. Win virtual credits to open more.
Every card links to its real Card Passport."
Thẻ trong game là card DỰA TRÊN dữ liệu thẻ giám định thật, KHÔNG phải NFT người
chơi sở hữu — tránh mọi câu chữ gây hiểu nhầm sở hữu. Loop có tiến trình, có lý
do quay lại.

Neo hệ sinh thái (BẮT BUỘC): mỗi thẻ có nút "How to own it for real" → hiển thị
gói THẬT của Renaiss có cơ hội trúng loại thẻ này (`/v0/packs`) + link marketplace.
Game trở thành phễu dẫn về gacha/marketplace thật. Đừng cắt khi hết giờ.

Ngôn ngữ: toàn bộ UI / copy / README / video demo bằng TIẾNG ANH (app phục vụ
global). Ảnh nội bộ cũ có thể còn chuỗi tiếng Việt — đổi hết sang tiếng Anh.

## 3. Ba quyết định thiết kế đã chốt (làm đúng, đừng đơn giản hoá)

### 3.1 Nguồn gói & odds — LAI
Odds theo tier lấy THẬT từ `GachaMachineTier.chance` (SDK); pool thẻ rút từ
`/v0/marketplace` lọc theo tier/grade. Xem chi tiết ở `api-reference.md` mục
"Logic gacha LAI". Hiển thị bảng odds minh bạch; ghi nhãn nguồn.

### 3.2 Kinh tế ẢO — tách tuyệt đối khỏi tiền thật
Mở gói trong game KHÔNG tốn USDT thật, KHÔNG ký ví, KHÔNG on-chain. Chỉ tiêu
"credit game" kiếm bằng chơi (thắng trận, nhiệm vụ). Nhãn rõ mọi nơi: "Mở gói
MÔ PHỎNG — không phải mở gói thật, không mất tiền." Vừa là ranh giới Safety, vừa
tránh giống cờ bạc.

### 3.3 Lối đánh CÓ SKILL — không để thành đỏ-đen
Top-Trumps theo lượt, deterministic (seed từ tokenId, tái lập được):
- Mỗi lượt, người TẤN CÔNG chọn 1 thuộc tính để so (atk/def/aura) — quyết định
  chiến thuật, không auto.
- TYPE-ADVANTAGE kiểu kéo-búa-bao giữa các "element" (suy từ gradingCompany/set):
  thắng type → cộng hệ số.
- Thứ tự đánh bài do người chơi sắp → thêm một tầng quyết định.
- Cân bằng sao cho quyết định người chơi có trọng số ≥ độ hiếm thẻ; thẻ tier cao
  KHÔNG auto thắng.
- Hiển thị TỪNG lượt: so thuộc tính gì, type-advantage ra sao, ai thắng vì sao.

### 3.4 Luật credit (đã chốt)
Credit là tiền ẢO trong game. Hồi mỗi ngày lúc 00:00 UTC, CHỈ với id có credit
< 100 thì NẠP CHO ĐỦ VỀ 200 (đặt = 200, KHÔNG cộng dồn; credit ≥ 100 không được
hồi). Viết dạng HÀM THUẦN dùng chung: input (credit hiện tại, mốc hồi cuối, giờ
hiện tại) → output (credit mới, mốc hồi mới). Chế độ login thực thi ở SERVER theo
tài khoản (đáng tin). Chế độ ẩn danh tính ở CLIENT (kiểu "danh dự" — không cần
chống gian lận vì credit ẢO; chấp nhận được).

### 3.5 Hai chế độ lưu (đã chốt — LÀM CẢ HAI từ đầu)
- Ẩn danh: lưu tiến trình (roster/credit/deck) vào localStorage máy user, có
  versioning + `savedAt` + nút reset. Chú thích UI: "Data is saved only on this
  device."
- Google login: chơi đa thiết bị, giữ lịch sử mở thẻ demo. Chú thích UI:
  "Sign in with Google to play across devices with your full demo pull history."
  Chỉ xin scope ĐỊNH DANH tối thiểu; KHÔNG đụng dữ liệu Google khác. State theo
  tài khoản lưu ở server/KV.
An toàn: localStorage/cookie CHỈ chứa tiến trình game — KHÔNG bao giờ chứa API
key/secret hay dữ liệu nhạy cảm.

### 3.6 Thẻ & CTA (đã chốt — chi tiết layout ở art-direction.md)
Layout thẻ phải HẾT chồng chữ (bản cũ bị "DEF" đè nút Passport). Có CTA nhiều lớp
để người dùng biết thẻ bấm được (xem art-direction.md mục "Thẻ" + "CTA").
- `ATK = f(grade)`: map số grade (PSA/BGS/CGC/SGC 10→100, 9→85, 8→70…); RAW thấp hơn.
- `DEF/HP = f(year)`: vintage (year nhỏ) có "legacy bonus"; thẻ mới "bền" hơn.
- `AURA = percentile(fmvPriceInUSD)` trong pool đang chơi.
- `ELEMENT/TYPE`: suy từ gradingCompany hoặc set/type — dùng cho type-advantage.
- `OVERALL POWER`: tổng có trọng số, HIỂN THỊ cách tính trên mỗi lá.
CAVEAT bắt buộc: "Chỉ số game HƯ CẤU, KHÔNG phản ánh giá trị đầu tư / định giá."

## 5. Tính năng phụ (chạy được tử tế, dùng chung khung UI)
1. Card Passport (drawer dùng chung) — click BẤT KỲ quân bài nào → hồ sơ thật:
   giá reference + confidence (Index API), lịch sử on-chain (activities), custody
   + quốc gia. Có lớp AI narration (xem prompts/). Là chất keo + nơi đặt nút
   "How to own it for real".
2. Hai chế độ lưu + luật credit (mục 3.4, 3.5) — CORE, làm cả hai từ đầu.
STRETCH (chỉ khi hero đã ngon):
3. My Collection mode — nhập user-id Renaiss → `/v0/users/{id}` →
   favoritedCollectibles thành deck (chế độ ownership-thật). (Khác với chế độ lưu
   Google login — đây là chơi bằng bộ sưu tập favorite của một tài khoản Renaiss.)
4. (Wow) thêm `POST /v1/graded/by-image` để "quét ảnh slab" tạo thẻ — chỉ nếu dư giờ.

## 6. Kiến trúc & stack
- Next.js App Router. Route handlers = proxy server-side (giấu key, gộp gọi, xử
  lý CORS/rate-limit, cache/snapshot để demo mượt).
- Zod validate mọi response + SSE. Errors-as-values (Result/isSuccess/isFailed).
- Data layer chung + card-detail drawer dùng chung. State game trong React;
  PERSIST tiến trình: localStorage (ẩn danh) hoặc server/KV theo tài khoản (login).
  KHÔNG lưu key/secret ở client. Tách theo feature-folder:
  `pack-open/`, `roster/`, `deck-builder/`, `battle/`, `passport/`, `auth/`,
  `lib/` (data layer, stat engine, gacha engine, battle engine, credit, save),
  `app/api/` (proxy routes + auth + save theo tài khoản).

## 7. Thứ tự thực thi đề xuất
1. Data layer + proxy routes + Zod schema (marketplace, cards, packs, gacha
   machine qua SDK, Index card). Xử lý "NO-...-PRICE".
2. Stat engine (công thức mục 4) + gacha engine lai (odds `chance` → pool) +
   credit (hàm thuần mục 3.4) + save layer (localStorage, có versioning).
3. Battle engine (mục 3.3) TRƯỚC UI đấu; tự chơi thử vài trận để cân bằng skill
   vs độ hiếm.
4. UI hero loop: màn mở gói + reveal → roster → deck builder → battle → kết quả.
   Card component + CTA (mục 3.6 + art-direction). Toàn bộ copy TIẾNG ANH.
5. Card Passport drawer + lớp AI narration + nút "How to own it for real".
6. Google login + đồng bộ save theo tài khoản (server thực thi luật credit).
7. Polish + game-feel (xem art-direction) + README nộp bài + video demo.

## 8. Hero moment của demo
Mở gói → animation reveal thẻ theo tier → lắp deck → đấu, mỗi lượt thấy vì sao
thắng → click một lá xem Passport thật → thấy nút dẫn về gói/marketplace Renaiss.
Đầu tư nhất vào: animation mở gói/reveal, và chiều sâu quyết định trong trận.

## 9. README nộp bài (Claude Code tự sinh cuối cùng)
Gồm: data sources (3 nguồn + attribution "Renaiss OS Index"); assumptions;
limitations (beta data, odds lai, mẫu-thẻ-không-phải-NFT, giới hạn "thẻ của ví");
safety (read-only, không private key, kinh tế ảo, chỉ số hư cấu). Kèm 6 gạch đầu
dòng kịch bản video demo, ánh xạ vào Usability / Innovation / Ecosystem relevance
/ Clarity / Safety.

## 10. Chống scope-creep (bắt buộc)
- Làm HERO LOOP xuất sắc trước. My Collection & by-image là STRETCH.
- Mỗi tính năng tự hỏi: "nó có phục vụ vòng mở-gói→deck→đấu→soi-thẻ→dẫn-về-Renaiss
  không?" Nếu rời rạc → cắt.
- Một hero loop mượt + một hero moment sâu thắng năm tính năng nửa vời.
