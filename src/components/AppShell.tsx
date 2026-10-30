import type { SessionUser } from '@/lib/auth/session';
import SignOutButton from './SignOutButton';

const ROLE_LABEL = {
  officer: 'अधिकारी / Officer',
  supervisor: 'पर्यवेक्षक / Supervisor',
  admin: 'व्यवस्थापक / Admin',
} as const;

export default function AppShell({
  user,
  children,
  wide = false,
}: {
  user: SessionUser;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <>
      <header className="border-b-2 border-line">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <div>
            <p className="text-lg font-semibold">EK ZINDAGI</p>
            <p className="text-sm text-muted">
              {user.displayName}
              {user.officerCode ? ` · ${user.officerCode}` : ''} · {ROLE_LABEL[user.role]}
            </p>
          </div>
          <SignOutButton />
        </div>
      </header>
      <main className={`mx-auto px-4 py-6 ${wide ? 'max-w-5xl' : 'max-w-xl'}`}>{children}</main>
    </>
  );
}
