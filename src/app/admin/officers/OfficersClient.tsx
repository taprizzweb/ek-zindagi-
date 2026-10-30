'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button, ErrorBox, Label, TextField } from '@/components/ui';
import { messageFor, type Bilingual } from '@/lib/i18n/messages';

export interface OfficerRow {
  id: string;
  email: string;
  displayName: string;
  role: 'officer' | 'supervisor';
  officerCode: string;
  active: boolean;
  createdAt: string;
}

interface Credentials {
  who: string;
  email?: string;
  tempPassword: string;
}

async function call(url: string, method: string, body: unknown) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as Record<string, unknown> & { error?: { code: string } };
  return { ok: res.ok, data };
}

export default function OfficersClient({ officers }: { officers: OfficerRow[] }) {
  const router = useRouter();
  const [error, setError] = useState<Bilingual | null>(null);
  const [busy, setBusy] = useState(false);
  const [creds, setCreds] = useState<Credentials | null>(null);
  const [confirming, setConfirming] = useState<{
    id: string;
    action: 'disable' | 'reset_password';
  } | null>(null);

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const f = new FormData(formEl);
    setBusy(true);
    setError(null);
    try {
      const { ok, data } = await call('/api/admin/officers', 'POST', {
        email: f.get('email'),
        displayName: f.get('displayName'),
        role: f.get('role'),
      });
      if (!ok) {
        setError(messageFor(data.error?.code));
      } else {
        setCreds({
          who: `${String(data.officerCode)}`,
          email: String(data.email),
          tempPassword: String(data.tempPassword),
        });
        formEl.reset();
        router.refresh();
      }
    } catch {
      setError(messageFor('internal'));
    }
    setBusy(false);
  }

  async function act(o: OfficerRow, action: 'disable' | 'enable' | 'reset_password') {
    setBusy(true);
    setError(null);
    setConfirming(null);
    try {
      const { ok, data } = await call(`/api/admin/officers/${o.id}`, 'PATCH', { action });
      if (!ok) setError(messageFor(data.error?.code));
      else {
        if (action === 'reset_password')
          setCreds({ who: o.officerCode, email: o.email, tempPassword: String(data.tempPassword) });
        router.refresh();
      }
    } catch {
      setError(messageFor('internal'));
    }
    setBusy(false);
  }

  return (
    <div className="space-y-8">
      {creds ? (
        <section aria-live="polite" className="rounded border-2 border-accent p-4">
          <h2 className="text-lg font-semibold">अस्थायी पासवर्ड / Temporary password</h2>
          <p className="text-sm text-muted">
            यह सिर्फ़ अभी दिखेगा। इसे सुरक्षित तरीके से अधिकारी को दें। पहले लॉगिन पर बदलना होगा। /
            Shown once. Pass it on securely; it must be changed at first login.
          </p>
          <p className="mt-2">
            {creds.who}
            {creds.email ? ` · ${creds.email}` : ''}
          </p>
          <p className="my-2 select-all rounded bg-gray-100 p-3 font-mono text-xl tracking-wider">
            {creds.tempPassword}
          </p>
          <Button variant="secondary" onClick={() => setCreds(null)}>
            हो गया / Done
          </Button>
        </section>
      ) : null}

      <section>
        <h2 className="mb-3 text-lg font-semibold">नया खाता / New account</h2>
        <form onSubmit={create} className="max-w-xl space-y-4" noValidate>
          <TextField id="displayName" hi="नाम" en="Name" autoComplete="off" required />
          <TextField
            id="email"
            hi="ईमेल"
            en="Email"
            type="email"
            inputMode="email"
            autoComplete="off"
            required
          />
          <div>
            <Label htmlFor="role" hi="भूमिका" en="Role" />
            <select
              id="role"
              name="role"
              className="h-12 w-full rounded border-2 border-line bg-white px-3 text-base"
              defaultValue="officer"
            >
              <option value="officer">अधिकारी / Officer</option>
              <option value="supervisor">पर्यवेक्षक / Supervisor</option>
            </select>
          </div>
          <ErrorBox message={error} />
          <Button type="submit" disabled={busy}>
            खाता बनाएँ / Create account
          </Button>
        </form>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">सभी खाते / All accounts</h2>
        {officers.length === 0 ? (
          <p className="text-muted">अभी कोई खाता नहीं। / No accounts yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] border-collapse text-left">
              <thead>
                <tr className="border-b-2 border-line">
                  <th className="p-2">कोड / Code</th>
                  <th className="p-2">नाम / Name</th>
                  <th className="p-2">भूमिका / Role</th>
                  <th className="p-2">स्थिति / Status</th>
                  <th className="p-2">कार्य / Actions</th>
                </tr>
              </thead>
              <tbody>
                {officers.map((o) => (
                  <tr key={o.id} className="border-b border-line align-top">
                    <td className="p-2 font-semibold">{o.officerCode}</td>
                    <td className="p-2">
                      {o.displayName}
                      <br />
                      <span className="text-sm text-muted">{o.email}</span>
                    </td>
                    <td className="p-2">
                      {o.role === 'officer' ? 'अधिकारी / Officer' : 'पर्यवेक्षक / Supervisor'}
                    </td>
                    <td className="p-2">{o.active ? 'चालू / Active' : 'बंद / Disabled'}</td>
                    <td className="p-2">
                      {confirming?.id === o.id ? (
                        <div className="space-y-2">
                          <p>
                            {confirming.action === 'disable'
                              ? `${o.officerCode} (${o.displayName}) को बंद करें? / Disable ${o.officerCode}?`
                              : `${o.officerCode} का पासवर्ड रीसेट करें? / Reset password for ${o.officerCode}?`}
                          </p>
                          <div className="flex gap-2">
                            <Button
                              variant={confirming.action === 'disable' ? 'danger' : 'primary'}
                              disabled={busy}
                              onClick={() => act(o, confirming.action)}
                            >
                              {confirming.action === 'disable'
                                ? `बंद करें / Disable ${o.officerCode}`
                                : 'रीसेट / Reset'}
                            </Button>
                            <Button variant="secondary" onClick={() => setConfirming(null)}>
                              रद्द / Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {o.active ? (
                            <Button
                              variant="secondary"
                              disabled={busy}
                              onClick={() => setConfirming({ id: o.id, action: 'disable' })}
                            >
                              बंद करें / Disable
                            </Button>
                          ) : (
                            <Button
                              variant="secondary"
                              disabled={busy}
                              onClick={() => act(o, 'enable')}
                            >
                              चालू करें / Enable
                            </Button>
                          )}
                          <Button
                            variant="secondary"
                            disabled={busy}
                            onClick={() => setConfirming({ id: o.id, action: 'reset_password' })}
                          >
                            पासवर्ड रीसेट / Reset password
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
