import { supabaseAuditSink } from '@/lib/audit/audit-supabase';
import { requireApiUser } from '@/lib/auth/session';
import { supabaseCertificatePorts } from '@/lib/certificates/certificate-store-supabase';
import { generateCertificate } from '@/lib/certificates/generate';
import { AppError } from '@/lib/errors';
import { handle, json } from '@/lib/http';
import { brandingFromEnv } from '@/lib/pdf/branding';
import { createCertificatePdf } from '@/lib/pdf/certificate';
import { assertSameOrigin } from '@/lib/security/origin';
import { createAdminClient } from '@/lib/supabase/admin';
import { uuidSchema } from '@/lib/validation/officer';

// Rendering needs Chromium: Node runtime, and room for a cold start.
export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    assertSameOrigin(request.headers);
    const actor = await requireApiUser({ roles: ['officer', 'supervisor'] });
    const id = uuidSchema.safeParse((await ctx.params).id);
    if (!id.success) throw new AppError('not_found', 404);

    const admin = createAdminClient();
    const result = await generateCertificate(
      {
        ports: supabaseCertificatePorts(admin),
        audit: supabaseAuditSink(admin),
        render: createCertificatePdf,
        branding: brandingFromEnv(),
        now: () => Date.now(),
      },
      id.data,
      actor,
      actor.id, // only the officer who made the entry can trigger it
    );
    return json({ status: result.status });
  });
}
