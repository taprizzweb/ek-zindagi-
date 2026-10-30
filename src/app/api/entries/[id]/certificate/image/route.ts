import { supabaseAuditSink } from '@/lib/audit/audit-supabase';
import { requireApiUser } from '@/lib/auth/session';
import { supabaseDownloadPorts } from '@/lib/certificates/certificate-store-supabase';
import { downloadCertificate } from '@/lib/certificates/download';
import { AppError } from '@/lib/errors';
import { handle } from '@/lib/http';
import { brandingFromEnv } from '@/lib/pdf/branding';
import { createCertificatePng } from '@/lib/pdf/certificate';
import { createAdminClient } from '@/lib/supabase/admin';
import { uuidSchema } from '@/lib/validation/officer';

export const runtime = 'nodejs';
export const maxDuration = 30;

/** Download for the officer who made the entry. */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = await requireApiUser({ roles: ['officer', 'supervisor'] });
    const id = uuidSchema.safeParse((await ctx.params).id);
    if (!id.success) throw new AppError('not_found', 404);
    const admin = createAdminClient();
    const file = await downloadCertificate(
      {
        ports: supabaseDownloadPorts(admin),
        audit: supabaseAuditSink(admin),
        renderPng: createCertificatePng,
        branding: brandingFromEnv(),
      },
      id.data,
      'image',
      actor,
    );
    return new Response(new Uint8Array(file.bytes), {
      headers: {
        'Content-Type': file.contentType,
        'Content-Disposition': `attachment; filename="${file.filename}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  });
}
