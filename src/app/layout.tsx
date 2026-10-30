import type { Metadata, Viewport } from 'next';
import '@fontsource/noto-sans/400.css';
import '@fontsource/noto-sans/600.css';
import '@fontsource/noto-sans-devanagari/400.css';
import '@fontsource/noto-sans-devanagari/600.css';
import './globals.css';

// Every page is rendered per request so the CSP nonce set in proxy.ts reaches its scripts.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'EK ZINDAGI',
  description: 'Road safety awareness campaign: officer portal',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#ffffff' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans">{children}</body>
    </html>
  );
}
