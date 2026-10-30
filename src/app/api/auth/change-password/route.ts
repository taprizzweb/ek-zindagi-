import { supabaseAuditSink } from '@/lib/audit/audit-supabase';
import { requireApiUser } from '@/lib/auth/session';
import { homePathFor } from '@/lib/domain/roles';
import { AppError } from '@/lib/errors';
import { handle, json, readJson } from '@/lib/http';
import { assertSameOrigin } from '@/lib/security/origin';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { changePasswordSchema } from '@/lib/validation/auth';

export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request.headers);
    const user = await requireApiUser({ allowMustChange: true });
    const { newPassword } = changePasswordSchema.parse(await readJson(request));

    const { error } = await (await createClient()).auth.updateUser({ password: newPassword });
    if (error) throw new AppError('bad_request', 400);

    const admin = createAdminClient();
    const { error: flagError } = await admin
      .from('profiles')
      .update({ must_change_password: false })
      .eq('id', user.id);
    if (flagError) throw new AppError('internal', 500);
    await supabaseAuditSink(admin).record({
      action: 'password_changed',
      actorId: user.id,
      actorCode: user.officerCode,
    });
    return json({ redirect: homePathFor(user.role) });
  });
}
