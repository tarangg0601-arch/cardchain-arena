import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import Icon from '../components/Icon';

const LedgerContext = createContext(null);
const NOOP = {
  summary: null, summaryError: '', notifications: { friendRequests: 0, tradeRequests: 0 },
  refreshSummary: () => {}, showReceipt: () => {},
};

export function useLedger() {
  return useContext(LedgerContext) || NOOP;
}

function Receipt({ receipt, mode, onClose }) {
  return (
    <div className="receipt" role="status" data-testid="tx-receipt">
      <div className="receipt-icon"><Icon name="check" size={18} /></div>
      <div className="receipt-body">
        <strong>{receipt.title}</strong>
        <span>
          {mode === 'fabric' ? 'Committed to the channel in block ' : 'Recorded in local block '}
          <Link to={`/ledger?block=${receipt.blockNumber}`} onClick={onClose}>#{receipt.blockNumber}</Link>
        </span>
        <code title={receipt.txId}>tx {receipt.txId.slice(0, 20)}...</code>
      </div>
      <button type="button" className="icon-button" aria-label="Dismiss" onClick={onClose}>
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}

// Shares the ledger summary (height, counts) between the sidebar and pages,
// and shows a receipt after every successful write transaction.
export function LedgerProvider({ children }) {
  const { api, status } = useAuth();
  const [summary, setSummary] = useState(null);
  const [summaryError, setSummaryError] = useState('');
  const [receipt, setReceipt] = useState(null);
  const [notifications, setNotifications] = useState({ friendRequests: 0, tradeRequests: 0 });
  const timer = useRef(null);

  const refreshSummary = useCallback(async () => {
    try {
      const [nextSummary, nextNotifications] = await Promise.all([api('/ledger/summary'), api('/me/notifications')]);
      setSummary(nextSummary);
      setNotifications(nextNotifications);
      setSummaryError('');
    } catch (err) {
      setSummaryError(err.message);
    }
  }, [api]);

  useEffect(() => {
    refreshSummary();
    const id = setInterval(refreshSummary, 10000);
    return () => clearInterval(id);
  }, [refreshSummary]);

  const closeReceipt = useCallback(() => setReceipt(null), []);

  const showReceipt = useCallback((next) => {
    if (!next || !next.txId) return;
    setReceipt(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setReceipt(null), 10000);
    refreshSummary();
  }, [refreshSummary]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const value = useMemo(() => ({ summary, summaryError, notifications, refreshSummary, showReceipt }),
    [summary, summaryError, notifications, refreshSummary, showReceipt]);

  return (
    <LedgerContext.Provider value={value}>
      {children}
      {receipt && <Receipt receipt={receipt} mode={status?.ledger.mode} onClose={closeReceipt} />}
    </LedgerContext.Provider>
  );
}
