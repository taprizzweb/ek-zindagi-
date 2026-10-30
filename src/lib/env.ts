import { z } from 'zod';

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
});

const serverSchema = z.object({
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
  MESSAGE_LANGUAGE: z.enum(['hinglish', 'hindi', 'english']).default('hinglish'),
  GEOCODER: z.enum(['none', 'google']).default('none'),
  GOOGLE_MAPS_API_KEY: z.string().optional(),
});

/** Referenced literally so Next can inline them into the browser bundle. */
export function publicEnv() {
  return publicSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
}

export function serverEnv() {
  return serverSchema.parse(process.env);
}
