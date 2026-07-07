# AGENTS.md — hướng dẫn cho agent (Codex và tương thích)

Dự án này dùng nhiều agent (Claude Code, Codex) luân phiên. Để tất cả hiểu nhau:

## 1. Luật bất biến — đọc CLAUDE.md
Toàn bộ RÀNG BUỘC BẤT BIẾN (read-only, key server-side, kinh tế ảo, chỉ số hư
cấu, v.v.) nằm trong `CLAUDE.md`. ĐỌC CLAUDE.md TRƯỚC và tuân thủ y hệt như
Claude Code. AGENTS.md này không lặp lại luật để tránh lệch nguồn — CLAUDE.md là
nguồn luật duy nhất.

## 2. Bối cảnh & tiến độ — đọc/ghi HANDOFF.md
- ĐẦU phiên: đọc `HANDOFF.md` để lấy bối cảnh, rồi đối chiếu `git log --oneline -10`
  + `git status` (git là sự thật về code). Không tin file một cách mù quáng.
- CUỐI phiên (hoặc khi sắp hết quota): CẬP NHẬT `HANDOFF.md` (mục Đang làm gì /
  Đã xong / Tiếp theo / Cảnh báo / Nhật ký) trước khi dừng. Đây là bắt buộc.

## 3. Kế hoạch & tham chiếu
- `docs/build-plan.md` — kế hoạch build + thứ tự thực thi (mục 7).
- `docs/api-reference.md` — endpoint 3 nguồn API (đừng bịa).
- `docs/art-direction.md` — thẩm mỹ (thắng về mặt UI style).
- `prompts/passport-narration.md` — system prompt lớp AI Card Passport.

## 4. Cách làm việc
- Ưu tiên hero loop; chống scope-creep. Code chạy được > số lượng tính năng.
- Commit theo từng bước với message rõ (vd "done: gacha engine") để phiên sau
  định vị dễ.
- App tiếng ANH. Đối chiếu type SDK @renaiss-protocol/client@alpha với
  api-reference.md; nếu lệch, sửa file đó cho khớp.
- Tự kiểm ràng buộc an toàn sau mỗi bước lớn (đặc biệt: không lộ key ra client).
