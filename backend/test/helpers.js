'use strict';

const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const supertest = require('supertest');
const { loadConfig } = require('../src/config');
const { LocalLedger } = require('../src/ledger/localLedger');
const { ensureSeedData } = require('../src/ledger');
const { trackLedger } = require('../src/ledger/tracker');
const { AuthService } = require('../src/auth/authService');
const { createApp } = require('../src/app');

const silentLog = { warn() {}, error() {}, log() {} };

const MY_PICK = ['P1-04', 'P1-03', 'P1-02'];
const MIRROR_PICK = ['P1-01', 'P1-02', 'P1-03'];

// The contract draws the opponent's cards at random, so outcome tests fix
// the stats of every card the draw could pick.
function setCards(ledger, ids, changes) {
    const local = ledger.inner || ledger;
    for (const id of ids) {
        const key = `CARD_${id}`;
        local.state.set(key, { ...local.state.get(key), ...changes });
    }
}

function weakenPlayer2(ledger) {
    setCards(ledger, ['P2-01', 'P2-02', 'P2-03', 'P2-04'], { type: 'Water', rarity: 'Common', attack: 40, defense: 30 });
}

function mirrorCards(ledger) {
    setCards(ledger, ['P1-01', 'P1-02', 'P1-03', 'P2-01', 'P2-02', 'P2-03', 'P2-04'],
        { type: 'Fire', rarity: 'Common', attack: 50, defense: 40 });
}

async function tempDir() {
    return fs.mkdtemp(path.join(os.tmpdir(), 'tcg-test-'));
}

async function setup({ ledger, now, demoMode = true, dir } = {}) {
    const dataDir = dir || (await tempDir());
    const config = loadConfig({
        DATA_DIR: dataDir,
        FRONTEND_DIST: path.join(dataDir, 'no-frontend'),
        DEMO_MODE: demoMode ? 'true' : 'false',
        DEMO_PASSWORD: 'demo1234',
        SESSION_TTL_HOURS: '1',
    });
    const activeLedger = trackLedger(ledger || (await LocalLedger.open(config.localLedgerFile)));
    await ensureSeedData(activeLedger);
    const auth = await AuthService.open({
        file: config.authFile,
        ledger: activeLedger,
        sessionTtlHours: config.sessionTtlHours,
        demoMode: config.demoMode,
        demoPassword: config.demoPassword,
        now,
    });
    await auth.ensureDemoAccounts();
    const app = createApp({
        ledger: activeLedger,
        auth,
        startup: { requestedMode: 'local', fallbackReason: null },
        config,
        log: silentLog,
    });
    return { dir: dataDir, config, ledger: activeLedger, auth, app, request: supertest(app) };
}

async function login(request, username, password = 'demo1234') {
    const res = await request.post('/api/auth/login').send({ username, password });
    if (res.status !== 200) {
        throw new Error(`login failed for ${username}: ${res.status} ${JSON.stringify(res.body)}`);
    }
    return res.body.token;
}

const bearer = (token) => ({ Authorization: `Bearer ${token}` });

module.exports = {
    setup, login, bearer, tempDir, silentLog, MY_PICK, MIRROR_PICK, setCards, weakenPlayer2, mirrorCards,
};
