import { redirect } from 'next/navigation';
import QRCode from 'qrcode';
import { supabaseAuditSink } from '@/lib/audit/audit-supabase';
import { beginEnrollment } from '@/lib/auth/mfa';
import { supabaseMfaPorts } from '@/lib/auth/mfa-store-supabase';
import { requirePageUser } from '@/lib/auth/session';
import { homePathFor } from '@/lib/domain/roles';
import { serverEnv } from '@/lib/env';
import { createAdminClient } from '@/lib/supabase/admin';
import MfaForm from './MfaForm';

export default async function MfaPage() {
  const user = await requirePageUser({ allowMfaPending: true });
  const master = serverEnv().MFA_SECRET;
  if (!user.mfaRequired || user.mfaVerified || !master) redirect(homePathFor(user.role));

  const admin = createAdminClient();
  const { data } = await admin.from('profiles').select('email').eq('id', user.id).maybeSingle();
  const email = (data as { email: string } | null)?.email ?? user.displayName;
  const enrol = await beginEnrollment(
    {
      ports: supabaseMfaPorts(admin),
      audit: supabaseAuditSink(admin),
      masterKey: master,
      now: Date.now,
    },
    { id: user.id, email, officerCode: user.officerCode },
  );
  // The QR is a picture (a data: image), so no script or style is needed.
  const qr = enrol ? await QRCode.toDataURL(enrol.uri, { margin: 1, width: 220 }) : null;

  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <h1 className="text-2xl font-semibold">सुरक्षा कोड / Security code</h1>
      <p className="mb-4 text-muted">
        {user.displayName}, आगे बढ़ने के लिए अपने ऑथेंटिकेटर ऐप का 6 अंकों का कोड डालें। / Enter the
        6-digit code from your authenticator app to continue.
      </p>
      {enrol && qr ? (
        <section
          aria-labelledby="setup-h"
          className="mb-6 space-y-3 rounded border-2 border-line p-4"
        >
          <h2 id="setup-h" className="text-lg font-semibold">
            पहली बार: ऐप जोड़ें / First time: set up the app
          </h2>
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              फ़ोन पर Google Authenticator, Microsoft Authenticator या कोई ऑथेंटिकेटर ऐप खोलें। /
              Open an authenticator app (Google Authenticator, Microsoft Authenticator or similar).
            </li>
            <li>
              यह QR स्कैन करें, या नीचे की कुंजी हाथ से डालें। / Scan this QR code, or type the key
              below.
            </li>
            <li>
              ऐप में दिखा 6 अंकों का कोड नीचे डालें। / Type the 6-digit code the app shows, below.
            </li>
          </ol>
          {/* eslint-disable-next-line @next/next/no-img-element -- a data: image made on the server */}
          <img src={qr} alt="QR code" width={220} height={220} className="mx-auto" />
          <p className="text-center">
            <span className="text-sm text-muted">कुंजी / Key</span>
            <br />
            <code
              className="break-all text-lg font-semibold tracking-wider"
              data-testid="totp-secret"
            >
              {enrol.secret.match(/.{1,4}/g)?.join(' ')}
            </code>
          </p>
          <p className="text-sm text-muted">
            इस कुंजी को किसी को न बताएँ और कहीं लिखकर न रखें। फ़ोन खो जाए तो प्रशासक आपका सेट-अप
            रीसेट कर सकता है। / Tell nobody this key and do not write it down. If you lose the
            phone, the admin can reset your set-up.
          </p>
        </section>
      ) : null}
      <MfaForm />
    </main>
  );
}
