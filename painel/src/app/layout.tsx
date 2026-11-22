import type { Metadata } from 'next';
import { PRODUCT_NAME } from '@/config';
import './globals.css';

export const metadata: Metadata = {
  title: `${PRODUCT_NAME} — Painel de métricas`,
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
