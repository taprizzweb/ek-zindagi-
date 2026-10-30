import { redirect } from 'next/navigation';
import { NoticeBox } from '@/components/ui';
import { getSessionUser } from '@/lib/auth/session';
import { homePathFor } from '@/lib/domain/roles';
import LoginForm from './LoginForm';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const user = await getSessionUser();
  if (user) redirect(user.mustChangePassword ? '/change-password' : homePathFor(user.role));
  const { reason } = await searchParams;
  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <h1 className="text-2xl font-semibold">EK ZINDAGI</h1>
      <p className="mb-6 text-muted">एडमिन लॉगिन / Admin log in</p>
      {reason === 'timeout' ? (
        <div className="mb-4">
          <NoticeBox
            message={{
              hi: 'कुछ देर कोई गतिविधि न होने से आप लॉग आउट हो गए। कृपया फिर से लॉगिन करें।',
              en: 'You were signed out after a period of inactivity. Please log in again.',
            }}
          />
        </div>
      ) : null}
      {reason === 'link' ? (
        <div className="mb-4">
          <NoticeBox
            message={{
              hi: 'यह लिंक चालू नहीं है। अपने थाने के एडमिन से नया लिंक माँगें।',
              en: 'This link is not active. Ask your admin for a new link.',
            }}
          />
        </div>
      ) : null}
      <p className="mb-4 text-sm text-muted">
        पुलिसकर्मी: लॉगिन नहीं, अपना टीम लिंक खोलें। / Officers: no login, open your team link.
      </p>
      <LoginForm />
    </main>
  );
}
