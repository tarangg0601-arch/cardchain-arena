'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const { AppError } = require('./errors');
const { GameService } = require('./gameService');
const explorer = require('./ledger/explorer');

function bearerToken(req) {
    const header = req.get('authorization') || '';
    return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function createApp({ ledger, auth, startup, config, log = console }) {
    const game = new GameService(ledger);
    const rejectedList = () => (typeof ledger.rejected === 'function' ? ledger.rejected() : []);
    const app = express();
    app.disable('x-powered-by');
    app.use(express.json({ limit: '20kb' }));

    const api = express.Router();
    api.use((req, res, next) => {
        res.set('Cache-Control', 'no-store');
        next();
    });

    const requireAuth = (req, res, next) => {
        req.user = auth.authenticate(bearerToken(req));
        next();
    };

    api.get('/status', (req, res) => {
        res.json({
            ledger: ledger.describe(),
            requestedMode: startup.requestedMode,
            fallbackReason: startup.fallbackReason,
            demoMode: config.demoMode,
        });
    });

    api.post('/auth/register', async (req, res) => {
        const { username, password, confirmPassword } = req.body || {};
        res.status(201).json(await auth.register({ username, password, confirmPassword }));
    });

    api.post('/auth/login', async (req, res) => {
        const { username, password } = req.body || {};
        res.json(await auth.login({ username, password }, req.ip));
    });

    api.post('/auth/demo-login', async (req, res) => {
        res.json(await auth.demoLogin(String((req.body || {}).playerId || '')));
    });

    api.get('/auth/demo-accounts', (req, res) => {
        res.json({ demoMode: config.demoMode, accounts: auth.listDemoAccounts(), password: config.demoMode ? config.demoPassword : null });
    });

    api.post('/auth/logout', async (req, res) => {
        await auth.logout(bearerToken(req));
        res.json({ ok: true });
    });

    api.use(requireAuth);

    api.get('/auth/me', async (req, res) => {
        res.json({ account: req.user, player: await game.getPlayer(req.user.playerId) });
    });

    api.get('/players', async (req, res) => {
        res.json(await game.getLeaderboard());
    });

    api.get('/leaderboard', async (req, res) => {
        res.json(await game.getLeaderboard());
    });

    api.get('/players/:playerId', async (req, res) => {
        res.json(await game.getPlayer(req.params.playerId));
    });

    api.get('/players/:playerId/cards', async (req, res) => {
        res.json(await game.getPlayerCards(req.params.playerId));
    });

    api.post('/battles', async (req, res) => {
        res.status(201).json(await game.battle(req.user.playerId, req.body || {}));
    });

    api.get('/battles/mine', async (req, res) => {
        res.json(await game.getPlayerBattles(req.user.playerId));
    });

    api.get('/battles/:battleId', async (req, res) => {
        res.json(await game.getBattle(req.params.battleId));
    });

    api.get('/trades/open', async (req, res) => {
        res.json(await game.getOpenTrades());
    });

    api.get('/trades/mine', async (req, res) => {
        res.json(await game.getPlayerTrades(req.user.playerId));
    });

    api.post('/trades', async (req, res) => {
        res.status(201).json(await game.createTrade(req.user.playerId, req.body || {}));
    });

    api.post('/trades/:tradeId/accept', async (req, res) => {
        res.json(await game.acceptTrade(req.user.playerId, req.params.tradeId));
    });

    api.post('/trades/:tradeId/cancel', async (req, res) => {
        res.json(await game.cancelTrade(req.user.playerId, req.params.tradeId));
    });

    api.post('/trades/:tradeId/decline', async (req, res) => {
        res.json(await game.declineTrade(req.user.playerId, req.params.tradeId));
    });

    api.get('/cards/catalog', async (req, res) => {
        res.json(await game.cardCatalog(req.user.playerId));
    });

    api.get('/shop/packs', async (req, res) => {
        res.json(await game.getPacks());
    });

    api.post('/shop/buy', async (req, res) => {
        res.status(201).json(await game.buyPack(req.user.playerId, req.body || {}));
    });

    api.get('/friends', async (req, res) => {
        res.json(await game.getFriends(req.user.playerId));
    });

    api.post('/friends/requests', async (req, res) => {
        res.status(201).json(await game.sendFriendRequest(req.user.playerId, req.body || {}));
    });

    api.post('/friends/requests/:requestId/accept', async (req, res) => {
        res.json(await game.respondFriendRequest(req.user.playerId, req.params.requestId, 'ACCEPT'));
    });

    api.post('/friends/requests/:requestId/decline', async (req, res) => {
        res.json(await game.respondFriendRequest(req.user.playerId, req.params.requestId, 'DECLINE'));
    });

    api.post('/friends/:friendId/remove', async (req, res) => {
        res.json(await game.removeFriend(req.user.playerId, req.params.friendId));
    });

    api.get('/me/notifications', async (req, res) => {
        res.json(await game.notifications(req.user.playerId));
    });

    api.get('/ledger/summary', async (req, res) => {
        const [chain, stats] = await Promise.all([
            explorer.transactionCounts(ledger),
            ledger.evaluate('GetLedgerStats'),
        ]);
        res.json({ network: ledger.describe(), ...chain, stats, rejectedCount: rejectedList().length });
    });

    api.get('/ledger/blocks', async (req, res) => {
        res.json(await explorer.listBlocks(ledger, { before: req.query.before, limit: req.query.limit }));
    });

    api.get('/ledger/blocks/:number', async (req, res) => {
        res.json(await explorer.getBlock(ledger, req.params.number));
    });

    api.get('/ledger/verify', async (req, res) => {
        res.json(await explorer.verifyChain(ledger));
    });

    api.get('/ledger/rejected', (req, res) => {
        res.json(rejectedList());
    });

    api.use((req, res) => {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: `No API route for ${req.method} ${req.originalUrl}` } });
    });

    app.use('/api', api);

    // Serve the built React app when it exists (npm run build in frontend/).
    const indexHtml = path.join(config.frontendDist, 'index.html');
    if (fs.existsSync(indexHtml)) {
        app.use(express.static(config.frontendDist));
        app.use((req, res, next) => (req.method === 'GET' ? res.sendFile(indexHtml) : next()));
    }

    app.use((err, req, res, next) => {
        if (err.type === 'entity.parse.failed') {
            return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' } });
        }
        if (err instanceof AppError) {
            if (err.status >= 500) {
                log.error(`[api] ${req.method} ${req.originalUrl}: ${err.message}`);
            }
            return res.status(err.status).json({ error: { code: err.code, message: err.message } });
        }
        log.error(`[api] ${req.method} ${req.originalUrl}:`, err);
        return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error' } });
    });

    return app;
}

module.exports = { createApp };
