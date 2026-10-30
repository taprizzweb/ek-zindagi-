import { z } from 'zod';

/** Settings an admin can change from the app. Each has a default that comes from the environment. */
export interface Settings {
  campaignPaused: boolean;
  allowGallery: boolean;
  retentionHours: number;
}

export const SETTING_KEYS = [
  'campaign_paused',
  'allow_gallery_fallback',
  'retention_hours',
] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

export const MAX_RETENTION_HOURS = 168;

/** One change: the key decides which value is acceptable. */
export const settingChangeSchema = z.discriminatedUnion('key', [
  z.strictObject({ key: z.literal('campaign_paused'), value: z.boolean() }),
  z.strictObject({ key: z.literal('allow_gallery_fallback'), value: z.boolean() }),
  z.strictObject({
    key: z.literal('retention_hours'),
    value: z.number().int().min(1).max(MAX_RETENTION_HOURS),
  }),
]);
export type SettingChange = z.infer<typeof settingChangeSchema>;

export interface SettingRow {
  key: string;
  value: unknown;
}

export interface EnvDefaults {
  CAMPAIGN_PAUSED: boolean;
  ALLOW_GALLERY_FALLBACK: boolean;
  RETENTION_HOURS: number;
}

/**
 * The effective settings. A stored value wins over the environment, with one exception: the
 * environment's CAMPAIGN_PAUSED=true is a hard switch that no stored setting can turn off.
 * Values of the wrong type are ignored (the database refuses them, this is a second line).
 */
export function resolveSettings(env: EnvDefaults, rows: readonly SettingRow[]): Settings {
  const get = (key: SettingKey) => rows.find((r) => r.key === key)?.value;
  const paused = get('campaign_paused');
  const gallery = get('allow_gallery_fallback');
  const hours = get('retention_hours');
  return {
    campaignPaused: env.CAMPAIGN_PAUSED || paused === true,
    allowGallery: typeof gallery === 'boolean' ? gallery : env.ALLOW_GALLERY_FALLBACK,
    retentionHours:
      typeof hours === 'number' &&
      Number.isInteger(hours) &&
      hours >= 1 &&
      hours <= MAX_RETENTION_HOURS
        ? hours
        : Math.min(Math.max(env.RETENTION_HOURS, 1), MAX_RETENTION_HOURS),
  };
}

export interface SettingsStore {
  load(): Promise<SettingRow[]>;
  save(change: SettingChange, actorId: string): Promise<void>;
}
