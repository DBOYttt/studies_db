import { GeistMono } from 'geist/font/mono';
import { GeistSans } from 'geist/font/sans';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ROOT_TITLE } from '@/lib/page-meta';
import './globals.css';

/** Every page sets its own title: `<Page> · Studies DB` (lib/page-meta.ts). */
export const metadata: Metadata = { title: ROOT_TITLE };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      // Browser extensions (e.g. crxemulator) add attributes to <html> before hydration.
      suppressHydrationWarning
    >
      <body
        className="min-h-[100dvh] font-sans antialiased"
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
