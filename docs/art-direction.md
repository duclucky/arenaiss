# Art Direction — Renaiss Arena

Đọc file này TRƯỚC KHI dựng hoặc chỉnh bất kỳ UI nào. Mục tiêu: cảm giác "tủ
trưng bày báu vật số" cao cấp, không phải card game generic. File này THẮNG về
mặt thẩm mỹ; skill frontend-design của môi trường (nếu có) chỉ dùng cho kỹ thuật
dựng (accessibility, cấu trúc component), không cho palette/phong cách.

## Nguyên tắc gốc
- Mỗi quân bài LÀ một slab giám định số: hộp trong suốt, thanh nhãn grade ở đỉnh,
  ảnh thẻ thật ở giữa, chỉ số game phủ lên như HUD. Con số grade vừa là grade
  thật vừa là ATK — làm nó nổi bật.
- Khoe ảnh thẻ thật, đừng che. Ảnh là ngôi sao; UI là khung tôn ảnh lên.
- Tông chủ đạo: Premium Vault / cyber-TCG. Nền tối, kính mờ, viền phát sáng theo
  tier, slab như lơ lửng trong tủ có đèn hắt. Pha chút cảm giác cao cấp kiểu bảo
  tàng (typography thanh, khoảng thở rộng).

## Palette (dark-first)
Nền & bề mặt:
- Nền sâu nhất (page): `#0B0E14`
- Bề mặt slab / panel: `#151A23`
- Bề mặt nổi (drawer, modal): `#1C222D`
- Viền hairline: `rgba(255,255,255,0.08)`; viền mạnh: `rgba(255,255,255,0.16)`
- Text chính: `#EDF0F5`; phụ: `#A0A8B4`; mờ: `#6B7280`
- Accent trung tính (nút chính, số power): `#E5C07B` (vàng nhạt "vault")

Màu theo TIER (dùng cho viền phát sáng, thanh nhãn, hạt sáng reveal):
- TOP → vàng kim `#F5B301` (glow mạnh nhất)
- S   → tím      `#A277FF`
- A   → lam      `#4C8DFF`
- B   → lục ngọc `#2FD3A5`
- C   → xám bạc  `#8A93A0`
- D   → xám trầm `#5A626E`
Tier càng cao, cường độ glow + độ bão hoà càng lớn. Hiển thị legend tier 1 lần.

## Slab (component quan trọng nhất)
- Tỷ lệ ảnh thẻ ~2.5:3.5; slab thêm thanh nhãn đỉnh nên tổng thể cao hơn.
- CẤU TRÚC DỌC (mỗi khối MỘT TẦNG RIÊNG, KHÔNG đè lên nhau — bản cũ bị "DEF" đè
  nút Passport):
  1. Thanh tier mỏng phát sáng (đỉnh).
  2. Nhãn: tên thẻ (tối đa 2 dòng + ellipsis, giảm cỡ nếu dài, KHÔNG tràn xuống
     ảnh) bên trái; grade lớn trong huy hiệu góc phải trên.
  3. Khung ảnh thẻ (bo góc trong, phản chiếu kính nhẹ ở mép).
  4. Dải chỉ số: ATK · DEF · AURA = 3 CỘT ĐỀU NHAU, canh giữa, mỗi cột số-trên
     nhãn-dưới, có khoảng thở. (Toàn chữ tiếng Anh.)
  5. POWER: một DẢI RIÊNG bên dưới, nổi bật hơn (nó là tổng) — không nằm chung
     hàng với 3 chỉ số kia.
  6. Nút/nhãn Passport: TÁCH HẲN khỏi hàng chỉ số — là dải bấm ở đáy thẻ (xem
     "CTA" bên dưới). KHÔNG đặt xen giữa các chỉ số.
- Xử lý ảnh: nếu là ảnh thẻ trần → bọc khung slab số; nếu đã là ảnh slab thật →
  đặt thẳng vào tủ, KHÔNG bọc hai lần. Luôn lazy-load + cache.
- Hiệu ứng kính: highlight chéo mờ (specular) trên mặt hộp; bóng đổ mềm phía dưới
  để slab "nổi". Glow = box-shadow màu tier, cường độ theo tier.
