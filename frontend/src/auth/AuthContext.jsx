import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { loadWallet, request, saveWallet, SESSION_ERRORS } from '../api';

export const AuthContext = createContext(null);

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }) {
  const [wallet, setWallet] = useState(loadWallet);
  const [me, setMe] = useState(null);
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState('');
  const [demoAccounts, setDemoAccounts] = useState([]);
  const [demoPassword, setDemoPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');

  const updateWallet = useCallback((change) => {
    setWallet((current) => {
      const next = change(current);
      saveWallet(next);
      return next;
    });
  }, []);

  const activeToken = wallet.active ? wallet.sessions[wallet.active]?.token : null;

  const dropSession = useCallback((playerId, message) => {
    updateWallet((w) => {
      const sessions = { ...w.sessions };
      delete sessions[playerId];
      return { active: w.active === playerId ? null : w.active, sessions };
    });
    setMe(null);
    if (message) setNotice(message);
  }, [updateWallet]);

  // Authenticated request for the active account. A rejected session is
  // removed so the user is sent back to the login page with the reason.
  const api = useCallback(async (path, options = {}) => {
    try {
      return await request(path, { ...options, token: activeToken });
    } catch (err) {
      if (err.status === 401 && SESSION_ERRORS.includes(err.code) && wallet.active) {
        dropSession(wallet.active, err.message);
      }
      throw err;
    }
  }, [activeToken, wallet.active, dropSession]);

  const refreshMe = useCallback(async () => {
    if (!activeToken) {
      setMe(null);
      return null;
    }
    try {
      const data = await api('/auth/me');
      setMe(data);
      return data;
    } catch (err) {
      if (err.status !== 401) setNotice(err.message);
      return null;
    }
  }, [activeToken, api]);

  useEffect(() => {
    request('/status')
      .then((data) => {
        setStatus(data);
        setStatusError('');
      })
      .catch((err) => setStatusError(err.message));
    request('/auth/demo-accounts')
      .then((data) => {
        setDemoAccounts(data.accounts || []);
        setDemoPassword(data.password || '');
      })
      .catch(() => setDemoAccounts([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    refreshMe().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [refreshMe]);

  const addSession = useCallback((data) => {
    updateWallet((w) => ({
      active: data.account.playerId,
      sessions: {
        ...w.sessions,
        [data.account.playerId]: { token: data.token, username: data.account.username, isDemo: data.account.isDemo },
      },
    }));
    setMe({ account: data.account, player: data.player });
    setNotice('');
  }, [updateWallet]);

  const login = useCallback(async (username, password) => {
    const data = await request('/auth/login', { method: 'POST', body: { username, password } });
    addSession(data);
    return data;
  }, [addSession]);

  const register = useCallback(async (fields) => {
    const data = await request('/auth/register', { method: 'POST', body: fields });
    addSession(data);
    return data;
  }, [addSession]);

  const demoLogin = useCallback(async (playerId) => {
    const data = await request('/auth/demo-login', { method: 'POST', body: { playerId } });
    addSession(data);
    return data;
  }, [addSession]);

  const switchTo = useCallback(async (playerId) => {
    if (wallet.sessions[playerId]) {
      updateWallet((w) => ({ ...w, active: playerId }));
      return;
    }
    if (demoAccounts.some((a) => a.playerId === playerId)) {
      await demoLogin(playerId);
      return;
    }
    throw new Error('Sign in to that account first');
  }, [wallet.sessions, demoAccounts, demoLogin, updateWallet]);

  // Signs out every account used on this browser, revoking each session on
  // the server, so logging out always returns to the login page.
  const logout = useCallback(async () => {
    const tokens = Object.values(wallet.sessions).map((s) => s.token);
    await Promise.all(tokens.map((token) =>
      request('/auth/logout', { method: 'POST', token }).catch(() => {
        // The local session is removed even if the server cannot be reached.
      })));
    updateWallet(() => ({ active: null, sessions: {} }));
    setMe(null);
    setNotice('You have been logged out.');
  }, [wallet.sessions, updateWallet]);

  const value = useMemo(() => ({
    wallet, me, status, statusError, demoAccounts, demoPassword, loading, notice,
    api, refreshMe, login, register, demoLogin, switchTo, logout, setNotice,
  }), [wallet, me, status, statusError, demoAccounts, demoPassword, loading, notice,
    api, refreshMe, login, register, demoLogin, switchTo, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
