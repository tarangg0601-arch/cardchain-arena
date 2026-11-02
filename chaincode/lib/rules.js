'use strict';

const crypto = require('crypto');

const TYPES = ['Fire', 'Water', 'Earth', 'Air'];
const RARITIES = ['Common', 'Rare', 'Epic', 'Legendary'];

// Type cycle Fire > Air > Earth > Water > Fire: each key beats its value.
const BEATS = { Fire: 'Air', Air: 'Earth', Earth: 'Water', Water: 'Fire' };
const TYPE_ADVANTAGE_PCT = 120;

// Percentage added to both attack and defense during a battle.
const RARITY_BONUS_PCT = { Common: 0, Rare: 5, Epic: 10, Legendary: 15 };

// Minimum base stats per rarity. Generated cards add 0-19 to each value.
const BASE_STATS = {
    Common: { attack: 40, defense: 30 },
    Rare: { attack: 55, defense: 45 },
    Epic: { attack: 70, defense: 60 },
    Legendary: { attack: 85, defense: 75 },
};
const STAT_SPREAD = 20;

const CARD_NAMES = {
    Fire: {
        Common: ['Ember Fox', 'Cinder Imp'],
        Rare: ['Magma Hound', 'Blaze Lancer'],
        Epic: ['Inferno Drake', 'Pyre Knight'],
        Legendary: ['Phoenix Sovereign', 'Solar Wyrm'],
    },
    Water: {
        Common: ['Tide Sprite', 'Reef Crab'],
        Rare: ['Coral Serpent', 'Frost Warden'],
        Epic: ['Tidal Leviathan', 'Glacier Mage'],
        Legendary: ['Abyssal Kraken', 'Ocean Empress'],
    },
    Earth: {
        Common: ['Moss Golem', 'Burrow Mole'],
        Rare: ['Granite Ram', 'Thorn Guardian'],
        Epic: ['Granite Titan', 'Quake Behemoth'],
        Legendary: ['Mountain King', 'Ancient Treant'],
    },
    Air: {
        Common: ['Gale Sprite', 'Sky Finch'],
        Rare: ['Storm Falcon', 'Wind Dancer'],
        Epic: ['Tempest Roc', 'Cyclone Djinn'],
        Legendary: ['Thunder Griffin', 'Sky Emperor'],
    },
};

const STARTING_RATING = 1000;
const RATING_FLOOR = 100;
const ELO_K = 32;

const XP_PER_ROUND = { WIN: 20, DRAW: 10, LOSS: 5 };

// Reward weights out of 100 before the skill and streak bonus is applied.
const BASE_REWARD_WEIGHTS = { Common: 60, Rare: 28, Epic: 10, Legendary: 2 };

const STARTING_COINS = 100;
const BATTLE_WIN_COINS = 20;

// Card packs sold in the shop. Each pack mints one card; odds are out of 100.
const CARD_PACKS = [
    { packId: 'standard', name: 'Standard pack', price: 30, odds: { Common: 70, Rare: 24, Epic: 5, Legendary: 1 } },
    { packId: 'premium', name: 'Premium pack', price: 75, odds: { Common: 0, Rare: 60, Epic: 32, Legendary: 8 } },
    { packId: 'elite', name: 'Elite pack', price: 150, odds: { Common: 0, Rare: 0, Epic: 70, Legendary: 30 } },
];

function sha256(text) {
    return crypto.createHash('sha256').update(text).digest();
}

function generateCardAttributes(seedText, rarity, type) {
    if (!RARITIES.includes(rarity)) {
        throw new Error(`Unknown rarity ${rarity}`);
    }
    const bytes = sha256(seedText);
    const cardType = type || TYPES[bytes[0] % TYPES.length];
    const names = CARD_NAMES[cardType][rarity];
    const base = BASE_STATS[rarity];
    return {
        name: names[bytes[1] % names.length],
        type: cardType,
        rarity,
        attack: base.attack + (bytes[2] % STAT_SPREAD),
        defense: base.defense + (bytes[3] % STAT_SPREAD),
    };
}

// Two Commons and one Rare, each of a different type, derived only from the player ID.
function starterCardPlan(playerId) {
    const firstType = sha256(`starter-types:${playerId}`)[0] % TYPES.length;
    return ['Common', 'Common', 'Rare'].map((rarity, i) => ({
        cardId: `${playerId}-S${i + 1}`,
        ...generateCardAttributes(`starter:${playerId}:${i + 1}`, rarity, TYPES[(firstType + i) % TYPES.length]),
    }));
}

