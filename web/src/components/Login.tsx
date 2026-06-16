import { useState } from 'react';
import { api } from '../api.js';

/**
 * Single-password login. On success the server sets the auth cookie and we tell
 * the app to swap in the dashboard. A wrong password reports inline without
 * clearing the field, so a typo is quick to fix.
 */
export function Login({ onAuthed }: { onAuthed: () => void }): React.JSX.Element {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const ok = await api.login(password);
      if (ok) onAuthed();
      else setError('Incorrect password.');
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <h1 className="login-mark">wisp</h1>
        <p className="login-sub">Sign in to view analytics.</p>
        <input
          type="password"
          className="login-input"
          placeholder="Password"
          value={password}
          autoFocus
          onChange={(e) => setPassword(e.target.value)}
        />
        <button type="submit" className="btn btn-primary" disabled={busy || password === ''}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        {error && <p className="login-error">{error}</p>}
      </form>
    </div>
  );
}
