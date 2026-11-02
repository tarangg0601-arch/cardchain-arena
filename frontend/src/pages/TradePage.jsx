import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { errorText } from '../api';
import { useAuth } from '../auth/AuthContext';
import Alert from '../components/Alert';
import Icon from '../components/Icon';
import PageHeader from '../components/PageHeader';
import TradingCard from '../components/TradingCard';
import { useLedger } from '../ledger/LedgerContext';

const cardLabel = (c) => `${c.name} (${c.cardId}) - ${c.type} ${c.rarity}, ATK ${c.attack} / DEF ${c.defense}`;

function TradeRequest({ trade, incoming, busy, onAccept, onDecline, onCancel }) {
  return (
    <li className={incoming ? 'trade-item for-me' : 'trade-item'}>
      <div className="trade-top">
        <span>{incoming ? `From ${trade.fromUsername}` : `To ${trade.toUsername}`}</span>
        <span className="mono muted small">{trade.tradeId}</span>
      </div>
      <div className="trade-terms">
        <div>
          <span className="muted small">{incoming ? 'You receive' : 'You give'}</span>
          <strong>{trade.offeredCardName}</strong>
          <span className="mono muted small">{trade.offeredCardId}</span>
        </div>
        <Icon name="trade" size={18} className="muted" />
        <div>
          <span className="muted small">{incoming ? 'You give' : 'You receive'}</span>
          <strong>{trade.requestedCardName}</strong>
          <span className="mono muted small">{trade.requestedCardId}</span>
        </div>
      </div>
      <div className="trade-bottom">
        <span className="muted small">{new Date(trade.createdAt).toLocaleString()}</span>
        <div className="button-row">
          {incoming ? (
            <>
              <button type="button" className="primary" disabled={busy} onClick={onAccept}>Accept</button>
              <button type="button" className="ghost" disabled={busy} onClick={onDecline}>Decline</button>
            </>
          ) : (
            <button type="button" className="ghost" disabled={busy} onClick={onCancel}>Cancel</button>
          )}
        </div>
      </div>
    </li>
  );
}

