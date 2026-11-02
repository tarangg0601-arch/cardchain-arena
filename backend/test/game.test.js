'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, login, bearer, MY_PICK, MIRROR_PICK, weakenPlayer2, mirrorCards } = require('./helpers');

async function demoSetup() {
    const ctx = await setup();
    ctx.p1 = bearer(await login(ctx.request, 'player1'));
    ctx.p2 = bearer(await login(ctx.request, 'player2'));
    return ctx;
}

test('player, card and leaderboard reads return ledger data', async () => {
    const { request, p1 } = await demoSetup();
    const player = await request.get('/api/players/player2').set(p1).expect(200);
    assert.equal(player.body.username, 'player2');
    const cards = await request.get('/api/players/player1/cards').set(p1).expect(200);
    assert.equal(cards.body.length, 4);
    const board = await request.get('/api/leaderboard').set(p1).expect(200);
    assert.deepEqual(board.body.map((p) => p.playerId).sort(), ['player1', 'player2']);
    const missing = await request.get('/api/players/nobody').set(p1);
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, 'NOT_FOUND');
});

test('a won battle updates ratings, records, XP and coins and grants a reward card', async () => {
    const { request, p1, ledger } = await demoSetup();
    weakenPlayer2(ledger);
    const res = await request.post('/api/battles').set(p1)
        .send({ opponentId: 'player2', myCardIds: MY_PICK });
    assert.equal(res.status, 201);
    const battle = res.body.battle;
    assert.equal(battle.challengerId, 'player1');
    assert.equal(battle.winnerId, 'player1');
    assert.equal(battle.challenger.ratingAfter, 1016);
    assert.equal(battle.opponent.ratingAfter, 984);
    assert.ok(res.body.txId);

    const player1 = (await request.get('/api/players/player1').set(p1)).body;
    assert.deepEqual([player1.wins, player1.losses, player1.winStreak, player1.rating, player1.coins], [1, 0, 1, 1016, 120]);
    const cards = (await request.get('/api/players/player1/cards').set(p1)).body;
    assert.equal(cards.length, 5);
    assert.ok(cards.some((c) => c.cardId === battle.reward.card.cardId));
    assert.equal(cards.find((c) => c.cardId === 'P1-04').xp, 20);

    const stored = await request.get(`/api/battles/${battle.battleId}`).set(p1).expect(200);
    assert.deepEqual(stored.body, battle);
    const mine = await request.get('/api/battles/mine').set(p1).expect(200);
    assert.equal(mine.body[0].battleId, battle.battleId);
});

test('a drawn battle gives no reward', async () => {
    const { request, p1, ledger } = await demoSetup();
    mirrorCards(ledger);
    const res = await request.post('/api/battles').set(p1)
        .send({ opponentId: 'player2', myCardIds: MIRROR_PICK });
    assert.equal(res.status, 201);
    assert.equal(res.body.battle.outcome, 'DRAW');
    assert.equal(res.body.battle.reward, null);
    const cards = (await request.get('/api/players/player1/cards').set(p1)).body;
    assert.equal(cards.length, 4);
});

test('battles are always fought as the logged-in player', async () => {
    const { request, p2 } = await demoSetup();
    // player2 tries to start a battle using player1's cards as their own.
    const res = await request.post('/api/battles').set(p2)
        .send({ challengerId: 'player1', opponentId: 'player1', myCardIds: MY_PICK });
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');

    const bad = await request.post('/api/battles').set(p2).send({ opponentId: 'player1', myCardIds: ['P2-01'] });
    assert.equal(bad.status, 400);
    const dup = await request.post('/api/battles').set(p2)
        .send({ opponentId: 'player1', myCardIds: ['P2-01', 'P2-01', 'P2-02'] });
    assert.equal(dup.status, 400);
    assert.match(dup.body.error.message, /same card/);
});

