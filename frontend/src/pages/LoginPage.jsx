import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import Alert from '../components/Alert';
import AuthLayout from '../components/AuthLayout';
import Icon from '../components/Icon';

export default function LoginPage() {
  const { me, login, demoLogin, demoAccounts, demoPassword, status, notice, setNotice } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const addingAccount = params.get('add') === '1';
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (me && !addingAccount) {
    return <Navigate to="/dashboard" replace />;
  }

  async function run(action) {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await action();
      navigate('/dashboard');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <div className="form-card">
        <h2>{addingAccount ? 'Sign in another account' : 'Log in'}</h2>
        {addingAccount && me && <p><Link to="/dashboard">Back to the game</Link></p>}
        <Alert kind="info">{notice}</Alert>
        <Alert kind="error">{error}</Alert>
        <form onSubmit={(e) => { e.preventDefault(); run(() => login(username.trim(), password)); }}>
          <div className="field">
            <label htmlFor="login-username">Username</label>
            <input id="login-username" value={username} autoComplete="username" onChange={(e) => setUsername(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="login-password">Password</label>
            <input id="login-password" type="password" value={password} autoComplete="current-password"
              onChange={(e) => setPassword(e.target.value)} />
          </div>
          <button type="submit" className="primary wide" disabled={busy || !username || !password}>
            {busy ? 'Logging in...' : 'Log in'}
          </button>
        </form>
        <p className="switch-link">New player? <Link to="/register">Create an account</Link></p>
      </div>

      {status?.demoMode && demoAccounts.length > 0 && (
        <div className="form-card demo-card">
          <h2>Demonstration accounts</h2>
          <p className="muted small">Password: <code>{demoPassword}</code></p>
          <div className="demo-buttons">
            {demoAccounts.map((account) => (
              <button key={account.playerId} type="button" className="ghost" disabled={busy}
                onClick={() => run(() => demoLogin(account.playerId))}>
                <Icon name="user" size={16} />Continue as {account.username}
              </button>
            ))}
          </div>
        </div>
      )}
    </AuthLayout>
  );
}
