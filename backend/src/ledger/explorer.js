'use strict';

const { AppError } = require('../errors');

const MAX_PAGE = 25;
const MAX_VERIFY = 5000;

// Works with both ledgers: each provides getChainInfo() and getBlock(number).

async function listBlocks(ledger, { before, limit = 10 } = {}) {
    const info = await ledger.getChainInfo();
    const size = Math.min(MAX_PAGE, Math.max(1, Number(limit) || 10));
    const start = Math.min(info.height, before === undefined ? info.height : Number(before));
    if (!Number.isInteger(start) || start < 0) {
        throw new AppError(400, 'INVALID_REQUEST', 'before must be a block number');
    }
    const blocks = [];
    for (let n = start - 1; n >= 0 && blocks.length < size; n--) {
        blocks.push(await ledger.getBlock(n));
    }
    return { height: info.height, currentBlockHash: info.currentBlockHash, blocks };
}

async function getBlock(ledger, number) {
    const info = await ledger.getChainInfo();
    const n = Number(number);
    if (!Number.isInteger(n) || n < 0 || n >= info.height) {
        throw new AppError(404, 'NOT_FOUND', `Block ${number} does not exist (height is ${info.height})`);
    }
    return ledger.getBlock(n);
}

// Recomputes every block's data hash and header hash and checks that each
// block points at the hash of the block before it.
async function verifyChain(ledger) {
    const info = await ledger.getChainInfo();
    const problems = [];
    const count = Math.min(info.height, MAX_VERIFY);
    let previous = null;
    for (let n = 0; n < count; n++) {
        const block = await ledger.getBlock(n);
        if (block.computedDataHash !== block.dataHash) {
            problems.push({ block: n, issue: 'Transaction data does not match the data hash in the block header' });
        }
        if (block.computedHash !== block.hash) {
            problems.push({ block: n, issue: 'Block hash does not match its header contents' });
        }
        if (previous && block.previousHash !== previous.hash) {
            problems.push({ block: n, issue: `Previous-hash link does not match block ${n - 1}` });
        }
        previous = block;
    }
    if (previous && count === info.height && previous.hash !== info.currentBlockHash) {
        problems.push({ block: previous.number, issue: 'Latest block hash differs from the hash reported by the ledger' });
    }
    return {
        valid: problems.length === 0,
        blocksChecked: count,
        height: info.height,
        currentBlockHash: info.currentBlockHash,
        problems,
        checkedAt: new Date().toISOString(),
    };
}

async function transactionCounts(ledger) {
    const info = await ledger.getChainInfo();
    const counts = { total: 0, valid: 0, invalid: 0, game: 0 };
    let lastGameTx = null;
    for (let n = 0; n < Math.min(info.height, MAX_VERIFY); n++) {
        const block = await ledger.getBlock(n);
        for (const tx of block.transactions) {
            counts.total += 1;
            counts[tx.valid ? 'valid' : 'invalid'] += 1;
            if (tx.chaincode && tx.chaincode !== '_lifecycle' && tx.type === 'ENDORSER_TRANSACTION') {
                counts.game += 1;
                lastGameTx = { ...tx, blockNumber: n };
            }
        }
    }
    return { height: info.height, currentBlockHash: info.currentBlockHash, counts, lastGameTx };
}

module.exports = { listBlocks, getBlock, verifyChain, transactionCounts };
