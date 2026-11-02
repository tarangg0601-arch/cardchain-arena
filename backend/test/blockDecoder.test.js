'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { decodeBlock, blockHeaderHash } = require('../src/ledger/blockDecoder');

// Blocks 9 and 10 were fetched from a real two-org Fabric 2.5 network running
// this chaincode (peer channel fetch). Block 9 holds a Battle transaction.
const block9 = decodeBlock(fs.readFileSync(path.join(__dirname, 'fixtures/fabric-block-9.block')));
const block10 = decodeBlock(fs.readFileSync(path.join(__dirname, 'fixtures/fabric-block-10.block')));

test('decodes the transaction, creator, endorsers and write set of a real block', () => {
    assert.equal(block9.number, 9);
    assert.equal(block9.simulated, false);
    assert.equal(block9.transactions.length, 1);
    const tx = block9.transactions[0];
    assert.equal(tx.type, 'ENDORSER_TRANSACTION');
    assert.equal(tx.validationCode, 'VALID');
    assert.equal(tx.chaincode, 'tcg');
    assert.equal(tx.function, 'Battle');
    assert.deepEqual(tx.args.slice(0, 1), ['player1']);
    assert.deepEqual(JSON.parse(tx.args[1]), ['P1-04', 'P1-03', 'P1-02']);
    assert.deepEqual(tx.creator, { mspId: 'Org1MSP', name: 'User1@org1.example.com' });
    assert.deepEqual(tx.endorsers.map((e) => e.mspId).sort(), ['Org1MSP', 'Org2MSP']);
    assert.match(tx.txId, /^[0-9a-f]{64}$/);
    assert.ok(tx.writes.some((w) => w.key.startsWith('BATTLE_B-')));
    assert.ok(tx.writes.some((w) => w.key === 'PLAYER_player1'));
});

test('recomputed hashes match the hashes Fabric stored in the chain', () => {
    assert.equal(block9.computedDataHash, block9.dataHash);
    assert.equal(block10.computedDataHash, block10.dataHash);
    // Block 10 stores the hash of block 9 as its previous hash.
    assert.equal(block9.hash, block10.previousHash);
});

test('a changed header produces a different block hash', () => {
    const prev = Buffer.from(block9.previousHash, 'hex');
    const data = Buffer.from(block9.dataHash, 'hex');
    assert.equal(blockHeaderHash(9, prev, data), block9.hash);
    assert.notEqual(blockHeaderHash(10, prev, data), block9.hash);
    data[0] ^= 1;
    assert.notEqual(blockHeaderHash(9, prev, data), block9.hash);
});
