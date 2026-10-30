import { z } from 'zod';

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
});

const serverObject = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  INACTIVITY_MINUTES: z.coerce.number().int().min(5).max(240).default(30),
  LOGIN_MAX_ATTEMPTS_PER_IP: z.coerce.number().int().min(1).max(1000).default(20),
  PHONE_HASH_SECRET: z.string().min(32),
  DEDUPE_HOURS: z.coerce.number().int().min(1).max(720).default(24),
  ENTRY_MAX_PER_OFFICER_HOUR: z.coerce.number().int().min(1).max(1000).default(60),
  ENTRY_MAX_PER_OFFICER_DAY: z.coerce.number().int().min(1).max(5000).default(300),
  ENTRY_MAX_PER_IP_HOUR: z.coerce.number().int().min(1).max(5000).default(200),
  ALLOW_GALLERY_FALLBACK: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  RETENTION_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  /** Public https address of this app; certificate links in WhatsApp messages start with it. */
  APP_BASE_URL: z.url(),
  DELIVERY_MODE: z.enum(['bridge', 'cloud_api']).default('bridge'),
  CAMPAIGN_PAUSED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  DELIVERY_RETRY_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
  CRON_SECRET: z.string().min(32).optional(),
  /** Signs the cookie a team's phone gets from its link. Required in production. */
  COOKIE_SECRET: z.string().min(32).optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().min(5).optional(),
  WHATSAPP_TOKEN: z.string().min(10).optional(),
  WHATSAPP_APP_SECRET: z.string().min(10).optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().min(10).optional(),
  WHATSAPP_TEMPLATE_NAME: z
    .string()
    .regex(/^[a-z0-9_]{1,512}$/)
    .optional(),
  WHATSAPP_TEMPLATE_LANGUAGE: z
    .string()
    .regex(/^[a-z]{2}(_[A-Z]{2})?$/)
    .default('en'),
  WHATSAPP_TEMPLATE_CATEGORY: z.enum(['UTILITY', 'MARKETING']).default('UTILITY'),
  WHATSAPP_API_VERSION: z
    .string()
    .regex(/^v\d+\.\d+$/)
    .default('v21.0'),
  /** Only tests change this. */
  WHATSAPP_API_BASE: z.url().default('https://graph.facebook.com'),
  /** osm: free OpenStreetMap place names (no key). google: needs GOOGLE_MAPS_API_KEY. none: the officer types the place. */
  GEOCODER: z.enum(['none', 'google', 'osm']).default('osm'),
  GOOGLE_MAPS_API_KEY: z.string().optional(),
});

/** Referenced literally so Next can inline them into the browser bundle. */
export function publicEnv() {
  return publicSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
}

/**
 * Cloud API mode needs the WhatsApp settings; bridge mode does not. A production server always needs
 * CRON_SECRET: without it the scheduler cannot call the retention job, and personal data would not be deleted.
 */
const serverSchema = serverObject.superRefine((v, ctx) => {
  if (process.env.NODE_ENV === 'production' && !v.COOKIE_SECRET)
    ctx.addIssue({
      code: 'custom',
      path: ['COOKIE_SECRET'],
      message: 'required in production (it signs the cookie a team phone gets from its link)',
    });
  if (process.env.NODE_ENV === 'production' && !v.CRON_SECRET)
    ctx.addIssue({
      code: 'custom',
      path: ['CRON_SECRET'],
      message: 'required in production (the retention job needs it)',
    });
  if (v.DELIVERY_MODE !== 'cloud_api') return;
  for (const key of [
    'WHATSAPP_PHONE_NUMBER_ID',
    'WHATSAPP_TOKEN',
    'WHATSAPP_APP_SECRET',
    'WHATSAPP_VERIFY_TOKEN',
    'WHATSAPP_TEMPLATE_NAME',
    'CRON_SECRET',
  ] as const) {
    if (!v[key])
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message: 'required when DELIVERY_MODE=cloud_api',
      });
  }
});

export function serverEnv() {
  return serverSchema.parse(process.env);
}
