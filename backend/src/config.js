'use strict';

const path = require('path');

const backendRoot = path.resolve(__dirname, '..');

function resolveFromBackend(value) {
    return path.isAbsolute(value) ? value : path.resolve(backendRoot, value);
}

function bool(value, fallback) {
    if (value === undefined || value === '') {
        return fallback;
    }
    return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function loadConfig(env = process.env) {
    const mode = (env.LEDGER_MODE || 'auto').toLowerCase();
    if (!['auto', 'fabric', 'local'].includes(mode)) {
        throw new Error(`LEDGER_MODE must be auto, fabric or local (got "${env.LEDGER_MODE}")`);
    }

    const dataDir = resolveFromBackend(env.DATA_DIR || './data');
    const cryptoPath = resolveFromBackend(env.FABRIC_CRYPTO_PATH ||
        '../../fabric-samples/test-network/organizations/peerOrganizations/org1.example.com');

    return {
        port: Number(env.PORT || 4000),
        ledgerMode: mode,
        dataDir,
        authFile: resolveFromBackend(env.AUTH_FILE || path.join(dataDir, 'auth.json')),
        localLedgerFile: resolveFromBackend(env.LOCAL_LEDGER_FILE || path.join(dataDir, 'local-ledger.json')),
        sessionTtlHours: Number(env.SESSION_TTL_HOURS || 12),
        demoMode: bool(env.DEMO_MODE, true),
        demoPassword: env.DEMO_PASSWORD || 'demo1234',
        frontendDist: resolveFromBackend(env.FRONTEND_DIST || '../frontend/dist'),
        fabric: {
            channel: env.FABRIC_CHANNEL || 'mychannel',
            chaincode: env.FABRIC_CHAINCODE || 'tcg',
            mspId: env.FABRIC_MSP_ID || 'Org1MSP',
            peerEndpoint: env.FABRIC_PEER_ENDPOINT || 'localhost:7051',
            peerHostAlias: env.FABRIC_PEER_HOST_ALIAS || 'peer0.org1.example.com',
            certDir: resolveFromBackend(env.FABRIC_CERT_DIR ||
                path.join(cryptoPath, 'users/User1@org1.example.com/msp/signcerts')),
            keyDir: resolveFromBackend(env.FABRIC_KEY_DIR ||
                path.join(cryptoPath, 'users/User1@org1.example.com/msp/keystore')),
            tlsCertPath: resolveFromBackend(env.FABRIC_TLS_CERT_PATH ||
                path.join(cryptoPath, 'peers/peer0.org1.example.com/tls/ca.crt')),
            connectTimeoutMs: Number(env.FABRIC_CONNECT_TIMEOUT_MS || 5000),
        },
    };
}

module.exports = { loadConfig };
