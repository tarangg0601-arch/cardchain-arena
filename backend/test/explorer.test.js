'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const { LocalLedger } = require('../src/ledger/localLedger');
const { verifyChain } = require('../src/ledger/explorer');
const { setup, login, bearer, MY_PICK, weakenPlayer2 } = require('./helpers');

test('every committed transaction appears in the block log with its write set', async () => {
    const { request, ledger } = await setup();
    weakenPlayer2(ledger);
    const p1 = bearer(await login(request, 'player1'));
    const battle = await request.post('/api/battles').set(p1)
        .send({ opponentId: 'player2', myCardIds: MY_PICK });
    assert.equal(battle.status, 201);
    assert.ok(Number.isInteger(battle.body.blockNumber));

    const page = await request.get('/api/ledger/blocks?limit=3').set(p1).expect(200);
    const latest = page.body.blocks[0];
    assert.equal(latest.number, battle.body.blockNumber);
    assert.equal(latest.hash, page.body.currentBlockHash);
    assert.equal(latest.simulated, true);
    const tx = latest.transactions[0];
    assert.equal(tx.txId, battle.body.txId);
    assert.equal(tx.function, 'Battle');
    assert.equal(tx.valid, true);
    const keys = tx.writes.map((w) => w.key);
    assert.ok(keys.includes('PLAYER_player1'));
    assert.ok(keys.includes('CARD_P1-04'));
    assert.ok(keys.includes(`CARD_${battle.body.battle.reward.card.cardId}`));
    assert.equal(page.body.blocks[1].hash, latest.previousHash);

    const single = await request.get(`/api/ledger/blocks/${latest.number}`).set(p1).expect(200);
    assert.equal(single.body.hash, latest.hash);
    await request.get('/api/ledger/blocks/9999').set(p1).expect(404);

    const summary = await request.get('/api/ledger/summary').set(p1).expect(200);
    assert.equal(summary.body.network.mode, 'local');
    assert.equal(summary.body.stats.players, 2);
    assert.equal(summary.body.stats.battles, 1);
    assert.equal(summary.body.counts.invalid, 0);
    assert.equal(summary.body.lastGameTx.function, 'Battle');
});

test('chain verification passes, then detects an edited block', async () => {
    const { request, config } = await setup();
    const p1 = bearer(await login(request, 'player1'));
    await request.post('/api/trades').set(p1).send({ toPlayer: 'player2', offeredCardId: 'P1-01', requestedCardId: 'P2-01' });

    const ok = await request.get('/api/ledger/verify').set(p1).expect(200);
    assert.equal(ok.body.valid, true);
    assert.ok(ok.body.blocksChecked >= 3);

    // Someone edits an old transaction in the ledger file.
    const file = JSON.parse(await fs.readFile(config.localLedgerFile, 'utf8'));
    file.blocks[1].transactions[0].function = 'RewardWinner';
    await fs.writeFile(config.localLedgerFile, JSON.stringify(file));
    const tampered = await verifyChain(await LocalLedger.open(config.localLedgerFile));
    assert.equal(tampered.valid, false);
    assert.equal(tampered.problems[0].block, 1);

    // Recomputing the edited block's hashes still breaks the link to block 2.
    const crypto = require('crypto');
    const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
    const b1 = file.blocks[1];
    b1.dataHash = sha(JSON.stringify(b1.transactions));
    b1.hash = sha(`${b1.number}|${b1.previousHash}|${b1.dataHash}`);
    await fs.writeFile(config.localLedgerFile, JSON.stringify(file));
    const relinked = await verifyChain(await LocalLedger.open(config.localLedgerFile));
    assert.equal(relinked.valid, false);
    assert.match(relinked.problems.map((p) => p.issue).join(' '), /Previous-hash link does not match block 1/);
});

test('rejected writes are listed with the reason and never reach a block', async () => {
    const { request } = await setup();
    const p1 = bearer(await login(request, 'player1'));
    const before = (await request.get('/api/ledger/summary').set(p1)).body.height;
    const res = await request.post('/api/trades').set(p1).send({ toPlayer: 'player2', offeredCardId: 'P2-02', requestedCardId: 'P2-01' });
    assert.equal(res.status, 403);

    const rejected = await request.get('/api/ledger/rejected').set(p1).expect(200);
    assert.equal(rejected.body.length, 1);
    assert.equal(rejected.body[0].function, 'CreateTrade');
    assert.equal(rejected.body[0].code, 'FORBIDDEN');
    assert.equal(rejected.body[0].stage, 'Rejected by contract');
    assert.equal((await request.get('/api/ledger/summary').set(p1)).body.height, before);
});

test('explorer routes require login', async () => {
    const { request } = await setup();
    for (const path of ['/api/ledger/summary', '/api/ledger/blocks', '/api/ledger/verify', '/api/ledger/rejected']) {
        assert.equal((await request.get(path)).status, 401, path);
    }
});
