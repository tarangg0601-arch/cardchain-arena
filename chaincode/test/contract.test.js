'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const TcgContract = require('../lib/tcgContract');
const { MockLedger } = require('./mockLedger');

const MY_PICK = ['P1-04', 'P1-03', 'P1-02'];

async function freshLedger() {
    const ledger = new MockLedger();
    const contract = new TcgContract();
    await ledger.invoke(contract, 'InitLedger');
    const call = (fcn, ...args) => ledger.invoke(contract, fcn, ...args);
    return { ledger, contract, call };
}

function battle(call, myCards, opponentId = 'player2') {
    return call('Battle', 'player1', JSON.stringify(myCards), opponentId);
}

function setCard(ledger, cardId, changes) {
    const key = `CARD_${cardId}`;
    ledger.write(key, { ...ledger.read(key), ...changes });
}

// The opponent's cards are drawn at random, so outcome tests fix their stats.
function weakenPlayer2(ledger) {
    for (const id of ['P2-01', 'P2-02', 'P2-03', 'P2-04']) {
        setCard(ledger, id, { type: 'Water', rarity: 'Common', attack: 40, defense: 30 });
    }
}

function mirrorCards(ledger) {
    for (const id of ['P1-01', 'P1-02', 'P1-03', 'P2-01', 'P2-02', 'P2-03', 'P2-04']) {
        setCard(ledger, id, { type: 'Fire', rarity: 'Common', attack: 50, defense: 40 });
    }
}

test('InitLedger creates two demo players with four cards each', async () => {
    const { call } = await freshLedger();
    for (const id of ['player1', 'player2']) {
        const player = await call('GetPlayer', id);
        assert.equal(player.rating, 1000);
        assert.equal(player.wins, 0);
        assert.equal(player.losses, 0);
        assert.equal(player.winStreak, 0);
        assert.equal(player.coins, 100);
        const cards = await call('GetPlayerCards', id);
        assert.equal(cards.length, 4);
        assert.deepEqual(new Set(cards.map((c) => c.type)), new Set(['Fire', 'Water', 'Earth', 'Air']));
        for (const card of cards) {
            for (const field of ['cardId', 'name', 'owner', 'attack', 'defense', 'type', 'rarity', 'xp', 'locked']) {
                assert.ok(field in card, `card has ${field}`);
            }
        }
    }
});

test('InitLedger is idempotent and never overwrites progress', async () => {
    const { ledger, call } = await freshLedger();
    weakenPlayer2(ledger);
    await battle(call, MY_PICK);
    const before = await call('GetPlayer', 'player1');
    const second = await call('InitLedger');
    assert.deepEqual(second.created, []);
    const after = await call('GetPlayer', 'player1');
    assert.deepEqual(after, before);
    assert.equal((await call('GetLeaderboard')).length, 2);
    assert.equal((await call('GetPlayerCards', 'player1')).length, 5); // 4 seeds + 1 reward
});

test('RegisterPlayer mints two Commons and one Rare and grants starting coins', async () => {
    const { call } = await freshLedger();
    const result = await call('RegisterPlayer', 'player-abc123', 'alice');
    assert.equal(result.player.rating, 1000);
    assert.equal(result.player.coins, 100);
    assert.equal(result.cards.length, 3);
    const cards = await call('GetPlayerCards', 'player-abc123');
    assert.equal(cards.length, 3);
    assert.deepEqual(cards.map((c) => c.rarity).sort(), ['Common', 'Common', 'Rare']);
    assert.ok(cards.every((c) => c.owner === 'player-abc123' && c.xp === 0 && !c.locked));
});

test('RegisterPlayer rejects duplicate IDs, duplicate usernames and invalid input', async () => {
    const { call } = await freshLedger();
    await call('RegisterPlayer', 'player-abc123', 'alice');
    await assert.rejects(call('RegisterPlayer', 'player-abc123', 'bob'), /CONFLICT/);
    await assert.rejects(call('RegisterPlayer', 'player-zzz999', 'ALICE'), /already taken/);
    await assert.rejects(call('RegisterPlayer', 'player-zzz999', 'player1'), /already taken/);
    await assert.rejects(call('RegisterPlayer', 'bad id!', 'carol'), /INVALID_ARGUMENT/);
    await assert.rejects(call('RegisterPlayer', 'player-zzz999', 'x'), /INVALID_ARGUMENT/);
});

