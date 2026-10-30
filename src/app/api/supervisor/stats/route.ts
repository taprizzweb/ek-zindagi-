import { requireApiUser } from '@/lib/auth/session';
import { AppError } from '@/lib/errors';
import { handle } from '@/lib/http';
import { RANGES, rangeFor, statsToCsv, type Range } from '@/lib/reports/reports';
import { loadOfficerCodes, loadStats } from '@/lib/reports/reports-store-supabase';
import { createAdminClient } from '@/lib/supabase/admin';

/** Counts as a CSV file: per day, officer and violation. Never any personal data. `?range=today|week`. */
export async function GET(request: Request) {
  return handle(async () => {
    await requireApiUser({ roles: ['supervisor', 'admin'] });
    const range = (new URL(request.url).searchParams.get('range') ?? 'week') as Range;
    if (!RANGES.includes(range)) throw new AppError('bad_request', 400);
    const admin = createAdminClient();
    const { since, until } = rangeFor(range, new Date());
    const [rows, codes] = await Promise.all([
      loadStats(admin, since, until),
      loadOfficerCodes(admin),
    ]);
    return new Response(
      statsToCsv(rows, (id) => codes.get(id) ?? '—'),
      {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="ek-zindagi-counts-${range}.csv"`,
          'Cache-Control': 'no-store',
        },
      },
    );
  });
}