- Trạng thái: hover → nhấc nhẹ + glow đậm hơn; chọn vào deck → viền tier đặc +
  dấu check; thua/loại → khử màu (grayscale ~70%) + mờ.

## CTA — cho người dùng biết THẺ BẤM ĐƯỢC (nhiều lớp)
Một tính năng người dùng không biết là nó tồn tại = coi như không có. Xếp nhiều
tầng tín hiệu (tất cả chữ TIẾNG ANH):
- Lớp nền: cả thẻ `cursor: pointer`; hover → nhấc + sáng viền tier (affordance
  mạnh nhất).
- CTA chính: overlay trồi từ đáy ảnh khi hover, ghi "View Passport →". Ẩn lúc
  thường để thẻ gọn.
- Cho mobile/lướt nhanh (không có hover): một icon ⓘ (info) LUÔN HIỆN ở góc thẻ.
- Onboarding: sau gói đầu tiên, hiện HINT 1 LẦN "Tap any card to view its real
  Card Passport", tự ẩn sau khi user bấm lần đầu.
- Dùng từ "Passport" nhất quán ở nút thẻ, tiêu đề drawer, CTA — bấm chỗ nào có
  chữ "Passport" cũng mở đúng drawer đó. Tránh "Click here" (thừa, không hợp mobile).
- Màn KẾT QUẢ MỞ GÓI: dưới tiêu đề thêm dòng phụ mờ "Tap any card to view its
  real Card Passport"; và có NÚT THOÁT rõ ("Add to collection →" / "Continue")
  TÁCH khỏi CTA Passport, để user không nhầm hành động chính (nhận thẻ về roster).

## Animation & juice (chỗ ăn điểm — CSS transform/transition hoặc Framer Motion, KHÔNG cần 3D engine)
- Mở gói (HERO MOMENT — đầu tư nhất): gói rung nhẹ → "nứt" phát sáng → thẻ trồi
  lên, ánh sáng theo tier của lá hiếm nhất; reveal tuần tự, lá tier cao có hạt
  sáng + khựng nhịp (anticipation) tạo hồi hộp.
- Lật bài vào trận: 3D flip (rotateY) có trọng lượng.
- Khi so chỉ số: thuộc tính đang đấu "sáng quét" trên cả hai lá; type-advantage
  hiện mũi tên/icon khắc chế.
- Thắng vòng: lá nảy + toé hạt sáng màu tier; thua: xám đi + rung ngang.
- Khoá deck: các slab bay vào 5 slot với độ trễ so le (stagger) — cảm giác "đội
  hình thành hình".
- Tôn trọng `prefers-reduced-motion`: giảm/tắt animation mạnh.

## Typography
- Tên thẻ / nhãn: sans hiện đại, letter-spacing nhẹ.
- Số (grade, chỉ số, power): đậm, `tabular-nums` để thẳng cột.
- Cert / tokenId / metadata kỹ thuật: mono, cỡ nhỏ, màu mờ.
- Card Passport drawer chuyển sang tông SẠCH hơn (nền sáng hơn panel, ít glow) để
  tín hiệu "đây là dữ liệu thật, nghiêm túc" — tương phản có chủ đích với game.

## Bốn màn
1. Chọn chế độ / mở gói — không khí "phòng chờ vault", gói phát sáng chờ mở.
2. Roster & lắp deck — kệ slab dạng lưới, 5 slot deck, đồng hồ "team power" cập
   nhật realtime khi thêm/bớt.
3. Đấu — hai deck đối mặt trên "bàn kính", lật từng lượt, log bên cạnh, thanh
   máu/điểm ở đỉnh.
4. Card Passport (drawer trượt) — tông sạch, dữ liệu thật + nút "làm sao sở hữu
   thật".

## Ranh giới (đừng vi phạm)
- Chỉ số game HƯ CẤU: đừng để cách trình bày số trông giống bảng định giá tài sản.
- Khung cảm xúc là "dream / khao khát", không tuyên bố người chơi sở hữu thẻ.
- Không lạm dụng glow tới mức chói/rối; glow phục vụ phân cấp tier, không trang
  trí khắp nơi.

## Giữ đồng bộ
Khi tinh chỉnh palette/animation trong lúc build, cập nhật thẳng vào file này để
các phiên sau không trôi về mặc định.
