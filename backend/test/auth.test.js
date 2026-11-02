'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const { setup, login, bearer } = require('./helpers');

test('registration creates an account, a ledger player and the starter cards', async () => {
    const { request } = await setup();
    const res = await request.post('/api/auth/register')
        .send({ username: 'alice', password: 'secret123', confirmPassword: 'secret123' });
    assert.equal(res.status, 201);
    assert.match(res.body.account.playerId, /^player-[0-9a-f]{6}$/);
    assert.equal(res.body.player.username, 'alice');
    assert.equal(res.body.player.rating, 1000);
    assert.deepEqual(res.body.starterCards.map((c) => c.rarity).sort(), ['Common', 'Common', 'Rare']);

    const token = res.body.token;
    const me = await request.get('/api/auth/me').set(bearer(token));
    assert.equal(me.status, 200);
    assert.equal(me.body.player.playerId, res.body.account.playerId);

    const cards = await request.get(`/api/players/${res.body.account.playerId}/cards`).set(bearer(token));
    assert.equal(cards.body.length, 3);
    assert.ok(cards.body.every((c) => c.owner === res.body.account.playerId));
});

test('registration validates input and rejects duplicate usernames', async () => {
    const { request } = await setup();
    await request.post('/api/auth/register').send({ username: 'alice', password: 'secret123' }).expect(201);

    const cases = [
        [{ username: 'ALICE', password: 'secret123' }, 409, 'USERNAME_TAKEN'],
        [{ username: 'player1', password: 'secret123' }, 409, 'USERNAME_TAKEN'],
        [{ username: 'a', password: 'secret123' }, 400, 'INVALID_USERNAME'],
        [{ username: 'bad name', password: 'secret123' }, 400, 'INVALID_USERNAME'],
        [{ username: 'bob', password: 'short1' }, 400, 'INVALID_PASSWORD'],
        [{ username: 'bob', password: 'lettersonly' }, 400, 'INVALID_PASSWORD'],
        [{ username: 'bob', password: 'secret123', confirmPassword: 'secret124' }, 400, 'PASSWORD_MISMATCH'],
    ];
    for (const [body, status, code] of cases) {
        const res = await request.post('/api/auth/register').send(body);
        assert.equal(res.status, status, JSON.stringify(body));
        assert.equal(res.body.error.code, code);
    }
});

test('a failed ledger registration does not leave a login account behind', async () => {
    const { request, ledger, auth } = await setup();
    const realSubmit = ledger.submit.bind(ledger);
    ledger.submit = async (fcn, ...args) => {
        if (fcn === 'RegisterPlayer') {
            const { AppError } = require('../src/errors');
            throw new AppError(503, 'LEDGER_UNAVAILABLE', 'The Fabric network is unavailable');
        }
        return realSubmit(fcn, ...args);
    };
    const res = await request.post('/api/auth/register').send({ username: 'carol', password: 'secret123' });
    assert.equal(res.status, 503);
    assert.equal(res.body.token, undefined);
    assert.equal(auth.findByUsername('carol'), null);

    ledger.submit = realSubmit;
    await request.post('/api/auth/register').send({ username: 'carol', password: 'secret123' }).expect(201);
});

test('login, logout and access restrictions', async () => {
    const { request } = await setup();
    await request.post('/api/auth/register').send({ username: 'alice', password: 'secret123' }).expect(201);

    const wrong = await request.post('/api/auth/login').send({ username: 'alice', password: 'nope12345' });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.body.error.code, 'INVALID_CREDENTIALS');
    assert.equal((await request.post('/api/auth/login').send({ username: 'ghost', password: 'x1234567' })).status, 401);
    assert.equal((await request.post('/api/auth/login').send({})).status, 400);

    const noToken = await request.get('/api/players/player1');
    assert.equal(noToken.status, 401);
    assert.equal(noToken.body.error.code, 'NOT_AUTHENTICATED');
    const badToken = await request.post('/api/trades').set(bearer('made-up-token')).send({});
    assert.equal(badToken.body.error.code, 'INVALID_SESSION');

    const token = await login(request, 'Alice', 'secret123');
    await request.get('/api/auth/me').set(bearer(token)).expect(200);
    await request.post('/api/auth/logout').set(bearer(token)).expect(200);
    const after = await request.get('/api/auth/me').set(bearer(token));
    assert.equal(after.status, 401);
    assert.equal(after.body.error.code, 'INVALID_SESSION');
});