test('a won battle updates stats, ratings, XP and coins and mints a reward card', async () => {
    const { ledger, call } = await freshLedger();
    weakenPlayer2(ledger);
    const result = await battle(call, MY_PICK);

    assert.equal(result.outcome, 'WIN');
    assert.equal(result.winnerId, 'player1');
    assert.equal(result.rounds.length, 3);
    assert.deepEqual(result.score, { challenger: 3, opponent: 0, drawnRounds: 0 });
    assert.deepEqual(result.rounds.map((r) => r.challengerCard.cardId), MY_PICK);
    assert.equal(result.rounds[1].challengerCard.typeAdvantage, true); // Earth beats Water

    const p1 = await call('GetPlayer', 'player1');
    const p2 = await call('GetPlayer', 'player2');
    assert.deepEqual([p1.wins, p1.losses, p1.winStreak, p1.rating, p1.coins], [1, 0, 1, 1016, 120]);
    assert.deepEqual([p2.wins, p2.losses, p2.winStreak, p2.rating, p2.coins], [0, 1, 0, 984, 100]);
    assert.equal(result.challenger.ratingChange, 16);
    assert.equal(result.challenger.coinsEarned, 20);

    for (const id of MY_PICK) {
        assert.equal((await call('GetCard', id)).xp, 20);
    }
    for (const round of result.rounds) {
        assert.equal((await call('GetCard', round.opponentCard.cardId)).xp, 5);
    }
    assert.equal(result.xpAwarded.length, 6);

    const reward = result.reward.card;
    assert.equal(reward.owner, 'player1');
    assert.equal(reward.origin, 'BATTLE_REWARD');
    assert.match(reward.cardId, /^RW-/);
    assert.deepEqual(await call('GetCard', reward.cardId), reward);
    assert.equal(result.reward.odds.streakBonus, 3, 'reward odds use the post-battle win streak');

    assert.deepEqual(await call('GetBattle', result.battleId), result);
    assert.equal((await call('GetPlayerBattles', 'player2'))[0].battleId, result.battleId);
});

test("the contract draws three different, available opponent cards", async () => {
    const { ledger, call } = await freshLedger();
    setCard(ledger, 'P2-01', { locked: true, lockedByTrade: 'T-X' });
    const result = await battle(call, MY_PICK);
    const drawn = result.rounds.map((r) => r.opponentCard.cardId);
    assert.equal(new Set(drawn).size, 3);
    assert.deepEqual([...drawn].sort(), ['P2-02', 'P2-03', 'P2-04']);
});

test('battle is rejected when the opponent has fewer than 3 available cards', async () => {
    const { ledger, call } = await freshLedger();
    setCard(ledger, 'P2-01', { locked: true, lockedByTrade: 'T-X' });
    setCard(ledger, 'P2-02', { locked: true, lockedByTrade: 'T-Y' });
    const snapshot = new Map(ledger.state);
    await assert.rejects(battle(call, MY_PICK), /CONFLICT.*does not have 3 cards available/);
    assert.deepEqual(ledger.state, snapshot);
});

test('a drawn battle records a draw and issues no reward or coins', async () => {
    const { ledger, call } = await freshLedger();
    mirrorCards(ledger);
    const result = await battle(call, ['P1-01', 'P1-02', 'P1-03']);
    assert.equal(result.outcome, 'DRAW');
    assert.equal(result.winnerId, null);
    assert.equal(result.reward, null);
    const p1 = await call('GetPlayer', 'player1');
    const p2 = await call('GetPlayer', 'player2');
    assert.deepEqual([p1.wins, p1.losses, p1.draws, p1.rating, p1.coins], [0, 0, 1, 1000, 100]);
    assert.deepEqual([p2.wins, p2.losses, p2.draws, p2.rating, p2.coins], [0, 0, 1, 1000, 100]);
    assert.equal((await call('GetPlayerCards', 'player1')).length, 4);
    assert.equal((await call('GetPlayerCards', 'player2')).length, 4);
});