test('trade create locks cards and accept swaps owners for the recipient only', async () => {
    const { request, p1, p2 } = await demoSetup();
    const created = await request.post('/api/trades').set(p1)
        .send({ toPlayer: 'player2', offeredCardId: 'P1-01', requestedCardId: 'P2-01' });
    assert.equal(created.status, 201);
    const tradeId = created.body.trade.tradeId;
    assert.match(tradeId, /^T-[0-9A-F]{8}$/);

    const locked = (await request.get('/api/players/player1/cards').set(p1)).body.find((c) => c.cardId === 'P1-01');
    assert.equal(locked.locked, true);
    const open = await request.get('/api/trades/open').set(p2).expect(200);
    assert.equal(open.body.length, 1);

    const byCreator = await request.post(`/api/trades/${tradeId}/accept`).set(p1);
    assert.equal(byCreator.status, 403);

    const accepted = await request.post(`/api/trades/${tradeId}/accept`).set(p2);
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.trade.status, 'ACCEPTED');

    const p1Cards = (await request.get('/api/players/player1/cards').set(p1)).body;
    const p2Cards = (await request.get('/api/players/player2/cards').set(p1)).body;
    assert.ok(p1Cards.some((c) => c.cardId === 'P2-01' && !c.locked));
    assert.ok(p2Cards.some((c) => c.cardId === 'P1-01' && !c.locked));
    assert.equal((await request.get('/api/trades/open').set(p1)).body.length, 0);
    assert.equal((await request.get('/api/trades/mine').set(p2)).body[0].status, 'ACCEPTED');
});

test('trade cancel is limited to the creator and releases the locks', async () => {
    const { request, p1, p2 } = await demoSetup();
    const created = await request.post('/api/trades').set(p2)
        .send({ toPlayer: 'player1', offeredCardId: 'P2-02', requestedCardId: 'P1-02' });
    const tradeId = created.body.trade.tradeId;

    const byOther = await request.post(`/api/trades/${tradeId}/cancel`).set(p1);
    assert.equal(byOther.status, 403);

    const cancelled = await request.post(`/api/trades/${tradeId}/cancel`).set(p2);
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.trade.status, 'CANCELLED');
    const card = (await request.get('/api/players/player1/cards').set(p1)).body.find((c) => c.cardId === 'P1-02');
    assert.deepEqual([card.owner, card.locked], ['player1', false]);
});

test('invalid trade requests are rejected with clear errors', async () => {
    const { request, p1 } = await demoSetup();
    const notMine = await request.post('/api/trades').set(p1)
        .send({ toPlayer: 'player2', offeredCardId: 'P2-03', requestedCardId: 'P2-01' });
    assert.equal(notMine.status, 403);
    const missing = await request.post('/api/trades').set(p1).send({ toPlayer: 'player2' });
    assert.equal(missing.status, 400);
    const self = await request.post('/api/trades').set(p1)
        .send({ toPlayer: 'player1', offeredCardId: 'P1-01', requestedCardId: 'P1-02' });
    assert.equal(self.status, 400);
    const unknown = await request.post('/api/trades/T-DOESNOTEXIST/accept').set(p1);
    assert.equal(unknown.status, 404);
});

test('RewardWinner cannot be called outside a battle', async () => {
    const { ledger } = await setup();
    await assert.rejects(ledger.submit('RewardWinner', 'player1'), (err) => err.status === 403);
    const cards = await ledger.evaluate('GetPlayerCards', 'player1');
    assert.equal(cards.length, 4);
});

test('the browser cannot choose the opponent cards; the contract draws them', async () => {
    const { request, p1 } = await demoSetup();
    const res = await request.post('/api/battles').set(p1)
        .send({ opponentId: 'player2', myCardIds: MY_PICK, opponentCardIds: ['P2-01', 'P2-01', 'P2-01'] });
    assert.equal(res.status, 201);
    const drawn = res.body.battle.rounds.map((r) => r.opponentCard.cardId);
    assert.equal(new Set(drawn).size, 3);
    assert.ok(drawn.every((id) => id.startsWith('P2-')));
});

test('the card catalog lists other players cards without owners', async () => {
    const { request, p1 } = await demoSetup();
    const catalog = (await request.get('/api/cards/catalog').set(p1).expect(200)).body;
    assert.equal(catalog.length, 4);
    assert.ok(catalog.every((c) => c.cardId.startsWith('P2-')));
    assert.ok(catalog.every((c) => !('owner' in c) && !('locked' in c)));
});