test('sessions expire after their lifetime', async () => {
    let clock = Date.now();
    const { request } = await setup({ now: () => clock });
    const token = await login(request, 'player1');
    await request.get('/api/auth/me').set(bearer(token)).expect(200);
    clock += 61 * 60 * 1000;
    const res = await request.get('/api/auth/me').set(bearer(token));
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'SESSION_EXPIRED');
});

test('repeated failed logins are temporarily blocked', async () => {
    const { request } = await setup();
    for (let i = 0; i < 5; i++) {
        await request.post('/api/auth/login').send({ username: 'player1', password: 'wrong1234' }).expect(401);
    }
    const blocked = await request.post('/api/auth/login').send({ username: 'player1', password: 'demo1234' });
    assert.equal(blocked.status, 429);
});

test('demo login only works for seeded demo players and only in demo mode', async () => {
    const { request } = await setup();
    const res = await request.post('/api/auth/demo-login').send({ playerId: 'player2' });
    assert.equal(res.status, 200);
    assert.equal(res.body.account.playerId, 'player2');
    assert.equal(res.body.account.isDemo, true);

    const reg = await request.post('/api/auth/register').send({ username: 'alice', password: 'secret123' });
    const impersonate = await request.post('/api/auth/demo-login').send({ playerId: reg.body.account.playerId });
    assert.equal(impersonate.status, 403);
    assert.equal(impersonate.body.error.code, 'NOT_A_DEMO_ACCOUNT');

    const accounts = await request.get('/api/auth/demo-accounts');
    assert.deepEqual(accounts.body.accounts.map((a) => a.playerId), ['player1', 'player2']);

    const disabled = await setup({ demoMode: false });
    const blocked = await disabled.request.post('/api/auth/demo-login').send({ playerId: 'player1' });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.error.code, 'DEMO_DISABLED');
    assert.deepEqual((await disabled.request.get('/api/auth/demo-accounts')).body.accounts, []);
});

test('passwords and session tokens are kept off the ledger', async () => {
    const { request, config } = await setup();
    const reg = await request.post('/api/auth/register').send({ username: 'alice', password: 'VerySecret99' });
    const ledgerText = await fs.readFile(config.localLedgerFile, 'utf8');
    const authText = await fs.readFile(config.authFile, 'utf8');
    assert.ok(!ledgerText.includes('VerySecret99'));
    assert.ok(!ledgerText.includes('scrypt$'));
    assert.ok(!ledgerText.includes(reg.body.token));
    assert.ok(!authText.includes('VerySecret99'));
    assert.ok(!authText.includes(reg.body.token), 'only a hash of the session token is stored');
    assert.ok(authText.includes('scrypt$'));
});

test('a reset ledger re-creates the player for an existing account on login', async () => {
    const first = await setup();
    const reg = await first.request.post('/api/auth/register').send({ username: 'alice', password: 'secret123' });
    const { LocalLedger } = require('../src/ledger/localLedger');
    const freshLedger = await LocalLedger.open(`${first.dir}/reset-ledger.json`);
    const second = await setup({ ledger: freshLedger, dir: first.dir });
    const token = await login(second.request, 'alice', 'secret123');
    const me = await second.request.get('/api/auth/me').set(bearer(token));
    assert.equal(me.body.player.playerId, reg.body.account.playerId);
    const cards = await second.request.get(`/api/players/${reg.body.account.playerId}/cards`).set(bearer(token));
    assert.equal(cards.body.length, 3);
});
