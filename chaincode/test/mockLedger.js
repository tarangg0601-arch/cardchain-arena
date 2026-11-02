'use strict';

const crypto = require('crypto');

// Minimal in-memory imitation of a Fabric peer for unit tests. Like Fabric,
// a transaction only sees committed state, and its writes are applied only
// if the transaction function finishes without throwing.
class MockLedger {
    constructor() {
        this.state = new Map();
        this.clock = Date.UTC(2026, 0, 1) / 1000;
        this.txCount = 0;
    }

    async invoke(contract, fcn, ...args) {
        const stub = new MockStub(this, fcn, args);
        const ctx = { stub };
        const result = await contract[fcn](ctx, ...args);
        for (const [key, value] of stub.writes) {
            if (value === null) {
                this.state.delete(key);
            } else {
                this.state.set(key, value);
            }
        }
        return typeof result === 'string' ? JSON.parse(result) : result;
    }

    read(key) {
        const value = this.state.get(key);
        return value ? JSON.parse(value.toString('utf8')) : null;
    }

    write(key, object) {
        this.state.set(key, Buffer.from(JSON.stringify(object)));
    }
}

class MockStub {
    constructor(ledger, fcn, args) {
        ledger.txCount += 1;
        this.ledger = ledger;
        this.fcn = fcn;
        this.args = args;
        this.writes = new Map();
        this.txId = crypto.createHash('sha256').update(`tx-${ledger.txCount}`).digest('hex');
        this.seconds = ledger.clock + ledger.txCount;
    }

    getFunctionAndParameters() {
        return { fcn: this.fcn, params: this.args.map(String) };
    }

    getTxID() {
        return this.txId;
    }

    getTxTimestamp() {
        const seconds = this.seconds;
        return { seconds: { low: seconds, toNumber: () => seconds }, nanos: 0 };
    }

    async getState(key) {
        return this.ledger.state.get(key) || Buffer.alloc(0);
    }

    async putState(key, value) {
        if (typeof key !== 'string' || key.length === 0) {
            throw new Error('Invalid key');
        }
        this.writes.set(key, Buffer.from(value));
    }

    async deleteState(key) {
        this.writes.set(key, null);
    }

    async getStateByRange(startKey, endKey) {
        const keys = [...this.ledger.state.keys()].filter((k) => k >= startKey && k < endKey).sort();
        let index = 0;
        const state = this.ledger.state;
        return {
            async next() {
                if (index >= keys.length) {
                    return { done: true };
                }
                const key = keys[index++];
                return { value: { key, value: state.get(key) }, done: false };
            },
            async close() {},
        };
    }
}

module.exports = { MockLedger };
