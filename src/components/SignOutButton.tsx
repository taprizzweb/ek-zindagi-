'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from './ui';

export default function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function signOut() {
    setBusy(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      router.replace('/login');
      router.refresh();
    }
  }
  return (
    <Button variant="secondary" onClick={signOut} disabled={busy}>
      लॉग आउट / Log out
    </Button>
  );
}
