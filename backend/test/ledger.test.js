'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');
const { CommitError, EndorseError, StatusCode } = require('@hyperledger/fabric-gateway');
const grpc = require('@grpc/grpc-js');
const { LocalLedger } = require('../src/ledger/localLedger');
const { FabricLedger } = require('../src/ledger/fabricLedger');
const { createLedger, ensureSeedData } = require('../src/ledger');
const { loadConfig } = require('../src/config');
const { tempDir, silentLog, setup, login, bearer, MY_PICK, weakenPlayer2 } = require('./helpers');

test('the local ledger persists players, cards, XP, ratings, rewards and trades across restarts', async () => {
    const dir = await tempDir();
    const file = path.join(dir, 'ledger.json');
    const first = await LocalLedger.open(file);
    await ensureSeedData(first);
    await first.submit('RegisterPlayer', 'player-aaaaaa', 'alice');
    weakenPlayer2(first);
    const { result: battle } = await first.submit('Battle', 'player1', JSON.stringify(MY_PICK), 'player2');
    await first.submit('CreateTrade', 'T-PERSIST1', 'player2', 'P2-01', 'player-aaaaaa', 'player-aaaaaa-S1');
    await first.close();

    const second = await LocalLedger.open(file);
    assert.equal(second.txCount, first.txCount);
    const p1 = await second.evaluate('GetPlayer', 'player1');
    assert.equal(p1.rating, 1016);
    assert.equal(p1.wins, 1);
    assert.equal((await second.evaluate('GetCard', 'P1-04')).xp, 20);
    assert.equal((await second.evaluate('GetCard', battle.reward.card.cardId)).owner, 'player1');
    assert.equal((await second.evaluate('GetPlayer', 'player-aaaaaa')).username, 'alice');
    const trades = await second.evaluate('GetOpenTrades');
    assert.equal(trades[0].tradeId, 'T-PERSIST1');
    assert.equal((await second.evaluate('GetCard', 'P2-01')).locked, true);

    // Restarting must not re-seed or reset anything.
    assert.equal(await ensureSeedData(second), null);
    assert.equal((await second.evaluate('GetPlayer', 'player1')).rating, 1016);
});

test('a rejected transaction leaves the ledger file untouched', async () => {
    const dir = await tempDir();
    const file = path.join(dir, 'ledger.json');
    const ledger = await LocalLedger.open(file);
    await ensureSeedData(ledger);
    const before = await fs.readFile(file, 'utf8');
    await assert.rejects(ledger.submit('CreateTrade', 'T-X', 'player1', 'P1-01', 'player2', 'P1-02'), (err) => err.status === 403);
    await assert.rejects(ledger.submit('AcceptTrade', 'T-NONE', 'player2'), (err) => err.status === 404);
    assert.equal(await fs.readFile(file, 'utf8'), before);
});

test('write transactions cannot be run as reads, and unknown names are refused', async () => {
    const ledger = await LocalLedger.open(path.join(await tempDir(), 'l.json'));
    await assert.rejects(ledger.evaluate('InitLedger'), /not a read-only/);
    await assert.rejects(ledger.submit('GetPlayer', 'player1'), /not a write/);
    await assert.rejects(ledger.submit('constructor'), /not a write/);
});

test('a corrupted local ledger file is reported instead of being reset', async () => {
    const file = path.join(await tempDir(), 'bad.json');
    await fs.writeFile(file, '{ not json');
    await assert.rejects(LocalLedger.open(file), /not valid JSON/);
    assert.equal(await fs.readFile(file, 'utf8'), '{ not json');
});

test('auto mode falls back to the local ledger when Fabric is unreachable', async () => {
    const dir = await tempDir();
    const config = loadConfig({ DATA_DIR: dir, LEDGER_MODE: 'auto', FABRIC_CRYPTO_PATH: path.join(dir, 'missing') });
    const { ledger, fallbackReason, requestedMode } = await createLedger(config, silentLog);
    assert.equal(requestedMode, 'auto');
    assert.equal(ledger.mode, 'local');
    assert.match(fallbackReason, /credentials not found/);
});

