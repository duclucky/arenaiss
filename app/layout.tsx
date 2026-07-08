import type { Metadata } from 'next';
import './globals.css';

// System font stack lives in globals.css to keep the app independent from font CDNs.

export const metadata: Metadata = {
  title: 'Arenaiss — Gacha-as-Draft Card Battler',
  description:
    'Arenaiss is a simulated gacha-as-draft card battler: open packs with reference odds, build a deck, battle with skill, and inspect real Card Passports. Virtual economy, fictional stats, read-only data.',
};

export const viewport = { themeColor: '#0b0e14' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