export default function TradePage() {
  const { api, me, refreshMe } = useAuth();
  const { showReceipt, refreshSummary } = useLedger();
  const [params] = useSearchParams();
  const myId = me.player.playerId;
  const [players, setPlayers] = useState([]);
  const [friendIds, setFriendIds] = useState(new Set());
  const [myCards, setMyCards] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [trades, setTrades] = useState([]);
  const [form, setForm] = useState({ toPlayer: params.get('to') || '', offeredCardId: '', requestedCardId: '' });
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState({ kind: '', text: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [board, cards, allCards, mine, friends] = await Promise.all([
      api('/players'), api(`/players/${myId}/cards`), api('/cards/catalog'), api('/trades/mine'), api('/friends'),
    ]);
    setPlayers(board.filter((p) => p.playerId !== myId));
    setMyCards(cards);
    setCatalog(allCards);
    setTrades(mine);
    setFriendIds(new Set(friends.friends.map((f) => f.playerId)));
  }, [api, myId]);

  useEffect(() => {
    load().catch((err) => setMessage({ kind: 'error', text: err.message }));
  }, [load]);

  async function perform(action, successText, receiptTitle) {
    setMessage({ kind: '', text: '' });
    setBusy(true);
    let data;
    try {
      data = await action();
    } catch (err) {
      setMessage({ kind: 'error', text: errorText(err) });
      setBusy(false);
      refreshSummary();
      return false;
    }
    setMessage({ kind: 'success', text: successText(data) });
    showReceipt({ title: receiptTitle, txId: data.txId, blockNumber: data.blockNumber });
    try {
      await Promise.all([load(), refreshMe()]);
    } catch (err) {
      setMessage({ kind: 'error', text: err.message });
    }
    setBusy(false);
    return true;
  }

  async function onCreate(e) {
    e.preventDefault();
    const recipient = players.find((p) => p.playerId === form.toPlayer);
    const ok = await perform(
      () => api('/trades', { method: 'POST', body: form }),
      (data) => `Trade request ${data.trade.tradeId} sent to ${recipient?.username || form.toPlayer}.`,
      'Trade request sent',
    );
    if (ok) setForm({ ...form, offeredCardId: '', requestedCardId: '' });
  }

  const act = (tradeId, verb, done) => perform(
    () => api(`/trades/${tradeId}/${verb}`, { method: 'POST' }),
    () => `Trade ${tradeId} ${done}.`,
    `Trade ${done}`,
  );

  const update = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  const query = search.trim().toLowerCase();
  const wanted = catalog.filter((c) => !query || c.name.toLowerCase().includes(query) || c.cardId.toLowerCase().includes(query)
    || c.rarity.toLowerCase().includes(query) || c.type.toLowerCase().includes(query));
  const offered = myCards.find((c) => c.cardId === form.offeredCardId);
  const requested = catalog.find((c) => c.cardId === form.requestedCardId);
  const canSubmit = form.toPlayer && form.offeredCardId && form.requestedCardId && !busy;
  const incoming = trades.filter((t) => t.status === 'OPEN' && t.toPlayer === myId);
  const outgoing = trades.filter((t) => t.status === 'OPEN' && t.fromPlayer === myId);
  const closed = trades.filter((t) => t.status !== 'OPEN');
  const friends = players.filter((p) => friendIds.has(p.playerId));
  const others = players.filter((p) => !friendIds.has(p.playerId));

  return (
    <div className="page">
      <PageHeader title="Trade market" />
      <Alert kind={message.kind || 'info'}>{message.text}</Alert>

      <div className="trade-layout">
        <section className="panel">
          <h2>New trade request</h2>
          <form className="trade-form" onSubmit={onCreate}>
            <div className="field">
              <label htmlFor="trade-to">Send to</label>
              <select id="trade-to" value={form.toPlayer} onChange={update('toPlayer')}>
                <option value="">Select a player...</option>
                {friends.length > 0 && (
                  <optgroup label="Friends">
                    {friends.map((p) => <option key={p.playerId} value={p.playerId}>{p.username}</option>)}
                  </optgroup>
                )}
                <optgroup label="Players">
                  {others.map((p) => <option key={p.playerId} value={p.playerId}>{p.username}</option>)}
                </optgroup>
              </select>
            </div>
            <div className="field">
              <label htmlFor="trade-offer">You give</label>
              <select id="trade-offer" value={form.offeredCardId} onChange={update('offeredCardId')}>
                <option value="">Select one of your cards...</option>
                {myCards.map((c) => (
                  <option key={c.cardId} value={c.cardId} disabled={c.locked}>{cardLabel(c)}{c.locked ? ' - locked' : ''}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="trade-request">You want</label>
              <input type="search" aria-label="Search cards" placeholder="Search by name, ID, type or rarity"
                value={search} onChange={(e) => setSearch(e.target.value)} />
              <select id="trade-request" value={form.requestedCardId} onChange={update('requestedCardId')}>
                <option value="">Select a card ({wanted.length})...</option>
                {wanted.map((c) => <option key={c.cardId} value={c.cardId}>{cardLabel(c)}</option>)}
              </select>
            </div>

            <div className="trade-preview">
              {offered ? <TradingCard card={offered} compact /> : <div className="preview-empty">You give</div>}
              <span className="swap-icon"><Icon name="trade" size={22} /></span>
              {requested ? <TradingCard card={requested} compact anonymous /> : <div className="preview-empty">You want</div>}
            </div>

            <button type="submit" className="primary" disabled={!canSubmit}>{busy ? 'Sending...' : 'Send trade request'}</button>
          </form>
        </section>

        <div>
          <section className="panel">
            <div className="panel-head">
              <h2>Incoming requests</h2>
              {incoming.length > 0 && <span className="badge accent">{incoming.length}</span>}
            </div>
            {incoming.length === 0 ? (
              <div className="empty small">No incoming requests.</div>
            ) : (
              <ul className="trade-list" data-testid="incoming-trades">
                {incoming.map((t) => (
                  <TradeRequest key={t.tradeId} trade={t} incoming busy={busy}
                    onAccept={() => act(t.tradeId, 'accept', 'accepted')}
                    onDecline={() => act(t.tradeId, 'decline', 'declined')} />
                ))}
              </ul>
            )}
          </section>

          <section className="panel">
            <h2>Sent requests</h2>
            {outgoing.length === 0 ? (
              <div className="empty small">No pending requests.</div>
            ) : (
              <ul className="trade-list" data-testid="sent-trades">
                {outgoing.map((t) => (
                  <TradeRequest key={t.tradeId} trade={t} busy={busy}
                    onCancel={() => act(t.tradeId, 'cancel', 'cancelled')} />
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <section className="panel">
        <h2>Trade history</h2>
        {closed.length === 0 ? (
          <div className="empty">No completed trades yet.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Trade ID</th><th>From</th><th>Offered</th><th>To</th><th>Requested</th><th>Status</th><th>Closed</th></tr>
              </thead>
              <tbody>
                {closed.map((t) => (
                  <tr key={t.tradeId}>
                    <td className="mono">{t.tradeId}</td>
                    <td>{t.fromUsername}</td>
                    <td>{t.offeredCardName} <span className="muted mono">{t.offeredCardId}</span></td>
                    <td>{t.toUsername}</td>
                    <td>{t.requestedCardName} <span className="muted mono">{t.requestedCardId}</span></td>
                    <td><span className={`badge ${t.status === 'ACCEPTED' ? 'ok' : ''}`}>{t.status}</span></td>
                    <td>{t.closedAt ? new Date(t.closedAt).toLocaleString() : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
