'use strict';

const crypto = require('crypto');
const { AppError } = require('../errors');
const { readJson, writeJson } = require('../jsonFile');
const { hashPassword, verifyPassword } = require('./passwords');

const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;
const DEMO_PLAYERS = ['player1', 'player2'];
const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MS = 60 * 1000;

function sha256(text) {
    return crypto.createHash('sha256').update(text).digest('hex');
}

function validatePassword(password) {
    if (typeof password !== 'string' || password.length < 8 || password.length > 72) {
        return 'Password must be 8-72 characters long';
    }
    if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
        return 'Password must contain at least one letter and one number';
    }
    return null;
}

function publicAccount(account) {
    return {
        playerId: account.playerId,
        username: account.username,
        isDemo: account.isDemo,
        createdAt: account.createdAt,
    };
}

// Accounts and sessions are kept off-chain in auth.json. Only the player ID
// and username are written to the ledger; password hashes and session tokens
// never leave this file.
class AuthService {
    constructor({ file, ledger, sessionTtlHours, demoMode, demoPassword, data, now }) {
        this.file = file;
        this.ledger = ledger;
        this.sessionTtlMs = sessionTtlHours * 60 * 60 * 1000;
        this.demoMode = demoMode;
        this.demoPassword = demoPassword;
        this.accounts = data.accounts || [];
        this.sessions = data.sessions || [];
        this.now = now || (() => Date.now());
        this.failedLogins = new Map();
        this.pendingUsernames = new Set();
        this.saveQueue = Promise.resolve();
    }

    static async open(options) {
        const data = (await readJson(options.file)) || { accounts: [], sessions: [] };
        const service = new AuthService({ ...options, data });
        service.pruneExpiredSessions();
        await service.save();
        return service;
    }

    save() {
        const write = () => writeJson(this.file, { accounts: this.accounts, sessions: this.sessions });
        const next = this.saveQueue.then(write, write);
        this.saveQueue = next.catch(() => {});
        return next;
    }

    findByUsername(username) {
        const key = String(username || '').toLowerCase();
        return this.accounts.find((a) => a.usernameKey === key) || null;
    }

    findByPlayerId(playerId) {
        return this.accounts.find((a) => a.playerId === playerId) || null;
    }

    async ensureDemoAccounts() {
        let changed = false;
        for (const playerId of DEMO_PLAYERS) {
            if (!this.findByPlayerId(playerId)) {
                this.accounts.push({
                    playerId,
                    username: playerId,
                    usernameKey: playerId,
                    passwordHash: await hashPassword(this.demoPassword),
                    isDemo: true,
                    createdAt: new Date(this.now()).toISOString(),
                });
                changed = true;
            }
        }
        if (changed) {
            await this.save();
        }
    }

    async register({ username, password, confirmPassword }) {
        if (typeof username !== 'string' || !USERNAME_PATTERN.test(username)) {
            throw new AppError(400, 'INVALID_USERNAME', 'Username must be 3-20 characters using letters, numbers or underscore');
        }
        const passwordProblem = validatePassword(password);
        if (passwordProblem) {
            throw new AppError(400, 'INVALID_PASSWORD', passwordProblem);
        }
        if (confirmPassword !== undefined && confirmPassword !== password) {
            throw new AppError(400, 'PASSWORD_MISMATCH', 'Passwords do not match');
        }
        const usernameKey = username.toLowerCase();
        if (this.findByUsername(username) || this.pendingUsernames.has(usernameKey)) {
            throw new AppError(409, 'USERNAME_TAKEN', `Username ${username} is already taken`);
        }

        this.pendingUsernames.add(usernameKey);
        try {
            const passwordHash = await hashPassword(password);
            const playerId = await this.newPlayerId();

            // The ledger player is created first. If that fails, no login account
            // is created, so an account can never exist without a game player.
            let registration;
            try {
                registration = await this.ledger.submit('RegisterPlayer', playerId, username);
            } catch (err) {
                if (err.code === 'CONFLICT' && /already taken/.test(err.message)) {
                    throw new AppError(409, 'USERNAME_TAKEN', `Username ${username} is already taken`);
                }
                throw err;
            }

            const account = {
                playerId,
                username,
                usernameKey,
                passwordHash,
                isDemo: false,
                createdAt: new Date(this.now()).toISOString(),
            };
            this.accounts.push(account);
            const token = this.createSession(account);
            await this.save();
            return {
                token,
                account: publicAccount(account),
                player: registration.result.player,
                starterCards: registration.result.cards,
                txId: registration.txId,
                blockNumber: registration.blockNumber,
            };
        } finally {
            this.pendingUsernames.delete(usernameKey);
        }
    }

