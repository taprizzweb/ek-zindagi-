import { describe, expect, it } from 'vitest';
import { resolveSettings, settingChangeSchema } from '@/lib/settings/settings';

const env = { CAMPAIGN_PAUSED: false, ALLOW_GALLERY_FALLBACK: true, RETENTION_HOURS: 24 };

describe('resolveSettings', () => {
  it('uses the environment when nothing is stored', () => {
    expect(resolveSettings(env, [])).toEqual({
      campaignPaused: false,
      allowGallery: true,
      retentionHours: 24,
    });
  });
  it('a stored value overrides the environment', () => {
    const s = resolveSettings(env, [
      { key: 'campaign_paused', value: true },
      { key: 'allow_gallery_fallback', value: false },
      { key: 'retention_hours', value: 6 },
    ]);
    expect(s).toEqual({ campaignPaused: true, allowGallery: false, retentionHours: 6 });
  });
  it('the environment pause is a hard switch: a stored "not paused" cannot undo it', () => {
    expect(
      resolveSettings({ ...env, CAMPAIGN_PAUSED: true }, [{ key: 'campaign_paused', value: false }])
        .campaignPaused,
    ).toBe(true);
  });
  it('ignores values of the wrong type or out of range', () => {
    const s = resolveSettings(env, [
      { key: 'campaign_paused', value: 'yes' },
      { key: 'allow_gallery_fallback', value: 1 },
      { key: 'retention_hours', value: 500 },
    ]);
    expect(s).toEqual({ campaignPaused: false, allowGallery: true, retentionHours: 24 });
  });
  it('clamps the environment retention to 1..168', () => {
    expect(resolveSettings({ ...env, RETENTION_HOURS: 999 }, []).retentionHours).toBe(168);
    expect(resolveSettings({ ...env, RETENTION_HOURS: 0 }, []).retentionHours).toBe(1);
  });
});

describe('settingChangeSchema', () => {
  it('accepts valid changes', () => {
    for (const c of [
      { key: 'campaign_paused', value: true },
      { key: 'allow_gallery_fallback', value: false },
      { key: 'retention_hours', value: 168 },
    ])
      expect(settingChangeSchema.safeParse(c).success).toBe(true);
  });
  it('rejects unknown keys, wrong types, fractions and out-of-range hours', () => {
    for (const c of [
      { key: 'delivery_mode', value: 'cloud_api' },
      { key: 'campaign_paused', value: 'true' },
      { key: 'retention_hours', value: 0 },
      { key: 'retention_hours', value: 169 },
      { key: 'retention_hours', value: 1.5 },
      { key: 'campaign_paused', value: true, extra: 1 },
    ])
      expect(settingChangeSchema.safeParse(c).success, JSON.stringify(c)).toBe(false);
  });
});
