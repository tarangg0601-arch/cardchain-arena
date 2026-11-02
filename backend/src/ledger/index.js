'use strict';

const { LocalLedger } = require('./localLedger');
const { FabricLedger } = require('./fabricLedger');

// Chooses the ledger once at startup. In auto mode a failed Fabric connection
// falls back to the local ledger and the reason is reported to the UI. After
// startup the mode never changes, so a failed Fabric transaction is never
// retried against the local ledger.
async function createLedger(config, log = console) {
    const requestedMode = config.ledgerMode;
    if (requestedMode === 'local') {
        return { ledger: await LocalLedger.open(config.localLedgerFile), requestedMode, fallbackReason: null };
    }
    try {
        const ledger = await FabricLedger.connect(config.fabric);
        return { ledger, requestedMode, fallbackReason: null };
    } catch (err) {
        if (requestedMode === 'fabric') {
            throw err;
        }
        log.warn(`[ledger] Fabric unavailable, using local demonstration ledger instead: ${err.message}`);
        return {
            ledger: await LocalLedger.open(config.localLedgerFile),
            requestedMode,
            fallbackReason: err.message,
        };
    }
}

async function ensureSeedData(ledger) {
    const [p1, p2] = await Promise.all([
        ledger.evaluate('PlayerExists', 'player1'),
        ledger.evaluate('PlayerExists', 'player2'),
    ]);
    if (p1 && p2) {
        return null;
    }
    const { result } = await ledger.submit('InitLedger');
    return result;
}

module.exports = { createLedger, ensureSeedData };
