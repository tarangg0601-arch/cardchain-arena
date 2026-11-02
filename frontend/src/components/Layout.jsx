import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { LedgerProvider, useLedger } from '../ledger/LedgerContext';
import Icon from './Icon';
import NetworkStatus from './NetworkStatus';
import ThemePicker from '../theme/ThemePicker';

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
  { to: '/deck', label: 'My deck', icon: 'deck' },
  { to: '/battle', label: 'Battle arena', icon: 'battle' },
  { to: '/trade', label: 'Trade market', icon: 'trade', badge: 'tradeRequests' },
  { to: '/shop', label: 'Card shop', icon: 'shop' },
  { to: '/friends', label: 'Friends', icon: 'friends', badge: 'friendRequests' },
  { to: '/leaderboard', label: 'Leaderboard', icon: 'trophy' },
  { to: '/ledger', label: 'Ledger explorer', icon: 'ledger' },
];

function SideNav() {
  const { notifications } = useLedger();
  return (
    <nav className="side-nav" aria-label="Main">
      {NAV.map((item) => {
        const count = item.badge ? notifications[item.badge] : 0;
        return (
          <NavLink key={item.to} to={item.to}>
            <Icon name={item.icon} />
            <span>{item.label}</span>
            {count > 0 && <span className="nav-badge" aria-label={`${count} new`}>{count}</span>}
          </NavLink>
        );
      })}
    </nav>
  );
}

function PlayerSwitcher() {
  const { wallet, me, demoAccounts, status, switchTo } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');

  const options = new Map();
  for (const account of demoAccounts) {
    options.set(account.playerId, `${account.username} (demo)`);
  }
  for (const [playerId, session] of Object.entries(wallet.sessions)) {
    if (!options.has(playerId)) options.set(playerId, `${session.username} (${playerId})`);
  }

  async function onChange(event) {
    const value = event.target.value;
    setError('');
    if (value === '__add') {
      navigate('/login?add=1');
      return;
    }
    try {
      await switchTo(value);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="switcher">
      <label htmlFor="player-switcher">{status?.demoMode ? 'Demo player switcher' : 'Switch account'}</label>
      <select id="player-switcher" value={me?.account.playerId || ''} onChange={onChange}>
        {[...options.entries()].map(([playerId, text]) => (
          <option key={playerId} value={playerId}>{text}</option>
        ))}
        <option value="__add">Sign in another account...</option>
      </select>
      {error && <span className="error-text">{error}</span>}
    </div>
  );
}

function PlayerPanel({ player }) {
  const initials = player.username.slice(0, 2).toUpperCase();
  return (
    <div className="player-panel" data-testid="player-info">
      <div className="player-head">
        <div className="avatar" aria-hidden="true">{initials}</div>
        <div>
          <div className="player-name">{player.username}</div>
          <div className="player-id">ID: {player.playerId}</div>
        </div>
      </div>
      <div className="player-rating">
        <span>Rating: <strong>{player.rating}</strong></span>
        <span className="coins" data-testid="coins"><Icon name="coin" size={16} />{player.coins}</span>
      </div>
      <div className="player-record">
        <span><b>{player.wins}</b> W</span>
        <span><b>{player.losses}</b> L</span>
        <span><b>{player.draws}</b> D</span>
        <span>Streak <b>{player.winStreak}</b></span>
      </div>
    </div>
  );
}

export default function Layout() {
  const { me, logout, notice, setNotice } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  async function onLogout() {
    await logout();
    navigate('/login');
  }

  return (
    <LedgerProvider>
      <div className={menuOpen ? 'shell menu-open' : 'shell'}>
        <header className="mobile-bar">
          <span className="brand-word">CardChain</span>
          <button type="button" className="icon-button" aria-label="Open menu" onClick={() => setMenuOpen(true)}>
            <Icon name="menu" size={22} />
          </button>
        </header>

        <aside className="sidebar">
          <div className="sidebar-top">
            <div className="brand">
              <span className="brand-mark" aria-hidden="true"><Icon name="ledger" size={20} /></span>
              <div>
                <div className="brand-word">CardChain</div>
                <div className="brand-sub">Hyperledger Fabric</div>
              </div>
              <button type="button" className="icon-button sidebar-close" aria-label="Close menu" onClick={() => setMenuOpen(false)}>
                <Icon name="close" size={20} />
              </button>
            </div>

            {me?.player && <PlayerPanel player={me.player} />}

            <SideNav />
          </div>

          <div className="sidebar-bottom">
            <NetworkStatus />
            <ThemePicker />
            <PlayerSwitcher />
            <button type="button" className="ghost logout" onClick={onLogout}>
              <Icon name="logout" size={16} />Log out
            </button>
          </div>
        </aside>
        <div className="scrim" onClick={() => setMenuOpen(false)} aria-hidden="true" />

        <main className="main">
          {notice && (
            <div className="notice">
              <span>{notice}</span>
              <button type="button" className="link" onClick={() => setNotice('')}>Dismiss</button>
            </div>
          )}
          <Outlet />
        </main>
      </div>
    </LedgerProvider>
  );
}
