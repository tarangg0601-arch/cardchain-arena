'use strict';

const MAX_REJECTED = 30;

function rejectionStage(err, mode) {
    if (['INVALID_ARGUMENT', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT'].includes(err.code)) {
        return mode === 'fabric' ? 'Rejected at endorsement' : 'Rejected by contract';
    }
    if (err.code === 'TX_NOT_COMMITTED') {
        return 'Invalid at validation';
    }
    if (err.code === 'LEDGER_UNAVAILABLE') {
        return 'Network unavailable';
    }
    return 'Failed';
}

// Wraps a ledger so failed write transactions are remembered for the
// "Rejected transactions" panel. The list is kept in memory only.
function trackLedger(ledger) {
    const rejected = [];
    return {
        get mode() {
            return ledger.mode;
        },
        describe: () => ledger.describe(),
        evaluate: (fcn, ...args) => ledger.evaluate(fcn, ...args),
        async submit(fcn, ...args) {
            try {
                return await ledger.submit(fcn, ...args);
            } catch (err) {
                rejected.unshift({
                    time: new Date().toISOString(),
                    function: fcn,
                    args: args.map(String),
                    code: err.code || 'ERROR',
                    message: err.message,
                    stage: rejectionStage(err, ledger.mode),
                });
                rejected.splice(MAX_REJECTED);
                throw err;
            }
        },
        getChainInfo: () => ledger.getChainInfo(),
        getBlock: (n) => ledger.getBlock(n),
        rejected: () => rejected.slice(),
        close: () => ledger.close && ledger.close(),
        inner: ledger,
    };
}

module.exports = { trackLedger };
