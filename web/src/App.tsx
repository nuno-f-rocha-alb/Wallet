import { useEffect, useState } from 'react';
import type { User } from '@wallet/shared';

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/me')
      .then((r) => (r.ok ? (r.json() as Promise<User>) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setUser)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <main className="wrap">
      <h1>Wallet</h1>
      {error && <p className="err">Not signed in ({error}).</p>}
      {user && (
        <p>
          Signed in as <strong>{user.displayName ?? user.email ?? `user #${user.id}`}</strong>
          {user.isAdmin ? ' · admin' : ''}
        </p>
      )}
      {!user && !error && <p className="muted">Loading…</p>}
      <p className="muted">Phase 0 — foundation. The ledger arrives in Phase 1.</p>
    </main>
  );
}
