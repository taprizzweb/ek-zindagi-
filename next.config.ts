import type { NextConfig } from 'next';

const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  // Camera and location are needed by the officer form (milestone 2); nothing else is.
  {
    key: 'Permissions-Policy',
    value: 'camera=(self), geolocation=(self), microphone=(), payment=()',
  },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  // Nothing here is for search engines or archives.
  { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
];

const CERTIFICATE_FILES = [
  './public/fonts/**/*',
  './src/components/certificate/certificate.css',
  './assets/branding/jaipur-police.png',
  './node_modules/@sparticuz/chromium/bin/**/*',
  './node_modules/react/**/*',
  './node_modules/react-dom/**/*',
  './node_modules/scheduler/**/*',
];

const config: NextConfig = {
  poweredByHeader: false,
  // Native / binary packages stay outside the bundle; the files the certificate route reads at
  // run time (fonts, the serverless Chromium build) are included explicitly.
  serverExternalPackages: ['@sparticuz/chromium', 'puppeteer-core', 'sharp'],
  outputFileTracingIncludes: {
    // Rendering a certificate reads fonts and CSS from disk, loads react-dom through Node's resolver and
    // starts the serverless Chromium build.
    '/api/entries/[id]/certificate': CERTIFICATE_FILES,
    '/api/entries/[id]/certificate/image': CERTIFICATE_FILES,
    '/api/entries/[id]/certificate/pdf': CERTIFICATE_FILES,
  },
  reactStrictMode: true,
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      // Pages and API answers can hold officer-only data: never cached by the browser or a proxy.
      // (Static assets keep their long-lived caching.)
      {
        source: '/((?!_next/static|_next/image|fonts/).*)',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
    ];
  },
};

export default config;