test('battle rejects invalid selections without changing state', async () => {
    const { ledger, call } = await freshLedger();
    const snapshot = new Map(ledger.state);
    const cases = [
        [['P1-01', 'P1-01', 'P1-02'], /same card/],
        [['P1-01', 'P1-02'], /exactly 3/],
        [['P1-01', 'P1-02', 'P2-01'], /not owned/],
        [['P1-01', 'P1-02', 'NOPE-1'], /does not exist/],
    ];
    for (const [cards, error] of cases) {
        await assert.rejects(battle(call, cards), error);
    }
    await assert.rejects(call('Battle', 'player1', '["P1-01","P1-02","P1-03"]', 'player1'), /themselves/);
    await assert.rejects(call('Battle', 'player1', 'not json', 'player2'), /JSON array/);
    await assert.rejects(battle(call, MY_PICK, 'ghost'), /NOT_FOUND/);
    assert.deepEqual(ledger.state, snapshot);
});

test('trade-locked cards cannot be used in battles', async () => {
    const { call } = await freshLedger();
    await call('CreateTrade', 'T-1', 'player1', 'P1-02', 'player2', 'P2-02');
    await assert.rejects(battle(call, MY_PICK), /locked in trade T-1/);
});

test('RewardWinner cannot be called directly to mint cards', async () => {
    const { call } = await freshLedger();
    await assert.rejects(call('RewardWinner', 'player1'), /FORBIDDEN.*Battle transaction/);
    assert.equal((await call('GetPlayerCards', 'player1')).length, 4);
});

test('CreateTrade locks both cards and AcceptTrade swaps ownership and unlocks', async () => {
    const { call } = await freshLedger();
    const trade = await call('CreateTrade', 'T-1', 'player1', 'P1-01', 'player2', 'P2-01');
    assert.equal(trade.status, 'OPEN');
    assert.equal((await call('GetCard', 'P1-01')).locked, true);
    assert.equal((await call('GetCard', 'P2-01')).lockedByTrade, 'T-1');
    assert.equal((await call('GetOpenTrades')).length, 1);

    const accepted = await call('AcceptTrade', 'T-1', 'player2');
    assert.equal(accepted.trade.status, 'ACCEPTED');
    const c1 = await call('GetCard', 'P1-01');
    const c2 = await call('GetCard', 'P2-01');
    assert.deepEqual([c1.owner, c1.locked, c1.lockedByTrade], ['player2', false, null]);
    assert.deepEqual([c2.owner, c2.locked, c2.lockedByTrade], ['player1', false, null]);
    assert.equal((await call('GetOpenTrades')).length, 0);
    assert.equal((await call('GetPlayerTrades', 'player1'))[0].status, 'ACCEPTED');
});

test('CancelTrade releases both locks and closes the trade', async () => {
    const { call } = await freshLedger();
    await call('CreateTrade', 'T-2', 'player1', 'P1-01', 'player2', 'P2-01');
    const cancelled = await call('CancelTrade', 'T-2', 'player1');
    assert.equal(cancelled.trade.status, 'CANCELLED');
    for (const [cardId, owner] of [['P1-01', 'player1'], ['P2-01', 'player2']]) {
        const card = await call('GetCard', cardId);
        assert.deepEqual([card.owner, card.locked, card.lockedByTrade], [owner, false, null]);
    }
    await assert.rejects(call('AcceptTrade', 'T-2', 'player2'), /already cancelled/);
});

