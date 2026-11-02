import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import Icon from './Icon';
import TradingCard from './TradingCard';

const fmt = (n) => Number(n).toFixed(2);
const signed = (n) => (n > 0 ? `+${n}` : String(n));

function Fighter({ card, won }) {
  const bonuses = [];
  if (card.rarityBonusPct > 0) bonuses.push(`${card.rarity} +${card.rarityBonusPct}%`);
  if (card.typeAdvantage) bonuses.push(`Type advantage x${card.typeMultiplier}`);
  return (
    <div className={`fighter type-${card.type.toLowerCase()} ${won ? 'won' : ''}`}>
      <div className="fighter-head">
        <Icon name={card.type} size={16} />
        <strong>{card.name}</strong>
        <span className="muted mono">{card.cardId}</span>
      </div>
      <div className="fighter-line">{card.rarity} {card.type}, ATK {card.attack} / DEF {card.defense}</div>
      {bonuses.length > 0 && <div className="fighter-line">{bonuses.join(', ')}</div>}
      <div className="fighter-line">Effective ATK {fmt(card.effectiveAttack)}, DEF {fmt(card.effectiveDefense)}</div>
      <div className="damage">
        <span>Damage</span>
        <strong>{fmt(card.damageDealt)}</strong>
      </div>
    </div>
  );
}

export default function BattleResult({ battle }) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: 'start' });
  }, [battle.battleId]);

  const { challenger, opponent, score } = battle;
  const names = { [challenger.playerId]: challenger.username, [opponent.playerId]: opponent.username };
  const headline = battle.outcome === 'DRAW'
    ? `Draw (${score.challenger} - ${score.opponent})`
    : `${names[battle.winnerId]} wins ${Math.max(score.challenger, score.opponent)} - ${Math.min(score.challenger, score.opponent)}`;

  return (
    <section className="panel battle-result" data-testid="battle-result" ref={ref}>
      <div className={`scoreboard ${battle.outcome === 'DRAW' ? 'is-draw' : ''}`}>
        <div>
          <h2>Battle result: {headline}</h2>
          <p className="muted small mono">{battle.battleId}, tx {battle.txId.slice(0, 16)}..., {new Date(battle.timestamp).toLocaleString()}</p>
        </div>
        <Link className="ghost button" to="/ledger">View on ledger</Link>
      </div>

      <div className="result-players">
        {[challenger, opponent].map((p) => (
          <div key={p.playerId} className={`result-player result-${p.result.toLowerCase()}`}>
            <div className="rp-name">{p.username}</div>
            <div className="rp-result">{p.result}</div>
            <div className="rp-rating">{p.ratingBefore} → {p.ratingAfter} ({signed(p.ratingChange)})</div>
            <div className="muted small">
              W/L/D {p.wins} / {p.losses} / {p.draws}, streak {p.winStreak}
              {p.coinsEarned > 0 && <span className="coins-earned">+{p.coinsEarned} coins</span>}
            </div>
          </div>
        ))}
      </div>

      <h3>Rounds</h3>
      <div className="rounds">
        {battle.rounds.map((round) => (
          <div className="round" key={round.round}>
            <div className="round-label">
              Round {round.round}
              <span className="round-winner">
                {round.winner === 'DRAW' ? 'Draw' : `${names[round.winnerPlayerId]} wins`}
              </span>
            </div>
            <Fighter card={round.challengerCard} won={round.winner === 'CHALLENGER'} />
            <Fighter card={round.opponentCard} won={round.winner === 'OPPONENT'} />
          </div>
        ))}
      </div>

      <h3>XP earned</h3>
      <div className="xp-list">
        {battle.xpAwarded.map((x) => (
          <div key={x.cardId} className="xp-item">
            <span>{x.name} <span className="muted mono">{x.cardId}</span></span>
            <span className="muted">{names[x.owner] || x.owner}</span>
            <span className="xp-gain">+{x.xpGained} XP</span>
            <span className="muted">total {x.xpTotal}</span>
          </div>
        ))}
      </div>

      <h3>Reward</h3>
      {battle.reward ? (
        <div className="reward">
          <TradingCard card={battle.reward.card} />
          <dl className="reward-facts">
            <dt>Winner</dt><dd>{names[battle.winnerId]}</dd>
            <dt>Card</dt><dd>{battle.reward.card.name} ({battle.reward.card.rarity})</dd>
            <dt>Roll</dt><dd>{battle.reward.roll} / 99</dd>
            <dt>Odds</dt>
            <dd>
              Common {battle.reward.odds.Common}%, Rare {battle.reward.odds.Rare}%,
              Epic {battle.reward.odds.Epic}%, Legendary {battle.reward.odds.Legendary}%
            </dd>
          </dl>
        </div>
      ) : (
        <p className="muted">No reward for a draw.</p>
      )}
    </section>
  );
}
