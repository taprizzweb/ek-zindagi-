import { randomUUID } from 'node:crypto';
import { supabaseAuditSink } from '@/lib/audit/audit-supabase';
import { requireApiUser } from '@/lib/auth/session';
import { generateCertCode } from '@/lib/domain/cert-code';
import { hashPhone } from '@/lib/domain/phone-hash';
import { serverEnv } from '@/lib/env';
import { createEntry } from '@/lib/entries/create-entry';
import { supabaseEntryPorts } from '@/lib/entries/entry-store-supabase';
import { AppError } from '@/lib/errors';
import { handle, json } from '@/lib/http';
import { MAX_UPLOAD_BYTES, processPhoto } from '@/lib/image/process-photo';
import { clientIp } from '@/lib/security/ip';
import { assertSameOrigin } from '@/lib/security/origin';
import { loadSettings } from '@/lib/settings/settings-store-supabase';
import { createAdminClient } from '@/lib/supabase/admin';
import { entryInputSchema } from '@/lib/validation/entry';

const MAX_BODY_BYTES = MAX_UPLOAD_BYTES + 20_000;

export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request.headers);
    const actor = await requireApiUser({ roles: ['officer', 'supervisor'] });
    if (Number(request.headers.get('content-length') ?? '0') > MAX_BODY_BYTES) {
      throw new AppError('bad_request', 413);
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new AppError('bad_request', 400);
    }
    const data = form.get('data');
    if (typeof data !== 'string' || data.length > 5_000) throw new AppError('bad_request', 400);
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(data);
    } catch {
      throw new AppError('bad_request', 400);
    }
    const input = entryInputSchema.parse(parsedJson);

    const file = form.get('photo');
    let photo: Buffer | null = null;
    if (file !== null) {
      if (typeof file === 'string' || file.size === 0 || file.size > MAX_UPLOAD_BYTES) {
        throw new AppError('bad_photo', 400);
      }
      photo = Buffer.from(await file.arrayBuffer());
    }

    const env = serverEnv();
    const admin = createAdminClient();
    const settings = await loadSettings(admin);
    const created = await createEntry(
      {
        ports: supabaseEntryPorts(admin),
        audit: supabaseAuditSink(admin),
        config: {
          allowGallery: settings.allowGallery,
          dedupeHours: env.DEDUPE_HOURS,
          retentionHours: settings.retentionHours,
          maxPerOfficerHour: env.ENTRY_MAX_PER_OFFICER_HOUR,
          maxPerOfficerDay: env.ENTRY_MAX_PER_OFFICER_DAY,
          maxPerIpHour: env.ENTRY_MAX_PER_IP_HOUR,
        },
        hashPhone: (e164) => hashPhone(e164, env.PHONE_HASH_SECRET),
        processPhoto,
        generateCode: () => generateCertCode(),
        newId: () => randomUUID(),
        now: () => new Date(),
      },
      actor,
      input,
      photo,
      clientIp(request.headers),
    );
    return json(
      {
        id: created.id,
        certCode: created.certCode,
        status: created.status,
        createdAt: created.createdAt,
      },
      created.replayed ? 200 : 201,
    );
  });
}
