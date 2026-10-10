import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = { title: 'Studies DB | TP 4.0' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pl" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-[100dvh] font-sans antialiased">{children}</body>
    </html>
  );
}
