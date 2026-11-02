import { useEffect, useState } from 'react';
import Icon from './Icon';
import TradingCard from './TradingCard';

// Plays while the battle transaction is processed. The opponent's cards stay
// face down; they are only revealed in the result.
export default function BattleAnimation({ myName, opponentName, myCards, roundMs }) {
  const [round, setRound] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setRound((r) => Math.min(r + 1, 2)), roundMs);
    return () => clearInterval(id);
  }, [roundMs]);

  const card = myCards[round];
  return (
    <div className="fight-overlay" role="status" aria-live="polite" data-testid="battle-animation">
      <div className="fight-stage" style={{ '--round-ms': `${roundMs}ms` }}>
        <div className="fight-names">
          <span>{myName}</span>
          <span className="fight-vs">vs</span>
          <span>{opponentName}</span>
        </div>
        <div className="fight-round" key={`label-${round}`}>Round {round + 1}</div>
        <div className="fight-arena" key={`arena-${round}`}>
          <div className="fighter-slot left">{card && <TradingCard card={card} compact />}</div>
          <div className="impact" aria-hidden="true">
            <Icon name="battle" size={40} />
          </div>
          <div className="fighter-slot right">
            <div className="card-back" aria-label="Hidden card">
              <Icon name="ledger" size={40} />
            </div>
          </div>
        </div>
        <div className="fight-progress" aria-hidden="true">
          {[0, 1, 2].map((i) => <span key={i} className={i <= round ? 'done' : ''} />)}
        </div>
      </div>
    </div>
  );
}
