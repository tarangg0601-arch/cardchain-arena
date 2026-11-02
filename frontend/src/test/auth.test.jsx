import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { AuthProvider } from '../auth/AuthContext';
import { p1Cards, player1 } from './fixtures';

const STATUS = { ledger: { mode: 'local', localLedgerFile: 'local-ledger.json' }, requestedMode: 'auto', fallbackReason: 'peer unreachable', demoMode: true };
const LOGIN_OK = { token: 'tok-1', account: { playerId: 'player1', username: 'player1', isDemo: true }, player: player1 };

function json(status, body) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });
}

// A small fake backend for fetch. Each handler returns [status, body].
function installFetch(handlers) {
  const calls = [];
  global.fetch = vi.fn((url, options = {}) => {
    const path = url.replace('/api', '');
    const key = `${options.method || 'GET'} ${path}`;
    calls.push({ key, options });
    const handler = handlers[key];
    if (!handler) return json(404, { error: { code: 'NOT_FOUND', message: key } });
    const [status, body] = handler(options);
    return json(status, body);
  });
  return calls;
}

function renderApp(path = '/deck') {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

const baseHandlers = {
  'GET /status': () => [200, STATUS],
  'GET /auth/demo-accounts': () => [200, { demoMode: true, password: 'demo1234', accounts: [{ playerId: 'player1', username: 'player1', isDemo: true }] }],
  'GET /players/player1/cards': () => [200, p1Cards],
  'GET /ledger/summary': () => [200, {
    network: STATUS.ledger, height: 3, currentBlockHash: 'ab'.repeat(32), counts: { total: 2, valid: 2, invalid: 0, game: 2 },
    lastGameTx: null, stats: { players: 2, cards: 8, openTrades: 0, battles: 0 }, rejectedCount: 0,
  }],
  'GET /ledger/blocks?limit=6': () => [200, { height: 3, currentBlockHash: 'ab'.repeat(32), blocks: [] }],
  'GET /me/notifications': () => [200, { friendRequests: 0, tradeRequests: 1 }],
};

describe('authentication flow', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('redirects to login, rejects bad credentials, then logs in and shows player data and ledger mode', async () => {
    const user = userEvent.setup();
    installFetch({
      ...baseHandlers,
      'POST /auth/login': (opts) => {
        const body = JSON.parse(opts.body);
        return body.password === 'demo1234'
          ? [200, LOGIN_OK]
          : [401, { error: { code: 'INVALID_CREDENTIALS', message: 'Incorrect username or password' } }];
      },
      'GET /auth/me': () => [200, { account: LOGIN_OK.account, player: player1 }],
    });
    renderApp('/deck');

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Username'), 'player1');
    await user.type(screen.getByLabelText('Password'), 'wrongpass1');
    await user.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect username or password');

    await user.clear(screen.getByLabelText('Password'));
    await user.type(screen.getByLabelText('Password'), 'demo1234');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByRole('heading', { name: 'Welcome back, player1' })).toBeInTheDocument();
    expect(screen.getByTestId('player-info')).toHaveTextContent('Rating: 1000');
    expect(screen.getByTestId('ledger-mode')).toHaveTextContent('Mode: Local demo ledger');
    expect(screen.getByTestId('ledger-mode')).toHaveTextContent(/Fabric\s*Offline/);
    expect(await screen.findByLabelText('1 new')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('tcg.sessions')).sessions.player1.token).toBe('tok-1');
  });

  it('returns to the login page with a message when the stored session has expired', async () => {
    localStorage.setItem('tcg.sessions', JSON.stringify({ active: 'player1', sessions: { player1: { token: 'old', username: 'player1' } } }));
    installFetch({
      ...baseHandlers,
      'GET /auth/me': () => [401, { error: { code: 'SESSION_EXPIRED', message: 'Your session has expired. Please log in again.' } }],
    });
    renderApp('/deck');
    expect(await screen.findByText('Your session has expired. Please log in again.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('tcg.sessions')).sessions.player1).toBeUndefined();
  });

  it('logs out on the server and clears the local session', async () => {
    const user = userEvent.setup();
    localStorage.setItem('tcg.sessions', JSON.stringify({ active: 'player1', sessions: { player1: { token: 'tok-1', username: 'player1' } } }));
    const calls = installFetch({
      ...baseHandlers,
      'GET /auth/me': () => [200, { account: LOGIN_OK.account, player: player1 }],
      'POST /auth/logout': () => [200, { ok: true }],
    });
    renderApp('/deck');
    await user.click(await screen.findByRole('button', { name: 'Log out' }));
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    expect(screen.getByText('You have been logged out.')).toBeInTheDocument();
    const logoutCall = calls.find((c) => c.key === 'POST /auth/logout');
    expect(logoutCall.options.headers.Authorization).toBe('Bearer tok-1');
    expect(JSON.parse(localStorage.getItem('tcg.sessions')).sessions).toEqual({});
  });
});
