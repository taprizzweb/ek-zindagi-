import { chromium } from 'playwright';

export const FAKE_SUPABASE_PORT = 54399;
export const APP_PORT = 3199;
export const APP_URL = `http://127.0.0.1:${APP_PORT}`;

/** Environment for building and running the app against the fake Supabase. */
export const appEnv = {
  NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${FAKE_SUPABASE_PORT}`,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'e2e-anon-key-000000000000',
  SUPABASE_SERVICE_ROLE_KEY: 'e2e-service-key-00000000000',
  PHONE_HASH_SECRET: 'e2e-phone-hash-secret-0123456789abcdef',
  INACTIVITY_MINUTES: '30',
  ALLOW_GALLERY_FALLBACK: 'true',
  GEOCODER: 'none',
  APP_BASE_URL: `http://127.0.0.1:${APP_PORT}`,
  DELIVERY_MODE: 'bridge',
  MFA_SECRET: 'e2e-mfa-secret-0123456789-abcdefghijkl',
  CRON_SECRET: 'e2e-cron-secret-0123456789-abcdefghij',
  CHROMIUM_EXECUTABLE_PATH: process.env.CHROMIUM_EXECUTABLE_PATH ?? chromium.executablePath(),
};
