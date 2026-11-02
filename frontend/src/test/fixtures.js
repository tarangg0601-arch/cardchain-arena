import { vi } from 'vitest';
import { ApiError } from '../api';

export const player1 = { playerId: 'player1', username: 'player1', rating: 1000, wins: 0, losses: 0, draws: 0, winStreak: 0 };
export const player2 = { playerId: 'player2', username: 'player2', rating: 1000, wins: 0, losses: 0, draws: 0, winStreak: 0 };

export function card(cardId, owner, extra = {}) {
  return {
    cardId, owner, name: `Card ${cardId}`, type: 'Fire', rarity: 'Common',
    attack: 50, defense: 40, xp: 0, locked: false, lockedByTrade: null, origin: 'SEED', ...extra,
  };
}

export const p1Cards = [
  card('P1-01', 'player1', { name: 'Ember Fox' }),
  card('P1-02', 'player1', { name: 'Frost Warden', type: 'Water', rarity: 'Rare' }),
  card('P1-03', 'player1', { name: 'Granite Titan', type: 'Earth', rarity: 'Epic' }),
  card('P1-04', 'player1', { name: 'Thunder Griffin', type: 'Air', rarity: 'Legendary', locked: true, lockedByTrade: 'T-OLD' }),
];

export const p2Cards = [
  card('P2-01', 'player2', { name: 'Moss Golem', type: 'Earth' }),
  card('P2-02', 'player2', { name: 'Wind Dancer', type: 'Air', rarity: 'Rare' }),
  card('P2-03', 'player2', { name: 'Inferno Drake', rarity: 'Epic' }),
];

// Builds an api() mock from a table of "METHOD /path" handlers.
export function mockApi(routes) {
  return vi.fn(async (path, options = {}) => {
    const key = `${options.method || 'GET'} ${path}`;
    const handler = routes[key];
    if (!handler) throw new ApiError(404, 'NOT_FOUND', `No mock for ${key}`);
    return typeof handler === 'function' ? handler(options.body) : handler;
  });
}

export function battleResult() {
  const side = (playerId, role, result, before, after) => ({
    playerId, username: playerId, role, result, ratingBefore: before, ratingAfter: after,
    ratingChange: after - before, wins: result === 'WIN' ? 1 : 0, losses: result === 'LOSS' ? 1 : 0, draws: 0, winStreak: result === 'WIN' ? 1 : 0,
  });
  const cardSide = (c, damage, adv = false) => ({
    cardId: c.cardId, name: c.name, type: c.type, rarity: c.rarity, attack: c.attack, defense: c.defense,
    rarityBonusPct: 0, typeAdvantage: adv, typeMultiplier: adv ? 1.2 : 1, effectiveAttack: 50, effectiveDefense: 40, damageDealt: damage,
  });
  return {
    battleId: 'B-ABC123', txId: 'f'.repeat(64), timestamp: '2026-10-19T10:00:00.000Z',
    challengerId: 'player1', opponentId: 'player2',
    challenger: side('player1', 'CHALLENGER', 'LOSS', 1000, 984),
    opponent: side('player2', 'OPPONENT', 'WIN', 1000, 1016),
    rounds: [0, 1, 2].map((i) => ({
      round: i + 1,
      challengerCard: cardSide(p1Cards[i], 0),
      opponentCard: cardSide(p2Cards[i], 12.5, i === 0),
      winner: 'OPPONENT', winnerPlayerId: 'player2', xp: { challengerCard: 5, opponentCard: 20 },
    })),
    score: { challenger: 0, opponent: 3, drawnRounds: 0 },
    outcome: 'WIN', winnerId: 'player2', loserId: 'player1',
    xpAwarded: [...p1Cards.slice(0, 3), ...p2Cards].map((c, i) => ({ cardId: c.cardId, name: c.name, owner: c.owner, xpGained: i < 3 ? 5 : 20, xpTotal: i < 3 ? 5 : 20 })),
    reward: {
      card: card('RW-XYZ', 'player2', { name: 'Solar Wyrm', rarity: 'Legendary', origin: 'BATTLE_REWARD' }),
      roll: 97,
      odds: { Common: 57, Rare: 30, Epic: 11, Legendary: 2, skillBonus: 0, streakBonus: 3 },
    },
  };
}