test('unauthorized and conflicting trade operations are rejected without partial changes', async () => {
    const { ledger, call } = await freshLedger();
    await call('CreateTrade', 'T-3', 'player1', 'P1-01', 'player2', 'P2-01');
    const snapshot = new Map(ledger.state);

    await assert.rejects(call('AcceptTrade', 'T-3', 'player1'), /FORBIDDEN.*Only player2/);
    await assert.rejects(call('CancelTrade', 'T-3', 'player2'), /FORBIDDEN.*Only player1/);
    await assert.rejects(call('CreateTrade', 'T-3', 'player1', 'P1-02', 'player2', 'P2-02'), /already exists/);
    await assert.rejects(call('CreateTrade', 'T-4', 'player1', 'P1-01', 'player2', 'P2-02'), /locked/);
    await assert.rejects(call('CreateTrade', 'T-4', 'player1', 'P1-02', 'player2', 'P2-01'), /locked/);
    await assert.rejects(call('CreateTrade', 'T-4', 'player1', 'P2-02', 'player2', 'P1-02'), /not owned/);
    await assert.rejects(call('CreateTrade', 'T-4', 'player1', 'P1-02', 'player1', 'P1-03'), /themselves/);
    await assert.rejects(call('CreateTrade', 'T-4', 'player1', 'P1-02', 'ghost', 'P2-02'), /NOT_FOUND/);
    await assert.rejects(call('AcceptTrade', 'T-404', 'player2'), /NOT_FOUND/);
    assert.deepEqual(ledger.state, snapshot);

    await call('AcceptTrade', 'T-3', 'player2');
    await assert.rejects(call('AcceptTrade', 'T-3', 'player2'), /already accepted/);
    await assert.rejects(call('CancelTrade', 'T-3', 'player1'), /already accepted/);
});

test('leaderboard is ordered by skill rating', async () => {
    const { ledger, call } = await freshLedger();
    await call('RegisterPlayer', 'player-abc123', 'alice');
    weakenPlayer2(ledger);
    await battle(call, MY_PICK);
    const board = await call('GetLeaderboard');
    assert.deepEqual(board.map((p) => p.playerId), ['player1', 'player-abc123', 'player2']);
    assert.deepEqual(board.map((p) => p.rank), [1, 2, 3]);
});

test('GetLedgerStats counts players, cards, trades and battles', async () => {
    const { ledger, call } = await freshLedger();
    await call('RegisterPlayer', 'player-abc123', 'alice');
    weakenPlayer2(ledger);
    await battle(call, MY_PICK);
    await call('CreateTrade', 'T-1', 'player1', 'P1-01', 'player2', 'P2-01');
    const stats = await call('GetLedgerStats');
    assert.equal(stats.players, 3);
    assert.equal(stats.cards, 4 + 4 + 3 + 1);
    assert.equal(Object.values(stats.cardsByRarity).reduce((a, b) => a + b, 0), stats.cards);
    assert.equal(stats.lockedCards, 2);
    assert.equal(stats.openTrades, 1);
    assert.equal(stats.battles, 1);
});

test('requesting a card the recipient does not own is rejected by the contract', async () => {
    const { ledger, call } = await freshLedger();
    await call('RegisterPlayer', 'player-abc123', 'alice');
    const snapshot = new Map(ledger.state);
    await assert.rejects(
        call('CreateTrade', 'T-9', 'player1', 'P1-01', 'player2', 'player-abc123-S1'),
        /FORBIDDEN\] Card .+ \(player-abc123-S1\) is not owned by player2/);
    assert.deepEqual(ledger.state, snapshot);
});

test('DeclineTrade is limited to the recipient and releases both locks', async () => {
    const { call } = await freshLedger();
    await call('CreateTrade', 'T-5', 'player1', 'P1-01', 'player2', 'P2-01');
    await assert.rejects(call('DeclineTrade', 'T-5', 'player1'), /FORBIDDEN.*Only player2 can decline/);
    const declined = await call('DeclineTrade', 'T-5', 'player2');
    assert.equal(declined.trade.status, 'DECLINED');
    for (const [cardId, owner] of [['P1-01', 'player1'], ['P2-01', 'player2']]) {
        const card = await call('GetCard', cardId);
        assert.deepEqual([card.owner, card.locked], [owner, false]);
    }
    await assert.rejects(call('AcceptTrade', 'T-5', 'player2'), /already declined/);
});

test('GetAllCards lists every card on the ledger', async () => {
    const { call } = await freshLedger();
    await call('RegisterPlayer', 'player-abc123', 'alice');
    const cards = await call('GetAllCards');
    assert.equal(cards.length, 11);
    assert.equal(cards[0].rarity, 'Legendary');
});

