import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { errorText } from '../api';
import { useAuth } from '../auth/AuthContext';
import Alert from '../components/Alert';
import BattleAnimation from '../components/BattleAnimation';
import BattleResult from '../components/BattleResult';
import Icon from '../components/Icon';
import PageHeader from '../components/PageHeader';
import TradingCard from '../components/TradingCard';
import { useLedger } from '../ledger/LedgerContext';

const RANDOM = '__random';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function toggle(list, id) {
  if (list.includes(id)) return list.filter((x) => x !== id);
  return list.length < 3 ? [...list, id] : list;
}

function shuffle(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function Slot({ card }) {
  if (!card) return <div className="slot empty-slot">Pick a card</div>;
  return (
    <div className={`slot type-${card.type.toLowerCase()}`}>
      <Icon name={card.type} size={18} />
      <div>
        <div className="slot-name">{card.name}</div>
        <div className="slot-meta">{card.rarity} {card.type}, ATK {card.attack} / DEF {card.defense}</div>
      </div>
    </div>
  );
}

function HiddenSlot() {
  return (
    <div className="slot hidden-slot">
      <Icon name="lock" size={16} />
      <div className="slot-name">Hidden card</div>
    </div>
  );
}

export default function BattlePage({ fightMs = 3600 }) {
  const { api, me, refreshMe } = useAuth();
  const { showReceipt } = useLedger();
  const [params] = useSearchParams();
  const myId = me.player.playerId;
  const [players, setPlayers] = useState([]);
  const [friendIds, setFriendIds] = useState(new Set());
  const [opponentId, setOpponentId] = useState(params.get('opponent') || '');
  const [myCards, setMyCards] = useState([]);
  const [selection, setSelection] = useState([]);
  const [history, setHistory] = useState([]);
  const [result, setResult] = useState(null);
  const [fight, setFight] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const [board, cards, battles, friends] = await Promise.all([
      api('/players'), api(`/players/${myId}/cards`), api('/battles/mine'), api('/friends'),
    ]);
    setPlayers(board.filter((p) => p.playerId !== myId));
    setMyCards(cards);
    setHistory(battles);
    setFriendIds(new Set(friends.friends.map((f) => f.playerId)));
  }, [api, myId]);

  useEffect(() => {
    setSelection([]);
    setResult(null);
    load().catch((err) => setError(err.message));
  }, [load]);

  const available = myCards.filter((c) => !c.locked);
  const byId = Object.fromEntries(myCards.map((c) => [c.cardId, c]));
  const opponent = players.find((p) => p.playerId === opponentId);
  const friends = players.filter((p) => friendIds.has(p.playerId));
  const others = players.filter((p) => !friendIds.has(p.playerId));
  const ready = opponentId && selection.length === 3 && !fight;

  async function startBattle() {
    const target = opponentId === RANDOM ? players[Math.floor(Math.random() * players.length)] : opponent;
    if (!target) return;
    setError('');
    setResult(null);
    const picked = selection.map((id) => byId[id]);
    setFight({ opponentName: target.username, cards: picked });
    const started = Date.now();

    let data;
    try {
      data = await api('/battles', { method: 'POST', body: { opponentId: target.playerId, myCardIds: selection } });
    } catch (err) {
      setFight(null);
      setError(errorText(err));
      return;
    }
    await wait(Math.max(0, fightMs - (Date.now() - started)));
    setFight(null);
    setResult(data.battle);
    setSelection([]);
    showReceipt({ title: 'Battle recorded', txId: data.txId, blockNumber: data.blockNumber });
    try {
      await Promise.all([refreshMe(), load()]);
    } catch (err) {
      setError(err.message);
    }
  }

  async function viewBattle(battleId) {
    setError('');
    try {
      setResult(await api(`/battles/${battleId}`));
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="page">
      <PageHeader title="Battle arena" />
      <Alert kind="error">{error}</Alert>

      <section className="panel arena">
        <div className="arena-top">
          <div className="field">
            <label htmlFor="opponent">Opponent</label>
            <select id="opponent" aria-label="Opponent" value={opponentId} onChange={(e) => setOpponentId(e.target.value)}>
              <option value="">Select a player...</option>
              <option value={RANDOM}>Random opponent</option>
              {friends.length > 0 && (
                <optgroup label="Friends">
                  {friends.map((p) => <option key={p.playerId} value={p.playerId}>{p.username}, rating {p.rating}</option>)}
                </optgroup>
              )}
              <optgroup label="Players">
                {others.map((p) => <option key={p.playerId} value={p.playerId}>{p.username}, rating {p.rating}</option>)}
              </optgroup>
            </select>
          </div>
          <div className="arena-actions">
            <button type="button" className="ghost" disabled={available.length < 3 || Boolean(fight)}
              onClick={() => setSelection(shuffle(available).slice(0, 3).map((c) => c.cardId))}>
              <Icon name="dice" size={16} />Random pick
            </button>
            <button type="button" className="ghost" disabled={!selection.length || Boolean(fight)} onClick={() => setSelection([])}>
              Clear
            </button>
            <button type="button" className="primary big" disabled={!ready} onClick={startBattle}>
              <Icon name="battle" size={18} />Start battle
            </button>
          </div>
        </div>

        {opponent && (
          <div className="opponent-card">
            <div className="avatar small" aria-hidden="true">{opponent.username.slice(0, 2).toUpperCase()}</div>
            <div>
              <strong>{opponent.username}</strong>
              <div className="muted small">Rating {opponent.rating}, W/L/D {opponent.wins} / {opponent.losses} / {opponent.draws}</div>
            </div>
          </div>
        )}

        <div className="lineup" aria-label="Round lineup">
          {[0, 1, 2].map((i) => (
            <div className="lineup-row" key={i}>
              <span className="round-tag">Round {i + 1}</span>
              <Slot card={byId[selection[i]]} />
              <span className="versus">vs</span>
              <HiddenSlot />
            </div>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>Your cards <span className="count">{selection.length}/3 picked</span></h2>
        <div className="card-grid compact-grid">
          {myCards.map((card) => (
            <TradingCard key={card.cardId} card={card} compact selectable
              selectedIndex={selection.indexOf(card.cardId)}
              onToggle={(id) => setSelection((s) => toggle(s, id))} />
          ))}
        </div>
      </section>

      {result && <BattleResult battle={result} />}

      <section className="panel">
        <h2>Recent battles</h2>
        {history.length === 0 ? (
          <div className="empty">No battles yet.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Battle ID</th><th>Opponent</th><th>Score</th><th>Outcome</th><th>Date</th><th /></tr>
              </thead>
              <tbody>
                {history.map((b) => {
                  const mine = b.challengerId === myId;
                  const meSide = mine ? b.challenger : b.opponent;
                  const other = mine ? b.opponent : b.challenger;
                  const myScore = mine ? b.score.challenger : b.score.opponent;
                  const otherScore = mine ? b.score.opponent : b.score.challenger;
                  return (
                    <tr key={b.battleId}>
                      <td className="mono">{b.battleId}</td>
                      <td>{other.username}</td>
                      <td>{myScore} - {otherScore}</td>
                      <td><span className={`badge result-${meSide.result.toLowerCase()}`}>{meSide.result}</span></td>
                      <td>{new Date(b.timestamp).toLocaleString()}</td>
                      <td><button type="button" className="link" onClick={() => viewBattle(b.battleId)}>View</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {fight && (
        <BattleAnimation myName={me.player.username} opponentName={fight.opponentName} myCards={fight.cards}
          roundMs={Math.max(1, Math.floor(fightMs / 3))} />
      )}
    </div>
  );
}
