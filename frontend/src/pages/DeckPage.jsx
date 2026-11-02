import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import Alert from '../components/Alert';
import Icon from '../components/Icon';
import PageHeader from '../components/PageHeader';
import TradingCard from '../components/TradingCard';

const TYPES = ['All', 'Fire', 'Water', 'Earth', 'Air'];
const RARITIES = ['All', 'Common', 'Rare', 'Epic', 'Legendary'];

function FilterGroup({ label, options, value, onChange }) {
  return (
    <div className="filter-group" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          className={value === option ? 'chip active' : 'chip'}
          aria-pressed={value === option}
          onClick={() => onChange(option)}
        >
          {option !== 'All' && TYPES.includes(option) && <Icon name={option} size={14} />}
          {option}
        </button>
      ))}
    </div>
  );
}

export default function DeckPage() {
  const { api, me } = useAuth();
  const playerId = me.player.playerId;
  const [cards, setCards] = useState(null);
  const [error, setError] = useState('');
  const [type, setType] = useState('All');
  const [rarity, setRarity] = useState('All');
  const [hideLocked, setHideLocked] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      setCards(await api(`/players/${playerId}/cards`));
    } catch (err) {
      setError(err.message);
    }
  }, [api, playerId]);

  useEffect(() => {
    setCards(null);
    load();
  }, [load]);

  const locked = cards ? cards.filter((c) => c.locked).length : 0;
  const shown = (cards || []).filter((c) =>
    (type === 'All' || c.type === type) && (rarity === 'All' || c.rarity === rarity) && !(hideLocked && c.locked));

  return (
    <div className="page">
      <PageHeader
        title="My deck"
        actions={<button type="button" className="ghost" onClick={load}><Icon name="refresh" size={16} />Refresh</button>}
      />
      <Alert kind="error">{error}</Alert>
      {!cards && !error && <p className="muted">Loading...</p>}

      {cards && (
        <>
          <div className="toolbar">
            <p className="deck-count">{cards.length} cards, {cards.length - locked} available, {locked} locked</p>
            <FilterGroup label="Filter by type" options={TYPES} value={type} onChange={setType} />
            <FilterGroup label="Filter by rarity" options={RARITIES} value={rarity} onChange={setRarity} />
            <label className="toggle">
              <input type="checkbox" checked={hideLocked} onChange={(e) => setHideLocked(e.target.checked)} />
              Hide locked cards
            </label>
          </div>
          {shown.length === 0 ? (
            <div className="empty">No cards match these filters.</div>
          ) : (
            <div className="card-grid">
              {shown.map((card) => <TradingCard key={card.cardId} card={card} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
