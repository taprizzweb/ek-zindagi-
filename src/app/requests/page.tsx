import Link from 'next/link';
import AppShell from '@/components/AppShell';
import { requirePageUser } from '@/lib/auth/session';
import { homePathFor } from '@/lib/domain/roles';
import { OptOutForm, PurgeForm } from './RequestForms';

export default async function RequestsPage() {
  const user = await requirePageUser({ roles: ['supervisor', 'admin'] });
  return (
    <AppShell user={user}>
      <p className="mb-4">
        <Link
          href={homePathFor(user.role)}
          className="inline-flex min-h-11 items-center text-accent underline"
        >
          ← वापस / Back
        </Link>
      </p>
      <h1 className="mb-2 text-2xl font-semibold">नागरिक के अनुरोध / Requests from citizens</h1>
      <p className="mb-8 text-muted">
        कोई व्यक्ति अपना डेटा हटवाना चाहे या संदेश बंद करवाना चाहे। हर कार्य ऑडिट लॉग में दर्ज होता
        है। / When a person asks for their data to be deleted, or for no more messages. Each action
        is written to the audit log.
      </p>

      <section aria-labelledby="purge-h" className="mb-10 space-y-3">
        <h2 id="purge-h" className="text-lg font-semibold">
          मेरा डेटा हटाओ / Delete my data
        </h2>
        <p className="text-sm text-muted">
          प्रमाणपत्र पर छपा कोड डालें। इससे नाम, नंबर, फ़ोटो और PDF तुरंत हट जाते हैं। व्हाट्सऐप पर
          जा चुका संदेश वापस नहीं लिया जा सकता। / Enter the code printed on the certificate. Name,
          number, photo and PDF are deleted at once. A message already delivered on WhatsApp cannot
          be recalled.
        </p>
        <PurgeForm />
      </section>

      <section aria-labelledby="opt-h" className="space-y-3">
        <h2 id="opt-h" className="text-lg font-semibold">
          संदेश बंद करो / Stop messaging me
        </h2>
        <p className="text-sm text-muted">
          व्यक्ति “STOP” भेजकर खुद भी यह कर सकता है। यहाँ से नंबर सूची में जुड़ता है (सिर्फ़ उसका
          हैश रखा जाता है)। / A person can also reply STOP. Here the number is added to the list
          (only its hash is kept).
        </p>
        <OptOutForm />
      </section>
    </AppShell>
  );
}
