import { z } from 'zod';

// System prompt lớp AI Card Passport — NẠP NGUYÊN KHỐI từ prompts/passport-narration.md.
// (Giữ đồng bộ với file đó; mọi ràng buộc là bắt buộc.)
export const PASSPORT_SYSTEM_PROMPT = `Bạn là "Card Passport", trợ lý minh bạch cho người sưu tầm trên nền tảng Renaiss
(đồ sưu tầm RWA — thẻ giám định — trên BNB Chain). Nhiệm vụ: đọc dữ liệu thật của
MỘT lá thẻ và giải thích cho một collector bình thường hiểu: lá này là gì, lịch
sử on-chain ra sao, được lưu ký thế nào, và giá tham chiếu đáng tin tới đâu.

NGUYÊN TẮC BẤT BIẾN (không bao giờ vi phạm):
1. CHỈ dùng dữ liệu được cung cấp trong message. TUYỆT ĐỐI không bịa số, không
   suy ra dữ liệu không có. Nếu một trường là null/thiếu, nói thẳng "không có dữ
   liệu cho mục này".
2. MỖI phát biểu có số liệu phải kèm NGUỒN và THỜI ĐIỂM. Giá reference luôn ghi
   "theo Renaiss OS Index, tính đến <asOf>". Dữ liệu on-chain ghi kèm txHash/thời
   gian khi phù hợp.
3. TÔN TRỌNG độ tin cậy. Nếu confidence là "low" hoặc observationCount rất nhỏ,
   KHÔNG trình bày con số như sự thật chắc chắn — nói rõ nó mỏng/thử nghiệm và
   khuyên thận trọng. Nếu các method (median/mean/vwap) lệch nhau nhiều, nêu ra
   như dấu hiệu giá biến động/thanh khoản mỏng.
4. KHÔNG BAO GIỜ khẳng định "hàng giả", "gian lận", "wash-trade" như kết luận.
   Chỉ được nêu "tín hiệu đáng lưu ý cần kiểm tra thêm" kèm bằng chứng cụ thể
   (VD txHash, mốc thời gian) và mức độ chắc chắn. Người đọc tự đánh giá.
5. KHÔNG đưa lời khuyên đầu tư/tài chính, không dự đoán giá tương lai, không hối
   thúc mua/bán. Được mô tả dữ kiện quá khứ đã có.
6. Đây là dữ liệu BETA, có thể thiếu/trễ/đang cập nhật. Kết thúc bằng một câu
   nhắc ngắn rằng đây là tham chiếu thử nghiệm, không phải sự thật thị trường đã
   xác minh.

GIỌNG VĂN: rõ ràng, thân thiện, đúng trọng tâm, như một người bạn sành sỏi giải
thích cho người mới. Không sáo rỗng, không cường điệu, không marketing.

ĐỊNH DẠNG ĐẦU RA (ngắn gọn, prose là chính):
- Tóm tắt 1–2 câu: lá thẻ này là gì.
- Provenance: kể vắn tắt hành trình on-chain (sinh ra → qua tay → giao dịch gần
  nhất), kèm mốc/txHash. Nếu có tín hiệu đáng lưu ý, nêu như "điểm cần kiểm tra".
- Lưu ký: giữ ở đâu (provider/quốc gia/loại vault) và điều đó nghĩa là gì với
  người mua.
- Giá tham chiếu: khoảng giá + độ tin cậy + nguồn + thời điểm; nêu nếu dữ liệu
  mỏng hoặc các phương pháp lệch nhau.
- Một câu caveat cuối (beta, tham chiếu thử nghiệm, không phải lời khuyên).
Nếu dữ liệu quá thiếu để nói điều gì có ý nghĩa, nói thẳng như vậy thay vì lấp
đầy bằng suy đoán.`;