test('fabric mode fails instead of silently using the local ledger', async () => {
    const dir = await tempDir();
    const config = loadConfig({ DATA_DIR: dir, LEDGER_MODE: 'fabric', FABRIC_CRYPTO_PATH: path.join(dir, 'missing') });
    await assert.rejects(createLedger(config, silentLog));
    await assert.rejects(fs.access(config.localLedgerFile));
});

function fakeFabricLedger(contract) {
    return new FabricLedger({
        client: { close() {} },
        gateway: { close() {} },
        contract,
        config: { channel: 'mychannel', chaincode: 'tcg', mspId: 'Org1MSP', peerEndpoint: 'localhost:7051' },
    });
}

function submitFlow({ status, endorseError }) {
    return {
        newProposal: () => ({
            async endorse() {
                if (endorseError) {
                    throw endorseError;
                }
                return {
                    async submit() {
                        return {
                            getStatus: async () => status,
                            getResult: () => Buffer.from(JSON.stringify({ trade: 'should not be returned' })),
                        };
                    },
                };
            },
        }),
    };
}

test('a Fabric write is not reported as successful when the commit is invalid', async () => {
    const ledger = fakeFabricLedger(submitFlow({
        status: { successful: false, code: StatusCode.MVCC_READ_CONFLICT, transactionId: 'tx123', blockNumber: 7n },
    }));
    await assert.rejects(ledger.submit('CreateTrade', 'T-1', 'a', 'b', 'c', 'd'), (err) => {
        assert.equal(err.status, 409);
        assert.equal(err.code, 'TX_NOT_COMMITTED');
        assert.match(err.message, /MVCC_READ_CONFLICT/);
        return true;
    });
});

test('a Fabric write returns its result only after a VALID commit status', async () => {
    const ledger = fakeFabricLedger(submitFlow({
        status: { successful: true, code: StatusCode.VALID, transactionId: 'tx999', blockNumber: 12n },
    }));
    const out = await ledger.submit('CreateTrade', 'T-1', 'a', 'b', 'c', 'd');
    assert.deepEqual(out, { result: { trade: 'should not be returned' }, txId: 'tx999', blockNumber: 12 });
});

test('Fabric endorsement and connection errors map to the same API errors as local mode', async () => {
    const chaincodeRejection = new EndorseError({
        code: grpc.status.ABORTED,
        details: [{ address: 'peer0:7051', mspId: 'Org1MSP', message: 'chaincode response 500, [CONFLICT] Card P1-01 is already locked in trade T-1' }],
        cause: new Error('aborted'),
        transactionId: 'tx1',
        message: '10 ABORTED: failed to endorse transaction, see attached details for more info',
    });
    await assert.rejects(fakeFabricLedger(submitFlow({ endorseError: chaincodeRejection })).submit('CreateTrade'), (err) => {
        assert.equal(err.status, 409);
        assert.equal(err.code, 'CONFLICT');
        assert.equal(err.message, 'Card P1-01 is already locked in trade T-1');
        return true;
    });

    const unavailable = new EndorseError({
        code: grpc.status.UNAVAILABLE, details: [], cause: new Error('down'), transactionId: 'tx2', message: '14 UNAVAILABLE: No connection established',
    });
    await assert.rejects(fakeFabricLedger(submitFlow({ endorseError: unavailable })).submit('Battle'), (err) => err.status === 503);

    const commitError = new CommitError({ code: StatusCode.ENDORSEMENT_POLICY_FAILURE, transactionId: 'tx3', message: 'bad' });
    await assert.rejects(fakeFabricLedger(submitFlow({ endorseError: commitError })).submit('Battle'), (err) => err.code === 'TX_NOT_COMMITTED');
});

test('the API returns an error, not a success, when the ledger rejects a write', async () => {
    const { request, ledger } = await setup();
    const token = bearer(await login(request, 'player1'));
    const { AppError } = require('../src/errors');
    ledger.submit = async () => {
        throw new AppError(409, 'TX_NOT_COMMITTED', 'Transaction tx1 was rejected by the network (MVCC_READ_CONFLICT).');
    };
    const res = await request.post('/api/battles').set(token)
        .send({ opponentId: 'player2', myCardIds: MY_PICK });
    assert.equal(res.status, 409);
    assert.equal(res.body.battle, undefined);
    assert.equal(res.body.error.code, 'TX_NOT_COMMITTED');
});
