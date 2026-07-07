# Renaiss Arena — Claude Code guide

File này được nạp vào mọi phiên. Giữ ngắn: chỉ ghi RÀNG BUỘC và SỰ THẬT dự án.
Chi tiết nằm ở các file trong `docs/` — đọc chúng khi cần.

## Dự án là gì
Card-battler kiểu **gacha-as-draft** cho hệ sinh thái **Renaiss** (hạ tầng thanh
khoản RWA cho đồ sưu tầm — thẻ Pokémon/One Piece giám định, trên BNB Chain).

Vòng chơi (bản chuẩn, tiếng Anh dùng trong sản phẩm): "Open packs using reference
odds → collect fictional cards based on real graded-card data → build a deck →
battle in a skill-based Top-Trumps game. Win virtual credits to open more. Every
card links to its real Card Passport." Mỗi thẻ có nút "How to own it for real"
dẫn về gói/marketplace thật của Renaiss (phễu cho hệ sinh thái — đừng cắt).

Thẻ trong game là **card DỰA TRÊN dữ liệu thẻ giám định thật** (set + item +
grade), KHÔNG phải NFT người chơi sở hữu. Không tuyên bố người chơi sở hữu gì;
khung cảm xúc là "dream deck / khao khát".

## RÀNG BUỘC BẤT BIẾN (không bao giờ vi phạm)
- **READ-ONLY tuyệt đối.** Chỉ endpoint GET. KHÔNG bao giờ dùng
  `createSecureClient`, signer, `pullGacha`, `buyback`, private key, hay bất kỳ
  giao dịch on-chain nào. Vi phạm = loại bài thi (tiêu chí Safety).
- **Mọi API key đặt SERVER-SIDE** (route handler proxy). Không lộ ra client bundle.
- **Kinh tế game là ẢO.** Mở gói MÔ PHỎNG, không tốn tiền thật — luôn có nhãn rõ.
- **Chỉ số game HƯ CẤU.** Không bao giờ trình bày như định giá tài sản / lời
  khuyên đầu tư.
- **App TIẾNG ANH toàn bộ** (UI, copy, README, video demo). Trao đổi với chủ dự
  án có thể tiếng Việt, nhưng mọi thứ trong sản phẩm là tiếng Anh.
- **localStorage/cookie CHỈ để lưu tiến trình game** (roster/credit/deck), có
  versioning. TUYỆT ĐỐI KHÔNG lưu API key, secret, hay dữ liệu nhạy cảm vào
  localStorage/cookie/client. (Lệnh cấm localStorage cũ chỉ đúng cho artifact
  claude.ai — app Next.js độc lập này dùng localStorage bình thường.)
- **Hai chế độ lưu** (làm cả hai): ẩn danh → localStorage máy user; Google login
  → chơi đa thiết bị, giữ lịch sử mở thẻ demo (chỉ scope định danh tối thiểu).
- **Giá từ API là chuỗi**, có thể là `"NO-ASK-PRICE"` / `"NO-FMV-PRICE"` → luôn
  xử lý an toàn trước khi tính toán.
- Dùng số từ Index API thì **ghi attribution "Renaiss OS Index"**.
- Data đang beta → có thể thiếu/trễ. Hiển thị caveat "tham chiếu thử nghiệm,
  không phải sự thật thị trường đã xác minh".

## Nguồn dữ liệu (3, tách vai) — chi tiết ở docs/api-reference.md
1. `api.renaiss.xyz` (v0, GET): pool rút thẻ (`/v0/marketplace`), Card Passport
   (`/v0/cards/{tokenId}`), nút "sở hữu thật" (`/v0/packs`).
2. `@renaiss-protocol/client@alpha`, CHỈ `createPublicClient()`: đọc gacha machine
   tier + `chance` (odds thật).
3. `api.renaissos.com` (v1, partner key server-side): giá reference + confidence
   cho Card Passport.

## Quy ước code — chi tiết ở docs/build-plan.md
- Next.js App Router. Proxy qua route handlers (giấu key, xử lý CORS/rate-limit,
  cache).
- **Zod validate mọi response + mọi SSE event.**
- **Errors-as-values** (kiểu Result, `isSuccess`/`isFailed`), KHÔNG throw — theo
  pattern của SDK.
- Tách theo feature-folder. Một **card-detail drawer dùng chung** (Card Passport).

## Khi dựng/chỉnh UI
Đọc `docs/art-direction.md` TRƯỚC. File đó thắng về mặt thẩm mỹ; nếu có skill
`frontend-design` của môi trường, chỉ dùng nó cho kỹ thuật dựng (accessibility,
cấu trúc component), không cho palette/phong cách.

## Card Passport có lớp AI
System prompt bắt buộc ở `prompts/passport-narration.md`. Luôn kèm nguồn +
thời điểm; không bao giờ khẳng định gian lận/hàng giả.

## Định nghĩa "xong"
Chạy được + demo được. Ưu tiên HERO LOOP hoàn chỉnh (mở gói → deck → đấu có
skill → Passport) hơn nhiều tính năng nửa vời. Một hero moment mượt thắng năm
tính năng dang dở.

## Bàn giao giữa phiên / agent — HANDOFF.md (bắt buộc)
Dự án dùng nhiều agent luân phiên (Claude Code, Codex). ĐẦU mỗi phiên: đọc
`HANDOFF.md` để lấy bối cảnh, rồi đối chiếu `git log --oneline -10` + `git status`
(git là sự thật về code; HANDOFF là sự thật về ý định/bối cảnh). CUỐI mỗi phiên
(hoặc khi sắp hết quota): CẬP NHẬT `HANDOFF.md` (Đang làm gì / Đã xong / Tiếp
theo / Cảnh báo / Nhật ký) trước khi dừng. Codex đọc AGENTS.md — cùng nghi thức.

## Giữ file này đồng bộ
Khi chốt một quyết định kiến trúc mới, cập nhật CLAUDE.md hoặc file docs tương
ứng để các phiên sau không trôi về mặc định.
