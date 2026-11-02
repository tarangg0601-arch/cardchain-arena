'use strict';

const crypto = require('crypto');
const path = require('path');
const { TcgGame, GameError, READ_TRANSACTIONS, WRITE_TRANSACTIONS } = require('../../../chaincode/lib/tcgGame');
const { AppError, fromChaincodeMessage } = require('../errors');
const { readJson, writeJson } = require('../jsonFile');

const FILE_FORMAT = 'tcg-local-ledger/1';

// The local ledger keeps a hash-linked log of committed transactions so the
// explorer can show and verify it. It is a simulation: one transaction per
// block, no peers, no endorsement and no consensus.
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');
const localDataHash = (transactions) => sha256(JSON.stringify(transactions));
const localBlockHash = (number, previousHash, dataHash) => sha256(`${number}|${previousHash}|${dataHash}`);

function makeBlock(number, previousHash, transactions, timestamp) {
    const dataHash = localDataHash(transactions);
    return { number, hash: localBlockHash(number, previousHash, dataHash), previousHash, dataHash, timestamp, transactions };
}

// A stub with the same methods the contract uses on a Fabric peer. Reads see
// only committed state; writes are buffered until the transaction succeeds.
class LocalStub {
    constructor(state, fcn, args) {
        this.state = state;
        this.fcn = fcn;
        this.args = args;
        this.writes = new Map();
        this.txId = crypto.randomBytes(32).toString('hex');
        this.timestampMs = Date.now();
    }

    getFunctionAndParameters() {
        return { fcn: this.fcn, params: this.args };
    }

    getTxID() {
        return this.txId;
    }

    getTxTimestamp() {
        return { seconds: Math.floor(this.timestampMs / 1000), nanos: (this.timestampMs % 1000) * 1e6 };
    }

    async getState(key) {
        const value = this.state.get(key);
        return value === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(value), 'utf8');
    }

    async putState(key, value) {
        if (typeof key !== 'string' || key.length === 0) {
            throw new Error('State key must be a non-empty string');
        }
        this.writes.set(key, JSON.parse(Buffer.from(value).toString('utf8')));
    }

    async deleteState(key) {
        this.writes.set(key, null);
    }

    async getStateByRange(startKey, endKey) {
        const state = this.state;
        const keys = [...state.keys()].filter((k) => k >= startKey && (!endKey || k < endKey)).sort();
        let index = 0;
        return {
            async next() {
                if (index >= keys.length) {
                    return { done: true };
                }
                const key = keys[index++];
                return { value: { key, value: Buffer.from(JSON.stringify(state.get(key)), 'utf8') }, done: false };
            },
            async close() {},
        };
    }
}

class LocalLedger {
    constructor(file, data) {
        this.mode = 'local';
        this.file = file;
        this.game = new TcgGame();
        this.state = new Map(Object.entries(data.state || {}));
        this.txCount = data.txCount || 0;
        this.lastTxId = data.lastTxId || null;
        this.blocks = Array.isArray(data.blocks) && data.blocks.length
            ? data.blocks
            : [makeBlock(0, '', [], new Date().toISOString())];
        this.queue = Promise.resolve();
    }

    static async open(file) {
        const data = await readJson(file);
        if (data && data.format !== FILE_FORMAT) {
            throw new Error(`${file} is not a local ledger file (expected format ${FILE_FORMAT})`);
        }
        const ledger = new LocalLedger(file, data || {});
        if (!data) {
            await ledger.persist();
        }
        return ledger;
    }

    describe() {
        return { mode: 'local', localLedgerFile: path.basename(this.file), transactions: this.txCount };
    }

    async evaluate(fcn, ...args) {
        if (!READ_TRANSACTIONS.includes(fcn)) {
            throw new AppError(400, 'UNKNOWN_TRANSACTION', `${fcn} is not a read-only transaction`);
        }
        const stub = new LocalStub(this.state, fcn, args.map(String));
        return this.run(stub, fcn, args);
    }

    // Write transactions run one at a time. State and the JSON file are only
    // updated if the contract function completes without throwing.
    submit(fcn, ...args) {
        const run = async () => {
            if (!WRITE_TRANSACTIONS.includes(fcn)) {
                throw new AppError(400, 'UNKNOWN_TRANSACTION', `${fcn} is not a write transaction`);
            }
            const stub = new LocalStub(this.state, fcn, args.map(String));
            const result = await this.run(stub, fcn, args);
            const previous = new Map(this.state);
            for (const [key, value] of stub.writes) {
                if (value === null) {
                    this.state.delete(key);
                } else {
                    this.state.set(key, value);
                }
            }
            const timestamp = new Date(stub.timestampMs).toISOString();
            const last = this.blocks[this.blocks.length - 1];
            const block = makeBlock(this.blocks.length, last.hash, [{
                txId: stub.txId,
                type: 'ENDORSER_TRANSACTION',
                timestamp,
                creator: { mspId: 'LocalLedger', name: 'tcg-backend' },
                validationCode: 'VALID',
                valid: true,
                chaincode: 'tcg',
                function: fcn,
                args: args.map(String),
                endorsers: [],
                writes: [...stub.writes.entries()].map(([key, value]) => ({ key, isDelete: value === null })),
            }], timestamp);
            this.blocks.push(block);
            this.txCount += 1;
            this.lastTxId = stub.txId;
            try {
                await this.persist();
            } catch (err) {
                this.state = previous;
                this.blocks.pop();
                this.txCount -= 1;
                throw new AppError(500, 'LEDGER_WRITE_FAILED', `Could not save the local ledger: ${err.message}`);
            }
            return { result, txId: stub.txId, blockNumber: block.number };
        };
        const next = this.queue.then(run, run);
        this.queue = next.catch(() => {});
        return next;
    }

    async run(stub, fcn, args) {
        const ctx = { stub };
        try {
            const result = await this.game[fcn](ctx, ...args.map(String));
            return JSON.parse(JSON.stringify(result));
        } catch (err) {
            if (err instanceof GameError) {
                throw fromChaincodeMessage(err.message);
            }
            throw err;
        }
    }

    async persist() {
        const state = Object.fromEntries([...this.state.entries()].sort(([a], [b]) => a.localeCompare(b)));
        await writeJson(this.file, {
            format: FILE_FORMAT,
            note: 'Local demonstration ledger. This is NOT a blockchain; it runs the same contract code against a JSON file.',
            txCount: this.txCount,
            lastTxId: this.lastTxId,
            updatedAt: new Date().toISOString(),
            state,
            blocks: this.blocks,
        });
    }

    async getChainInfo() {
        const last = this.blocks[this.blocks.length - 1];
        return { height: this.blocks.length, currentBlockHash: last.hash, previousBlockHash: last.previousHash };
    }

    async getBlock(number) {
        const block = this.blocks[number];
        if (!block) {
            throw new AppError(404, 'NOT_FOUND', `Block ${number} does not exist`);
        }
        return {
            ...block,
            computedHash: localBlockHash(block.number, block.previousHash, localDataHash(block.transactions)),
            computedDataHash: localDataHash(block.transactions),
            simulated: true,
        };
    }

    async close() {
        await this.queue;
    }
}

module.exports = { LocalLedger, LocalStub };
