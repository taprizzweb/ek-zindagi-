import { requirePageUser } from '@/lib/auth/session';
import ChangePasswordForm from './ChangePasswordForm';

export default async function ChangePasswordPage() {
  const user = await requirePageUser({ allowMustChange: true });
  return (
    <main className="mx-auto max-w-md px-4 py-10">
      <h1 className="text-2xl font-semibold">नया पासवर्ड / New password</h1>
      <p className="mb-6 text-muted">
        {user.displayName}, आगे बढ़ने से पहले अपना पासवर्ड बदलें। / Please set your own password
        before you continue.
      </p>
      <ChangePasswordForm />
    </main>
  );
}
