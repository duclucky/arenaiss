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
- Thời điểm: <YYYY-MM-DD HH:MM UTC>
- Agent: <claude-code | codex>
- Commit gần nhất: <hash + message, hoặc "chưa commit">

## Đang làm gì (current focus)
<Một tính năng/file duy nhất đang tập trung. Vd: "battle engine — lib/game/battle.ts,
đang cân bằng type-advantage">

## Đã xong (theo bước ở docs/build-plan.md mục 7)
- [ ] B1. Data layer + proxy routes + Zod schema
- [ ] B2. Stat engine + gacha engine LAI (odds chance → pool marketplace)
- [ ] B3. Battle engine (Top-Trumps, chọn thuộc tính + type-advantage) + cân bằng
- [ ] B4. UI hero loop (mở gói → reveal → roster → deck builder → battle → kết quả)
- [ ] B5. Card Passport drawer + lớp AI narration + nút "How to own it for real"
- [ ] B6. Polish + README nộp bài + kịch bản video demo
- Stretch: [ ] localStorage save  [ ] Google login  [ ] by-image scan
(đánh dấu [x] khi xong; ghi chú file chính bên cạnh)

## Tiếp theo (next steps — cụ thể, làm được ngay)
1. <việc kế tiếp rõ ràng, file nào>
2. <...>

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
- <vd: "app/api/... route đang trả 502, chưa xử lý"; hoặc "chưa có gì">

## Nhật ký ngắn (mới nhất lên đầu)
- <YYYY-MM-DD> <agent>: <làm gì, quyết định gì>
