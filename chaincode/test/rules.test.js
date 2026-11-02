'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../lib/rules');

test('type advantage follows Fire > Air > Earth > Water > Fire', () => {
    assert.ok(rules.hasTypeAdvantage('Fire', 'Air'));
    assert.ok(rules.hasTypeAdvantage('Air', 'Earth'));
    assert.ok(rules.hasTypeAdvantage('Earth', 'Water'));
    assert.ok(rules.hasTypeAdvantage('Water', 'Fire'));
    assert.ok(!rules.hasTypeAdvantage('Air', 'Fire'));
    assert.ok(!rules.hasTypeAdvantage('Fire', 'Earth'));
    assert.ok(!rules.hasTypeAdvantage('Fire', 'Fire'));
});

test('advantaged card gets a 1.2x attack multiplier and rarity bonus applies to both stats', () => {
    const fire = { type: 'Fire', rarity: 'Rare', attack: 50, defense: 40 };
    const air = { type: 'Air', rarity: 'Common', attack: 50, defense: 40 };
    const stats = rules.battleStats(fire, air);
    assert.equal(stats.typeAdvantage, true);
    assert.equal(stats.typeMultiplier, 1.2);
    assert.equal(stats.rarityBonusPct, 5);
    assert.equal(stats.effectiveAttack, 6300); // 50 * 1.05 * 1.2 = 63.00
    assert.equal(stats.effectiveDefense, 4200); // 40 * 1.05 = 42.00
});

test('round winner is the card that deals more damage; equal damage is a draw', () => {
    const strong = { type: 'Earth', rarity: 'Epic', attack: 80, defense: 70 };
    const weak = { type: 'Fire', rarity: 'Common', attack: 45, defense: 35 };
    assert.equal(rules.resolveRound(strong, weak).result, 'A');
    assert.equal(rules.resolveRound(weak, strong).result, 'B');
    const mirror = { type: 'Water', rarity: 'Common', attack: 45, defense: 45 };
    assert.equal(rules.resolveRound(mirror, { ...mirror, type: 'Air' }).result, 'DRAW');
});

test('Elo update is zero-sum and draws between equal ratings change nothing', () => {
    assert.deepEqual(rules.updateRatings(1000, 1000, 1), { newA: 1016, newB: 984, changeA: 16, changeB: -16 });
    assert.deepEqual(rules.updateRatings(1000, 1000, 0.5), { newA: 1000, newB: 1000, changeA: 0, changeB: 0 });
    const upset = rules.updateRatings(900, 1200, 1);
    assert.ok(upset.changeA > 16, 'beating a stronger player earns more points');
});

test('reward odds always total 100 and improve with rating and streak', () => {
    for (const rating of [500, 1000, 1100, 1400, 2000]) {
        for (const streak of [0, 1, 3, 5, 10]) {
            const odds = rules.rewardOdds(rating, streak);
            assert.equal(odds.Common + odds.Rare + odds.Epic + odds.Legendary, 100);
            assert.ok(odds.Common >= 25);
        }
    }
    const base = rules.rewardOdds(1000, 1);
    const veteran = rules.rewardOdds(1400, 5);
    assert.ok(veteran.Legendary > base.Legendary);
    assert.ok(veteran.Epic > base.Epic);
    assert.ok(veteran.Common < base.Common);
});

test('pickRarity maps rolls onto cumulative weights', () => {
    const odds = { Common: 60, Rare: 28, Epic: 10, Legendary: 2 };
    assert.equal(rules.pickRarity(0, odds), 'Common');
    assert.equal(rules.pickRarity(59, odds), 'Common');
    assert.equal(rules.pickRarity(60, odds), 'Rare');
    assert.equal(rules.pickRarity(88, odds), 'Epic');
    assert.equal(rules.pickRarity(99, odds), 'Legendary');
});

test('generated cards are deterministic and inside their rarity range', () => {
    const a = rules.generateCardAttributes('seed-1', 'Epic');
    const b = rules.generateCardAttributes('seed-1', 'Epic');
    assert.deepEqual(a, b);
    for (const rarity of rules.RARITIES) {
        for (let i = 0; i < 50; i++) {
            const card = rules.generateCardAttributes(`seed-${rarity}-${i}`, rarity);
            const base = rules.BASE_STATS[rarity];
            assert.ok(rules.TYPES.includes(card.type));
            assert.ok(card.attack >= base.attack && card.attack < base.attack + rules.STAT_SPREAD);
            assert.ok(card.defense >= base.defense && card.defense < base.defense + rules.STAT_SPREAD);
            assert.ok(rules.CARD_NAMES[card.type][rarity].includes(card.name));
        }
    }
});

test('starter plan gives two Commons and one Rare of three different types', () => {
    const plan = rules.starterCardPlan('player-abc123');
    assert.deepEqual(plan.map((c) => c.rarity), ['Common', 'Common', 'Rare']);
    assert.equal(new Set(plan.map((c) => c.type)).size, 3);
    assert.deepEqual(plan.map((c) => c.cardId), ['player-abc123-S1', 'player-abc123-S2', 'player-abc123-S3']);
    assert.deepEqual(rules.starterCardPlan('player-abc123'), plan);
});

test('drawCards picks the same cards for the same seed and differs across seeds', () => {
    const cards = ['a', 'b', 'c', 'd', 'e', 'f'].map((cardId) => ({ cardId }));
    const first = rules.drawCards(cards, 'tx-1').map((c) => c.cardId);
    assert.deepEqual(rules.drawCards(cards, 'tx-1').map((c) => c.cardId), first);
    assert.equal(new Set(first).size, 3);
    const seen = new Set();
    for (let i = 0; i < 20; i++) {
        seen.add(rules.drawCards(cards, `tx-${i}`).map((c) => c.cardId).join(','));
    }
    assert.ok(seen.size > 5);
});

test('card pack odds add up to 100', () => {
    for (const pack of rules.CARD_PACKS) {
        assert.equal(Object.values(pack.odds).reduce((a, b) => a + b, 0), 100, pack.packId);
    }
});
