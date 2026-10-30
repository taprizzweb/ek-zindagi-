import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { homePathFor } from '@/lib/domain/roles';

export default async function Home() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  redirect(user.mustChangePassword ? '/change-password' : homePathFor(user.role));
}