test('asking for a card the recipient does not own is rejected by the contract', async () => {
    const { request, p1 } = await demoSetup();
    await request.post('/api/auth/register').send({ username: 'alice', password: 'secret123' }).expect(201);
    const catalog = (await request.get('/api/cards/catalog').set(p1)).body;
    const alicesCard = catalog.find((c) => c.cardId.endsWith('-S1'));
    const res = await request.post('/api/trades').set(p1)
        .send({ toPlayer: 'player2', offeredCardId: 'P1-01', requestedCardId: alicesCard.cardId });
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
    assert.match(res.body.error.message, /is not owned by player2/);
    const card = (await request.get('/api/players/player1/cards').set(p1)).body.find((c) => c.cardId === 'P1-01');
    assert.equal(card.locked, false);
});

test('the recipient can decline a trade request and the notification count updates', async () => {
    const { request, p1, p2 } = await demoSetup();
    const created = await request.post('/api/trades').set(p1)
        .send({ toPlayer: 'player2', offeredCardId: 'P1-01', requestedCardId: 'P2-01' });
    const tradeId = created.body.trade.tradeId;
    assert.equal((await request.get('/api/me/notifications').set(p2)).body.tradeRequests, 1);
    assert.equal((await request.post(`/api/trades/${tradeId}/decline`).set(p1)).status, 403);
    const declined = await request.post(`/api/trades/${tradeId}/decline`).set(p2).expect(200);
    assert.equal(declined.body.trade.status, 'DECLINED');
    assert.equal((await request.get('/api/me/notifications').set(p2)).body.tradeRequests, 0);
});

test('new accounts get coins and can buy card packs', async () => {
    const { request } = await setup();
    const reg = await request.post('/api/auth/register').send({ username: 'alice', password: 'secret123' }).expect(201);
    assert.equal(reg.body.player.coins, 100);
    const token = bearer(reg.body.token);
    const packs = (await request.get('/api/shop/packs').set(token).expect(200)).body;
    assert.equal(packs[0].packId, 'standard');

    const bought = await request.post('/api/shop/buy').set(token).send({ packId: 'standard' }).expect(201);
    assert.equal(bought.body.coins, 70);
    assert.ok(Number.isInteger(bought.body.blockNumber));
    assert.equal((await request.get(`/api/players/${reg.body.account.playerId}/cards`).set(token)).body.length, 4);

    await request.post('/api/shop/buy').set(token).send({ packId: 'premium' }).expect(409);
    assert.equal((await request.get('/api/auth/me').set(token)).body.player.coins, 70);
});

test('friend requests by username, accept, decline and remove', async () => {
    const { request, p1, p2 } = await demoSetup();
    const sent = await request.post('/api/friends/requests').set(p1).send({ username: 'player2' }).expect(201);
    const requestId = sent.body.request.requestId;
    assert.equal((await request.get('/api/me/notifications').set(p2)).body.friendRequests, 1);
    assert.equal((await request.post('/api/friends/requests').set(p1).send({ username: 'player2' })).status, 409);
    assert.equal((await request.post('/api/friends/requests').set(p1).send({ username: 'ghost' })).status, 404);
    assert.equal((await request.post(`/api/friends/requests/${requestId}/accept`).set(p1)).status, 403);

    await request.post(`/api/friends/requests/${requestId}/accept`).set(p2).expect(200);
    const friends = (await request.get('/api/friends').set(p1)).body;
    assert.deepEqual(friends.friends.map((f) => f.username), ['player2']);

    await request.post('/api/friends/player2/remove').set(p1).expect(200);
    assert.equal((await request.get('/api/friends').set(p2)).body.friends.length, 0);

    const again = await request.post('/api/friends/requests').set(p2).send({ username: 'player1' }).expect(201);
    await request.post(`/api/friends/requests/${again.body.request.requestId}/decline`).set(p1).expect(200);
    assert.equal((await request.get('/api/friends').set(p1)).body.friends.length, 0);
});
