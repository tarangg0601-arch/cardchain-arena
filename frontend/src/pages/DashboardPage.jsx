import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import Alert from '../components/Alert';
import Icon from '../components/Icon';
import PageHeader from '../components/PageHeader';
import TradingCard from '../components/TradingCard';
import { useLedger } from '../ledger/LedgerContext';
import { describeTx, short } from '../ledger/format';

export default function DashboardPage() {
  const { api, me, status } = useAuth();
  const { summary, summaryError } = useLedger();
  const player = me.player;
  const [cards, setCards] = useState(null);
  const [blocks, setBlocks] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api(`/players/${player.playerId}/cards`), api('/ledger/blocks?limit=6')])
      .then(([myCards, page]) => {
        setCards(myCards);
        setBlocks(page.blocks);
      })
      .catch((err) => setError(err.message));
  }, [api, player.playerId, summary?.height]);

  const fabric = status?.ledger.mode === 'fabric';
  const stats = [
    { label: 'Coins', value: player.coins },
    { label: 'Rating', value: player.rating },
    { label: 'Cards owned', value: cards?.length },
    { label: fabric ? 'Block height' : 'Local blocks', value: summary?.height },
    { label: 'Players', value: summary?.stats.players },
    { label: 'Battles', value: summary?.stats.battles },
  ];

  return (
    <div className="page">
      <PageHeader
        title={`Welcome back, ${player.username}`}
        actions={<Link className="button" to="/battle"><Icon name="battle" size={16} />Start a battle</Link>}
      />
      <Alert kind="error">{error || summaryError}</Alert>

      <section className="stat-strip" aria-label="Statistics">
        {stats.map((s) => (
          <div className="stat" key={s.label}>
            <span className="stat-value">{s.value ?? '-'}</span>
            <span className="stat-label">{s.label}</span>
          </div>
        ))}
      </section>

      <div className="dash-grid">
        <section className="panel">
          <div className="panel-head">
            <h2>My cards</h2>
            <Link to="/deck">Open deck</Link>
          </div>
          {cards && cards.length === 0 && <div className="empty">No cards yet. <Link to="/shop">Visit the card shop</Link></div>}
          <div className="card-grid compact-grid">
            {(cards || []).map((card) => <TradingCard key={card.cardId} card={card} compact />)}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>Latest blocks</h2>
            <Link to="/ledger">Open explorer</Link>
          </div>
          <ul className="mini-chain">
            {blocks.map((block) => (
              <li key={block.number}>
                <Link to={`/ledger?block=${block.number}`} className="mini-block">
                  <span className="mini-num">#{block.number}</span>
                  <span className="mini-tx">
                    {block.transactions.length === 0 ? 'Genesis' : describeTx(block.transactions[0])}
                  </span>
                  <span className="mini-hash">{short(block.hash, 8)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