    async newPlayerId() {
        for (let attempt = 0; attempt < 10; attempt++) {
            const playerId = `player-${crypto.randomBytes(3).toString('hex')}`;
            if (!this.findByPlayerId(playerId) && !(await this.ledger.evaluate('PlayerExists', playerId))) {
                return playerId;
            }
        }
        throw new AppError(500, 'ID_GENERATION_FAILED', 'Could not generate a unique player ID');
    }

    async login({ username, password }, clientKey = '') {
        if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
            throw new AppError(400, 'MISSING_CREDENTIALS', 'Enter your username and password');
        }
        const limiterKey = `${username.toLowerCase()}|${clientKey}`;
        const entry = this.failedLogins.get(limiterKey);
        if (entry && entry.lockedUntil > this.now()) {
            const seconds = Math.ceil((entry.lockedUntil - this.now()) / 1000);
            throw new AppError(429, 'TOO_MANY_ATTEMPTS', `Too many failed attempts. Try again in ${seconds} seconds.`);
        }

        const account = this.findByUsername(username);
        const valid = account ? await verifyPassword(password, account.passwordHash) : false;
        if (!valid) {
            // An expired lockout starts a fresh count.
            const failures = (entry && !entry.lockedUntil ? entry.failures : 0) + 1;
            this.failedLogins.set(limiterKey, {
                failures,
                lockedUntil: failures >= MAX_FAILED_LOGINS ? this.now() + LOCKOUT_MS : 0,
            });
            throw new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect username or password');
        }
        this.failedLogins.delete(limiterKey);
        return this.startSession(account);
    }

    async demoLogin(playerId) {
        if (!this.demoMode) {
            throw new AppError(403, 'DEMO_DISABLED', 'Demo login is disabled on this server');
        }
        const account = this.findByPlayerId(playerId);
        if (!account || !account.isDemo) {
            throw new AppError(403, 'NOT_A_DEMO_ACCOUNT', 'Only the seeded demo players can be opened without a password');
        }
        return this.startSession(account);
    }

    async startSession(account) {
        const player = await this.ensurePlayerOnLedger(account);
        const token = this.createSession(account);
        await this.save();
        return { token, account: publicAccount(account), player };
    }

    // If the ledger was reset (for example the Fabric test network was taken
    // down) the player is re-created so the account stays usable.
    async ensurePlayerOnLedger(account) {
        if (!(await this.ledger.evaluate('PlayerExists', account.playerId))) {
            if (account.isDemo) {
                await this.ledger.submit('InitLedger');
            } else {
                await this.ledger.submit('RegisterPlayer', account.playerId, account.username);
            }
        }
        return this.ledger.evaluate('GetPlayer', account.playerId);
    }

    createSession(account) {
        this.pruneExpiredSessions();
        const token = crypto.randomBytes(32).toString('base64url');
        const now = this.now();
        this.sessions.push({
            tokenHash: sha256(token),
            playerId: account.playerId,
            createdAt: new Date(now).toISOString(),
            expiresAt: new Date(now + this.sessionTtlMs).toISOString(),
        });
        return token;
    }

    pruneExpiredSessions() {
        const now = this.now();
        this.sessions = this.sessions.filter((s) => Date.parse(s.expiresAt) > now);
    }

    authenticate(token) {
        if (!token) {
            throw new AppError(401, 'NOT_AUTHENTICATED', 'Please log in to continue');
        }
        const tokenHash = sha256(token);
        const session = this.sessions.find((s) => s.tokenHash === tokenHash);
        if (!session) {
            throw new AppError(401, 'INVALID_SESSION', 'Your session is no longer valid. Please log in again.');
        }
        if (Date.parse(session.expiresAt) <= this.now()) {
            this.sessions = this.sessions.filter((s) => s !== session);
            this.save().catch(() => {});
            throw new AppError(401, 'SESSION_EXPIRED', 'Your session has expired. Please log in again.');
        }
        const account = this.findByPlayerId(session.playerId);
        if (!account) {
            throw new AppError(401, 'INVALID_SESSION', 'Your account no longer exists');
        }
        return { ...publicAccount(account), expiresAt: session.expiresAt, tokenHash };
    }

    async logout(token) {
        const tokenHash = sha256(token || '');
        const before = this.sessions.length;
        this.sessions = this.sessions.filter((s) => s.tokenHash !== tokenHash);
        if (this.sessions.length !== before) {
            await this.save();
        }
    }

    listDemoAccounts() {
        if (!this.demoMode) {
            return [];
        }
        return this.accounts.filter((a) => a.isDemo).map(publicAccount);
    }
}

module.exports = { AuthService, validatePassword };
