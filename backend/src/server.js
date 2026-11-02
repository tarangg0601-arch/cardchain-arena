'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env'), quiet: true });

const { loadConfig } = require('./config');
const { createLedger, ensureSeedData } = require('./ledger');
const { trackLedger } = require('./ledger/tracker');
const { AuthService } = require('./auth/authService');
const { createApp } = require('./app');

// Optional command line override, e.g. "node src/server.js --mode=local".
function modeFromArgs(argv) {
    const arg = argv.find((a) => a.startsWith('--mode='));
    return arg ? arg.slice('--mode='.length) : undefined;
}

async function main() {
    const cliMode = modeFromArgs(process.argv.slice(2));
    const config = loadConfig(cliMode ? { ...process.env, LEDGER_MODE: cliMode } : process.env);
    const created = await createLedger(config);
    const { requestedMode, fallbackReason } = created;
    const ledger = trackLedger(created.ledger);
    const seeded = await ensureSeedData(ledger);

    const auth = await AuthService.open({
        file: config.authFile,
        ledger,
        sessionTtlHours: config.sessionTtlHours,
        demoMode: config.demoMode,
        demoPassword: config.demoPassword,
    });
    await auth.ensureDemoAccounts();

    const app = createApp({ ledger, auth, startup: { requestedMode, fallbackReason }, config });
    const server = app.listen(config.port, () => {
        const info = ledger.describe();
        console.log(`TCG backend listening on http://localhost:${config.port}`);
        if (info.mode === 'fabric') {
            console.log(`Ledger: Hyperledger Fabric (channel ${info.channel}, chaincode ${info.chaincode}, peer ${info.peerEndpoint})`);
        } else {
            console.log(`Ledger: LOCAL demonstration ledger (${config.localLedgerFile}) - not a blockchain`);
        }
        if (fallbackReason) {
            console.log(`Fabric was not available, so auto mode fell back to the local ledger.`);
        }
        if (seeded) {
            console.log(`Demo data created: ${seeded.created.join(', ')}`);
        }
        if (config.demoMode) {
            console.log(`Demo accounts: player1 / player2 (password: ${config.demoPassword})`);
        }
    });

    const shutdown = async () => {
        server.close();
        await (ledger.close && ledger.close());
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

main().catch((err) => {
    console.error(`Failed to start: ${err.message}`);
    console.error('To run without Fabric use "npm run start:local", or "npm start" (auto mode) to fall back automatically.');
    process.exit(1);
});
