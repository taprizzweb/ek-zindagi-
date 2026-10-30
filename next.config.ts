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
];

const config: NextConfig = {
  poweredByHeader: false,
  // Native / binary packages stay outside the bundle; the files the certificate route reads at
  // run time (fonts, the serverless Chromium build) are included explicitly.
  serverExternalPackages: ['@sparticuz/chromium', 'puppeteer-core', 'sharp'],
  outputFileTracingIncludes: {
    '/api/entries/[id]/certificate': [
      './assets/**/*',
      './node_modules/@sparticuz/chromium/bin/**/*',
    ],
  },
  reactStrictMode: true,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default config;
