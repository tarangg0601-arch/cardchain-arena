import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { errorText } from '../api';
import { useAuth } from '../auth/AuthContext';
import Alert from '../components/Alert';
import Icon from '../components/Icon';
import PageHeader from '../components/PageHeader';
import { useLedger } from '../ledger/LedgerContext';

export default function FriendsPage() {
  const { api, me } = useAuth();
  const { showReceipt, refreshSummary } = useLedger();
  const myId = me.player.playerId;
  const [data, setData] = useState({ friends: [], incoming: [], outgoing: [] });
  const [players, setPlayers] = useState([]);
  const [username, setUsername] = useState('');
  const [message, setMessage] = useState({ kind: '', text: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [friends, board] = await Promise.all([api('/friends'), api('/players')]);
    setData(friends);
    setPlayers(board.filter((p) => p.playerId !== myId));
  }, [api, myId]);

  useEffect(() => {
    load().catch((err) => setMessage({ kind: 'error', text: err.message }));
  }, [load]);

  async function perform(action, successText, receiptTitle) {
    setMessage({ kind: '', text: '' });
    setBusy(true);
    try {
      const result = await action();
      setMessage({ kind: 'success', text: successText });
      showReceipt({ title: receiptTitle, txId: result.txId, blockNumber: result.blockNumber });
      await load();
      return true;
    } catch (err) {
      setMessage({ kind: 'error', text: errorText(err) });
      refreshSummary();
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function sendRequest(name) {
    const ok = await perform(
      () => api('/friends/requests', { method: 'POST', body: { username: name } }),
      `Friend request sent to ${name}.`,
      'Friend request sent',
    );
    if (ok) setUsername('');
  }

  const respond = (request, verb) => perform(
    () => api(`/friends/requests/${request.requestId}/${verb}`, { method: 'POST' }),
    verb === 'accept' ? `You and ${request.fromUsername} are now friends.` : `Request from ${request.fromUsername} declined.`,
    verb === 'accept' ? 'Friend request accepted' : 'Friend request declined',
  );

  const remove = (friend) => perform(
    () => api(`/friends/${friend.playerId}/remove`, { method: 'POST' }),
    `${friend.username} removed from friends.`,
    'Friend removed',
  );

  const friendIds = new Set(data.friends.map((f) => f.playerId));
  const pendingIds = new Set([...data.outgoing.map((r) => r.toPlayer), ...data.incoming.map((r) => r.fromPlayer)]);
  const others = players.filter((p) => !friendIds.has(p.playerId));

  return (
    <div className="page">
      <PageHeader title="Friends" />
      <Alert kind={message.kind || 'info'}>{message.text}</Alert>

      <div className="friends-layout">
        <div>
          <section className="panel">
            <h2>Add a friend</h2>
            <form className="inline-form" onSubmit={(e) => { e.preventDefault(); sendRequest(username.trim()); }}>
              <input aria-label="Friend username" placeholder="Username" value={username} list="player-names"
                onChange={(e) => setUsername(e.target.value)} />
              <datalist id="player-names">
                {others.map((p) => <option key={p.playerId} value={p.username} />)}
              </datalist>
              <button type="submit" className="primary" disabled={busy || !username.trim()}>
                <Icon name="plus" size={16} />Send request
              </button>
            </form>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Friend requests</h2>
              {data.incoming.length > 0 && <span className="badge accent">{data.incoming.length}</span>}
            </div>
            {data.incoming.length === 0 && data.outgoing.length === 0 && <div className="empty small">No pending requests.</div>}
            <ul className="request-list" data-testid="friend-requests">
              {data.incoming.map((r) => (
                <li key={r.requestId}>
                  <div className="avatar small" aria-hidden="true">{r.fromUsername.slice(0, 2).toUpperCase()}</div>
                  <div className="grow"><strong>{r.fromUsername}</strong><div className="muted small">Wants to be friends</div></div>
                  <button type="button" className="primary" disabled={busy} onClick={() => respond(r, 'accept')}>Accept</button>
                  <button type="button" className="ghost" disabled={busy} onClick={() => respond(r, 'decline')}>Decline</button>
                </li>
              ))}
              {data.outgoing.map((r) => (
                <li key={r.requestId}>
                  <div className="avatar small" aria-hidden="true">{r.toUsername.slice(0, 2).toUpperCase()}</div>
                  <div className="grow"><strong>{r.toUsername}</strong><div className="muted small">Request sent</div></div>
                  <span className="badge">Pending</span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <section className="panel">
          <h2>My friends <span className="count">{data.friends.length}</span></h2>
          {data.friends.length === 0 ? (
            <div className="empty">No friends yet.</div>
          ) : (
            <ul className="friend-list" data-testid="friend-list">
              {data.friends.map((f) => (
                <li key={f.playerId}>
                  <div className="avatar small" aria-hidden="true">{f.username.slice(0, 2).toUpperCase()}</div>
                  <div className="grow">
                    <strong>{f.username}</strong>
                    <div className="muted small">Rating {f.rating}, W/L/D {f.wins} / {f.losses} / {f.draws}</div>
                  </div>
                  <Link className="ghost button" to={`/battle?opponent=${f.playerId}`}><Icon name="battle" size={15} />Battle</Link>
                  <Link className="ghost button" to={`/trade?to=${f.playerId}`}><Icon name="trade" size={15} />Trade</Link>
                  <button type="button" className="ghost" disabled={busy} onClick={() => remove(f)}>Remove</button>
                </li>
              ))}
            </ul>
          )}

          <h3>Players</h3>
          <ul className="friend-list">
            {others.map((p) => (
              <li key={p.playerId}>
                <div className="avatar small" aria-hidden="true">{p.username.slice(0, 2).toUpperCase()}</div>
                <div className="grow">
                  <strong>{p.username}</strong>
                  <div className="muted small">Rating {p.rating}</div>
                </div>
                {pendingIds.has(p.playerId) ? (
                  <span className="badge">Pending</span>
                ) : (
                  <button type="button" className="ghost" disabled={busy} onClick={() => sendRequest(p.username)}>
                    <Icon name="plus" size={15} />Add friend
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
