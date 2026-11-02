import Icon from './Icon';
import NetworkStatus from './NetworkStatus';
import ThemePicker from '../theme/ThemePicker';
import TradingCard from './TradingCard';

const SHOWCASE = [
  { cardId: 'P2-03', name: 'Inferno Drake', type: 'Fire', rarity: 'Epic', attack: 80, defense: 66, xp: 0, locked: false },
  { cardId: 'P1-04', name: 'Thunder Griffin', type: 'Air', rarity: 'Legendary', attack: 96, defense: 82, xp: 0, locked: false },
  { cardId: 'P1-02', name: 'Frost Warden', type: 'Water', rarity: 'Rare', attack: 58, defense: 62, xp: 0, locked: false },
];

export default function AuthLayout({ children }) {
  return (
    <div className="auth-shell">
      <section className="auth-brand">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true"><Icon name="ledger" size={20} /></span>
          <div className="brand-word">CardChain</div>
        </div>
        <h1>Collect, battle and trade cards on Hyperledger Fabric.</h1>
        <div className="showcase" aria-hidden="true">
          {SHOWCASE.map((card) => <TradingCard key={card.cardId} card={card} compact />)}
        </div>
        <NetworkStatus showHeight={false} />
      </section>
      <section className="auth-form">
        <ThemePicker className="auth-theme" />
        {children}
      </section>
    </div>
  );
}
