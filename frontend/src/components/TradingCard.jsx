import CardArt from './CardArt';
import Icon from './Icon';

const ORIGIN_LABELS = {
  SEED: 'Demo starter',
  STARTER: 'Starter card',
  BATTLE_REWARD: 'Battle reward',
  PACK: 'Card pack',
};

function CardBody({ card, compact, selectedIndex, anonymous }) {
  return (
    <>
      <div className="tc-band">
        <span className="tc-type"><Icon name={card.type} size={15} />{card.type}</span>
        <span className="tc-rarity">{card.rarity}</span>
      </div>
      <div className="tc-art" aria-hidden="true">
        <CardArt card={card} />
      </div>
      <div className="tc-name">{card.name}</div>
      <div className="tc-id">{card.cardId}</div>
      <div className="tc-stats">
        <div><span className="tc-stat-label">ATK</span><span className="tc-stat-value">{card.attack}</span></div>
        <div><span className="tc-stat-label">DEF</span><span className="tc-stat-value">{card.defense}</span></div>
        {!anonymous && <div><span className="tc-stat-label">XP</span><span className="tc-stat-value">{card.xp}</span></div>}
      </div>
      {!anonymous && (
        <div className={card.locked ? 'tc-status locked' : 'tc-status'}>
          {card.locked ? <><Icon name="lock" size={13} />Locked in trade {card.lockedByTrade}</> : 'Available'}
        </div>
      )}
      {!compact && card.origin && <div className="tc-origin">{ORIGIN_LABELS[card.origin] || card.origin}</div>}
      {selectedIndex >= 0 && <div className="tc-pick">Round {selectedIndex + 1}</div>}
    </>
  );
}

// anonymous hides XP and lock status, for cards whose owner is not shown.
export default function TradingCard({ card, compact = false, selectable = false, selectedIndex = -1, onToggle, anonymous = false }) {
  const className = [
    'trading-card',
    `type-${card.type.toLowerCase()}`,
    `rarity-${card.rarity.toLowerCase()}`,
    compact ? 'compact' : '',
    selectedIndex >= 0 ? 'selected' : '',
    card.locked ? 'is-locked' : '',
  ].join(' ');

  if (!selectable) {
    return (
      <div className={className} data-testid={`card-${card.cardId}`}>
        <CardBody card={card} compact={compact} selectedIndex={selectedIndex} anonymous={anonymous} />
      </div>
    );
  }
  return (
    <button
      type="button"
      className={`${className} selectable`}
      disabled={card.locked}
      aria-pressed={selectedIndex >= 0}
      data-testid={`card-${card.cardId}`}
      onClick={() => onToggle(card.cardId)}
    >
      <CardBody card={card} compact={compact} selectedIndex={selectedIndex} anonymous={anonymous} />
    </button>
  );
}