function hasTypeAdvantage(type, opposingType) {
    return BEATS[type] === opposingType;
}

// Battle numbers are integers in hundredths (6300 means 63.00) so that every
// peer computes exactly the same result without floating point rounding.
function battleStats(card, opposingCard) {
    const rarityBonusPct = RARITY_BONUS_PCT[card.rarity];
    const typeAdvantage = hasTypeAdvantage(card.type, opposingCard.type);
    const typePct = typeAdvantage ? TYPE_ADVANTAGE_PCT : 100;
    return {
        rarityBonusPct,
        typeAdvantage,
        typeMultiplier: typePct / 100,
        effectiveAttack: (card.attack * (100 + rarityBonusPct) * typePct) / 100,
        effectiveDefense: card.defense * (100 + rarityBonusPct),
    };
}

// Each card's damage is its effective attack minus the other card's effective
// defense (never below zero). The card that deals more damage wins the round.
function resolveRound(cardA, cardB) {
    const a = battleStats(cardA, cardB);
    const b = battleStats(cardB, cardA);
    a.damage = Math.max(0, a.effectiveAttack - b.effectiveDefense);
    b.damage = Math.max(0, b.effectiveAttack - a.effectiveDefense);
    let result = 'DRAW';
    if (a.damage > b.damage) {
        result = 'A';
    } else if (b.damage > a.damage) {
        result = 'B';
    }
    return { a, b, result };
}

function expectedScore(rating, opponentRating) {
    return 1 / (1 + Math.pow(10, (opponentRating - rating) / 400));
}

// Standard Elo update. scoreA is 1 for a win, 0.5 for a draw and 0 for a loss.
function updateRatings(ratingA, ratingB, scoreA) {
    const change = Math.round(ELO_K * (scoreA - expectedScore(ratingA, ratingB)));
    const newA = Math.max(RATING_FLOOR, ratingA + change);
    const newB = Math.max(RATING_FLOOR, ratingB - change);
    return { newA, newB, changeA: newA - ratingA, changeB: newB - ratingB };
}

// Skill bonus: +1 per 20 rating points above 1000 (max 20).
// Streak bonus: +3 per consecutive win (max 5 wins = 15).
// The bonus is moved from the Common weight to the Rare, Epic and Legendary weights.
function rewardOdds(rating, winStreak) {
    const skillBonus = Math.min(20, Math.max(0, Math.floor((rating - STARTING_RATING) / 20)));
    const streakBonus = Math.min(5, Math.max(0, winStreak)) * 3;
    const bonus = skillBonus + streakBonus;
    const toLegendary = Math.floor(bonus / 5);
    const toEpic = Math.floor(bonus / 3);
    return {
        Common: BASE_REWARD_WEIGHTS.Common - bonus,
        Rare: BASE_REWARD_WEIGHTS.Rare + bonus - toLegendary - toEpic,
        Epic: BASE_REWARD_WEIGHTS.Epic + toEpic,
        Legendary: BASE_REWARD_WEIGHTS.Legendary + toLegendary,
        skillBonus,
        streakBonus,
    };
}

function pickRarity(roll, odds) {
    let threshold = 0;
    for (const rarity of RARITIES) {
        threshold += odds[rarity];
        if (roll < threshold) {
            return rarity;
        }
    }
    return 'Legendary';
}

function rarityRank(rarity) {
    return RARITIES.indexOf(rarity);
}

// The opponent's three battle cards are drawn by the contract, so the
// challenger never sees them. Sorting by a hash of the transaction ID gives
// the same random order on every peer.
function drawCards(cards, seed, count = 3) {
    return cards
        .map((card) => ({ card, key: sha256(`${seed}:${card.cardId}`).toString('hex') }))
        .sort((a, b) => a.key.localeCompare(b.key))
        .slice(0, count)
        .map((entry) => entry.card);
}

module.exports = {
    TYPES,
    RARITIES,
    BEATS,
    TYPE_ADVANTAGE_PCT,
    RARITY_BONUS_PCT,
    BASE_STATS,
    STAT_SPREAD,
    CARD_NAMES,
    STARTING_RATING,
    RATING_FLOOR,
    ELO_K,
    XP_PER_ROUND,
    BASE_REWARD_WEIGHTS,
    STARTING_COINS,
    BATTLE_WIN_COINS,
    CARD_PACKS,
    sha256,
    generateCardAttributes,
    starterCardPlan,
    hasTypeAdvantage,
    battleStats,
    resolveRound,
    expectedScore,
    updateRatings,
    rewardOdds,
    pickRarity,
    rarityRank,
    drawCards,
};
