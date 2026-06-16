import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import { Dashboard } from './components/Dashboard.js';
import { Login } from './components/Login.js';

type Auth = 'checking' | 'in' | 'out';

/**
 * App shell: gates the dashboard behind auth.
 *
 * On mount it asks the server whether the existing cookie is still valid, so a
 * returning user skips the login screen. The dashboard reports auth failures
 * (expired cookie) back up here via `onUnauthed`, flipping the gate to login.
 */
export function App(): React.JSX.Element {
  const [auth, setAuth] = useState<Auth>('checking');

  useEffect(() => {
    api.me().then(
      (r) => setAuth(r.authed ? 'in' : 'out'),
      () => setAuth('out'),
    );
  }, []);

  const onUnauthed = useCallback(() => setAuth('out'), []);

  const logout = useCallback(() => {
    void api.logout().finally(() => setAuth('out'));
  }, []);

  if (auth === 'checking') {
    return <div className="app-loading">Loading…</div>;
  }
  if (auth === 'out') {
    return <Login onAuthed={() => setAuth('in')} />;
  }
  return <Dashboard onUnauthed={onUnauthed} onLogout={logout} />;
}
