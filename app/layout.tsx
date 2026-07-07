import type { Metadata } from 'next';
import './globals.css';

// Dùng system font stack (định nghĩa trong globals.css) — không phụ thuộc font
// mạng, khớp art-direction (typography thanh, tabular-nums cho số).

export const metadata: Metadata = {
  title: 'Renaiss Arena — Gacha-as-Draft Card Battler',
  description:
    'Card-battler mô phỏng cho hệ sinh thái Renaiss: mở gói (odds tham chiếu) → lắp deck → đấu có skill → soi Card Passport thật. Kinh tế ẢO, chỉ số HƯ CẤU, read-only.',
};

export const viewport = { themeColor: '#0b0e14' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
