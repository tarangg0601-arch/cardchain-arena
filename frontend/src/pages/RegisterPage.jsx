import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import Alert from '../components/Alert';
import AuthLayout from '../components/AuthLayout';
import TradingCard from '../components/TradingCard';

function validate({ username, password, confirmPassword }) {
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
    return 'Username must be 3-20 characters using letters, numbers or underscore.';
  }
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Password must be at least 8 characters and contain a letter and a number.';
  }
  if (password !== confirmPassword) {
    return 'Passwords do not match.';
  }
  return '';
}

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: '', password: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(null);

  const update = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  async function onSubmit(e) {
    e.preventDefault();
    const problem = validate(form);
    setError(problem);
    if (problem) return;
    setBusy(true);
    try {
      setCreated(await register({ ...form, username: form.username.trim() }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <div className="welcome-page">
        <div className="form-card welcome">
          <h2>Account created</h2>
          <dl className="receipt-facts">
            <dt>Username</dt><dd>{created.account.username}</dd>
            <dt>Player ID</dt><dd>{created.account.playerId}</dd>
            <dt>Rating</dt><dd>{created.player.rating}</dd>
            <dt>Coins</dt><dd>{created.player.coins}</dd>
            <dt>Block</dt><dd>#{created.blockNumber}</dd>
            <dt>Transaction</dt><dd><code>{created.txId}</code></dd>
          </dl>
          <h3>Starter cards</h3>
          <div className="card-grid">
            {created.starterCards.map((card) => <TradingCard key={card.cardId} card={card} />)}
          </div>
          <button type="button" className="primary enter" onClick={() => navigate('/dashboard')}>Enter the game</button>
        </div>
      </div>
    );
  }

  return (
    <AuthLayout>
      <div className="form-card">
        <h2>Create an account</h2>
        <Alert kind="error">{error}</Alert>
        <form onSubmit={onSubmit} noValidate>
          <div className="field">
            <label htmlFor="reg-username">Username</label>
            <input id="reg-username" value={form.username} autoComplete="username" onChange={update('username')} />
          </div>
          <div className="field">
            <label htmlFor="reg-password">Password</label>
            <input id="reg-password" type="password" value={form.password} autoComplete="new-password" onChange={update('password')} />
          </div>
          <div className="field">
            <label htmlFor="reg-confirm">Confirm password</label>
            <input id="reg-confirm" type="password" value={form.confirmPassword} autoComplete="new-password" onChange={update('confirmPassword')} />
          </div>
          <button type="submit" className="primary wide" disabled={busy}>{busy ? 'Creating account...' : 'Create account'}</button>
        </form>
        <p className="switch-link">Already registered? <Link to="/login">Log in</Link></p>
      </div>
    </AuthLayout>
  );
}
