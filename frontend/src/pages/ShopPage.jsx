import { useEffect, useState } from 'react';
import { errorText } from '../api';
import { useAuth } from '../auth/AuthContext';
import Alert from '../components/Alert';
import Icon from '../components/Icon';
import PageHeader from '../components/PageHeader';
import TradingCard from '../components/TradingCard';
import { useLedger } from '../ledger/LedgerContext';

const RARITIES = ['Common', 'Rare', 'Epic', 'Legendary'];

export default function ShopPage() {
  const { api, me, refreshMe } = useAuth();
  const { showReceipt, refreshSummary } = useLedger();
  const [packs, setPacks] = useState([]);
  const [opened, setOpened] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    api('/shop/packs').then(setPacks).catch((err) => setError(err.message));
  }, [api]);

  async function buy(pack) {
    setError('');
    setBusy(pack.packId);
    try {
      const data = await api('/shop/buy', { method: 'POST', body: { packId: pack.packId } });
      setOpened(data);
      showReceipt({ title: `${pack.name} opened`, txId: data.txId, blockNumber: data.blockNumber });
      await refreshMe();
    } catch (err) {
      setError(errorText(err));
      refreshSummary();
    } finally {
      setBusy('');
    }
  }

  const coins = me.player.coins;

  return (
    <div className="page">
      <PageHeader
        title="Card shop"
        actions={<span className="coin-balance" data-testid="shop-coins"><Icon name="coin" size={18} />{coins} coins</span>}
      />
      <Alert kind="error">{error}</Alert>

      <div className="pack-grid">
        {packs.map((pack) => (
          <section key={pack.packId} className={`panel pack pack-${pack.packId}`}>
            <div className="pack-art" aria-hidden="true"><Icon name="shop" size={44} /></div>
            <h2>{pack.name}</h2>
            <div className="pack-price"><Icon name="coin" size={18} />{pack.price}</div>
            <ul className="pack-odds">
              {RARITIES.filter((r) => pack.odds[r] > 0).map((r) => (
                <li key={r} className={`rarity-${r.toLowerCase()}`}><span>{r}</span><b>{pack.odds[r]}%</b></li>
              ))}
            </ul>
            <button type="button" className="primary wide" disabled={Boolean(busy)} onClick={() => buy(pack)}>
              {busy === pack.packId ? 'Opening...' : `Buy for ${pack.price}`}
            </button>
          </section>
        ))}
      </div>

      {opened && (
        <section className="panel pack-result" data-testid="pack-result">
          <h2>You got {opened.card.name}</h2>
          <div className="reward">
            <TradingCard card={opened.card} />
            <dl className="reward-facts">
              <dt>Pack</dt><dd>{opened.pack.name}</dd>
              <dt>Rarity</dt><dd>{opened.card.rarity}</dd>
              <dt>Roll</dt><dd>{opened.roll} / 99</dd>
              <dt>Coins left</dt><dd>{opened.coins}</dd>
              <dt>Block</dt><dd>#{opened.blockNumber}</dd>
            </dl>
          </div>
        </section>
      )}
    </div>
  );
}