// Input contract (khớp prompts/passport-narration.md) — Zod validate ở route.
export const PassportInputSchema = z.object({
  card: z.object({
    name: z.string(),
    setName: z.string().nullable(),
    grade: z.string().nullable(),
    gradingCompany: z.string().nullable(),
    year: z.number().nullable(),
    tokenId: z.string(),
  }),
  custody: z.object({
    vaultLocation: z.string().nullable(),
    countryCode: z.string().nullable(),
  }),
  onchain: z.object({
    activities: z.array(
      z.object({
        type: z.string(),
        timestamp: z.string().nullable(),
        txHash: z.string().nullable(),
        amount: z.union([z.string(), z.number()]).nullable(),
      }),
    ),
    lastSale: z.union([z.string(), z.number()]).nullable(),
  }),
  reference: z.object({
    source: z.string(),
    priceUsd: z.number().nullable(),
    confidence: z.string().nullable(),
    observationCount: z.number().nullable(),
    lastSaleAt: z.string().nullable(),
    deltas: z.object({ d7: z.number().nullable(), d30: z.number().nullable(), d365: z.number().nullable() }).nullable(),
    sourceBreakdown: z.array(z.object({ bucket: z.string().nullable(), medianUsd: z.number().nullable() })),
  }).nullable(),
  asOf: z.string(),
});
export type PassportInput = z.infer<typeof PassportInputSchema>;

// Fallback deterministic (khi chưa cấu hình LLM key) — vẫn tôn trọng mọi ràng buộc:
// chỉ dùng dữ liệu có, kèm nguồn + thời điểm, không khẳng định gian lận, có caveat.
export function fallbackNarration(input: PassportInput): string {
  const { card, custody, onchain, reference, asOf } = input;
  const asOfShort = asOf.slice(0, 10);
  const lines: string[] = [];

  const gradeStr = [card.gradingCompany, card.grade].filter(Boolean).join(' ');
  lines.push(
    `**${card.name}**${card.setName ? ` — thuộc set ${card.setName}` : ''}${gradeStr ? `, giám định ${gradeStr}` : ''}${card.year ? `, phát hành ${card.year}` : ''}.`,
  );

  // Provenance
  const acts = onchain.activities ?? [];
  if (acts.length > 0) {
    const last = acts[0];
    const when = last.timestamp ? new Date(Number(last.timestamp) * 1000).toISOString().slice(0, 10) : 'không rõ thời điểm';
    lines.push(
      `**Provenance:** ghi nhận ${acts.length} hoạt động on-chain; gần nhất là "${last.type}" (${when}${last.txHash ? `, tx ${last.txHash.slice(0, 10)}…` : ''}). Đây là dữ kiện quá khứ, không suy diễn thêm.`,
    );
  } else {
    lines.push('**Provenance:** không có dữ liệu hoạt động on-chain cho mục này.');
  }

  // Custody
  if (custody.vaultLocation || custody.countryCode) {
    lines.push(
      `**Lưu ký:** ${custody.vaultLocation ? `loại vault "${custody.vaultLocation}"` : 'loại vault không rõ'}${custody.countryCode ? `, đặt tại ${custody.countryCode}` : ''}. Thẻ vật lý được giữ hộ; quyền on-chain đại diện cho vật phẩm trong kho.`,
    );
  } else {
    lines.push('**Lưu ký:** không có dữ liệu custody cho mục này.');
  }

  // Reference price
  if (reference && reference.priceUsd != null) {
    const conf = reference.confidence ?? 'không rõ';
    const thin = reference.observationCount != null && reference.observationCount < 10;
    lines.push(
      `**Giá tham chiếu:** ~$${reference.priceUsd.toLocaleString('en-US')} theo ${reference.source}, độ tin cậy ${conf}${reference.observationCount != null ? `, dựa trên ${reference.observationCount} quan sát` : ''} (tính đến ${asOfShort}).` +
        (thin ? ' Số quan sát khá mỏng → xem như thử nghiệm, nên thận trọng.' : ''),
    );
  } else {
    lines.push('**Giá tham chiếu:** không có dữ liệu giá từ Renaiss OS Index cho lá này (hoặc chưa khớp được).');
  }

  lines.push(
    '_Đây là dữ liệu beta — tham chiếu thử nghiệm, không phải sự thật thị trường đã xác minh, và không phải lời khuyên đầu tư._',
  );
  return lines.join('\n\n');
}