test('BuyCardPack spends coins and mints a card with the pack odds', async () => {
    const { call } = await freshLedger();
    const packs = await call('GetCardPacks');
    assert.deepEqual(packs.map((p) => p.packId), ['standard', 'premium', 'elite']);

    const bought = await call('BuyCardPack', 'player1', 'premium');
    assert.equal(bought.coins, 25);
    assert.equal(bought.card.owner, 'player1');
    assert.equal(bought.card.origin, 'PACK');
    assert.match(bought.card.cardId, /^PK-/);
    assert.notEqual(bought.card.rarity, 'Common');
    assert.equal((await call('GetPlayer', 'player1')).coins, 25);
    assert.equal((await call('GetPlayerCards', 'player1')).length, 5);

    await assert.rejects(call('BuyCardPack', 'player1', 'standard'), /CONFLICT.*costs 30 coins but player1 has 25/);
    await assert.rejects(call('BuyCardPack', 'player1', 'mystery'), /Unknown card pack/);
    assert.equal((await call('GetPlayer', 'player1')).coins, 25);
});

test('elite packs only contain Epic or Legendary cards', async () => {
    const { ledger, call } = await freshLedger();
    for (let i = 0; i < 20; i++) {
        ledger.write('PLAYER_player2', { ...ledger.read('PLAYER_player2'), coins: 1000 });
        const { card } = await call('BuyCardPack', 'player2', 'elite');
        assert.ok(['Epic', 'Legendary'].includes(card.rarity), card.rarity);
    }
});

test('friend requests can be sent by username and accepted only by the recipient', async () => {
    const { call } = await freshLedger();
    await call('RegisterPlayer', 'player-abc123', 'alice');
    const request = await call('SendFriendRequest', 'F-1', 'player1', 'alice');
    assert.equal(request.status, 'PENDING');
    assert.equal(request.toPlayer, 'player-abc123');

    await assert.rejects(call('SendFriendRequest', 'F-2', 'player1', 'alice'), /already pending/);
    await assert.rejects(call('SendFriendRequest', 'F-2', 'player-abc123', 'player1'), /already pending/);
    await assert.rejects(call('SendFriendRequest', 'F-2', 'player1', 'player1'), /yourself/);
    await assert.rejects(call('SendFriendRequest', 'F-2', 'player1', 'nobody'), /NOT_FOUND.*No player is called nobody/);

    const aliceView = await call('GetFriends', 'player-abc123');
    assert.equal(aliceView.incoming.length, 1);
    assert.equal((await call('GetFriends', 'player1')).outgoing.length, 1);

    await assert.rejects(call('RespondFriendRequest', 'F-1', 'player1', 'ACCEPT'), /FORBIDDEN.*Only alice/);
    await call('RespondFriendRequest', 'F-1', 'player-abc123', 'ACCEPT');
    assert.deepEqual((await call('GetFriends', 'player1')).friends.map((f) => f.username), ['alice']);
    assert.deepEqual((await call('GetFriends', 'player-abc123')).friends.map((f) => f.username), ['player1']);
    assert.equal((await call('GetFriends', 'player1')).outgoing.length, 0);

    await assert.rejects(call('SendFriendRequest', 'F-3', 'player-abc123', 'player1'), /already friends/);
    await assert.rejects(call('RespondFriendRequest', 'F-1', 'player-abc123', 'ACCEPT'), /already accepted/);

    await call('RemoveFriend', 'player1', 'player-abc123');
    assert.equal((await call('GetFriends', 'player-abc123')).friends.length, 0);
    await assert.rejects(call('RemoveFriend', 'player1', 'player-abc123'), /NOT_FOUND/);
});

test('a declined friend request does not create a friendship', async () => {
    const { call } = await freshLedger();
    await call('SendFriendRequest', 'F-1', 'player1', 'player2');
    const declined = await call('RespondFriendRequest', 'F-1', 'player2', 'DECLINE');
    assert.equal(declined.status, 'DECLINED');
    assert.equal((await call('GetFriends', 'player1')).friends.length, 0);
    await call('SendFriendRequest', 'F-2', 'player1', 'player2');
});
