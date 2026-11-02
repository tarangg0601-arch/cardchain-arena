'use strict';

const rules = require('./rules');

// Shared by the Fabric contract (tcgContract.js) and the backend's local ledger,
// so both modes run exactly the same game rules. This file must stay free of
// Fabric-specific imports and of non-deterministic calls (Date.now, Math.random).

const ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;
const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;

class GameError extends Error {
    constructor(code, message) {
        super(`[${code}] ${message}`);
        this.name = 'GameError';
        this.code = code;
    }
}

const invalid = (message) => new GameError('INVALID_ARGUMENT', message);
const notFound = (message) => new GameError('NOT_FOUND', message);
const conflict = (message) => new GameError('CONFLICT', message);
const forbidden = (message) => new GameError('FORBIDDEN', message);

const keys = {
    player: (id) => `PLAYER_${id}`,
    username: (name) => `USERNAME_${name.toLowerCase()}`,
    card: (id) => `CARD_${id}`,
    trade: (id) => `TRADE_${id}`,
    battle: (id) => `BATTLE_${id}`,
    friendRequest: (id) => `FRIENDREQ_${id}`,
    // ':' never appears in player IDs, so the pair key is unambiguous.
    friendship: (a, b) => `FRIEND_${[a, b].sort().join(':')}`,
};

const SEED_PLAYERS = [
    {
        playerId: 'player1',
        username: 'player1',
        cards: [
            { cardId: 'P1-01', name: 'Ember Fox', type: 'Fire', rarity: 'Common', attack: 48, defense: 38 },
            { cardId: 'P1-02', name: 'Frost Warden', type: 'Water', rarity: 'Rare', attack: 58, defense: 62 },
            { cardId: 'P1-03', name: 'Granite Titan', type: 'Earth', rarity: 'Epic', attack: 78, defense: 70 },
            { cardId: 'P1-04', name: 'Thunder Griffin', type: 'Air', rarity: 'Legendary', attack: 96, defense: 82 },
        ],
    },
    {
        playerId: 'player2',
        username: 'player2',
        cards: [
            { cardId: 'P2-01', name: 'Moss Golem', type: 'Earth', rarity: 'Common', attack: 46, defense: 44 },
            { cardId: 'P2-02', name: 'Wind Dancer', type: 'Air', rarity: 'Rare', attack: 59, defense: 61 },
            { cardId: 'P2-03', name: 'Inferno Drake', type: 'Fire', rarity: 'Epic', attack: 80, defense: 66 },
            { cardId: 'P2-04', name: 'Abyssal Kraken', type: 'Water', rarity: 'Legendary', attack: 94, defense: 86 },
        ],
    },
];

// Fabric does not let a transaction read its own uncommitted writes. Every write
// is therefore also kept in a per-transaction cache that later reads check first,
// e.g. RewardWinner must see the winner's rating that Battle just updated.
function writeCache(ctx) {
    if (!ctx.tcgWriteCache) {
        ctx.tcgWriteCache = new Map();
    }
    return ctx.tcgWriteCache;
}

async function readState(ctx, key) {
    const cache = writeCache(ctx);
    if (cache.has(key)) {
        return JSON.parse(cache.get(key));
    }
    const data = await ctx.stub.getState(key);
    if (!data || data.length === 0) {
        return null;
    }
    return JSON.parse(Buffer.from(data).toString('utf8'));
}

async function writeState(ctx, key, value) {
    const json = JSON.stringify(value);
    writeCache(ctx).set(key, json);
    await ctx.stub.putState(key, Buffer.from(json, 'utf8'));
}

// Range scans read committed state only; none of the callers write before scanning.
async function scanPrefix(ctx, prefix) {
    const results = [];
    const iterator = await ctx.stub.getStateByRange(prefix, `${prefix}~`);
    try {
        let res = await iterator.next();
        while (!res.done) {
            if (res.value && res.value.value && res.value.value.length > 0) {
                results.push(JSON.parse(Buffer.from(res.value.value).toString('utf8')));
            }
            res = await iterator.next();
        }
    } finally {
        await iterator.close();
    }
    return results;
}

function txTime(ctx) {
    const ts = ctx.stub.getTxTimestamp();
    let seconds = ts.seconds;
    if (typeof seconds !== 'number') {
        seconds = typeof seconds.toNumber === 'function' ? seconds.toNumber() : Number(seconds.low);
    }
    return new Date(seconds * 1000 + Math.floor((ts.nanos || 0) / 1e6)).toISOString();
}

function invokedFunctionName(ctx) {
    const { fcn } = ctx.stub.getFunctionAndParameters();
    return String(fcn || '').split(':').pop();
}

function requireId(value, label) {
    if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
        throw invalid(`${label} must be 1-40 characters using letters, numbers, '-' or '_'`);
    }
}

function requireCardId(value, label) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
        throw invalid(`${label} is not a valid card ID`);
    }
}

function parseCardList(json, label) {
    let list;
    try {
        list = typeof json === 'string' ? JSON.parse(json) : json;
    } catch (err) {
        throw invalid(`${label} cards must be a JSON array of card IDs`);
    }
    if (!Array.isArray(list) || list.length !== 3) {
        throw invalid(`${label} must select exactly 3 cards`);
    }
    list.forEach((id, i) => requireCardId(id, `${label} card ${i + 1}`));
    if (new Set(list).size !== list.length) {
        throw invalid(`${label} selected the same card more than once`);
    }
    return list;
}

function newPlayer(playerId, username, createdAt) {
    return {
        docType: 'player',
        playerId,
        username,
        rating: rules.STARTING_RATING,
        wins: 0,
        losses: 0,
        draws: 0,
        winStreak: 0,
        coins: rules.STARTING_COINS,
        createdAt,
    };
}

// Players saved before coins existed start with the standard balance.
function withDefaults(player) {
    return Number.isInteger(player.coins) ? player : { ...player, coins: rules.STARTING_COINS };
}

function newCard(attrs, owner, origin, mintedAt, mintedTxId) {
    return {
        docType: 'card',
        cardId: attrs.cardId,
        name: attrs.name,
        owner,
        attack: attrs.attack,
        defense: attrs.defense,
        type: attrs.type,
        rarity: attrs.rarity,
        xp: 0,
        locked: false,
        lockedByTrade: null,
        origin,
        mintedAt,
        mintedTxId,
    };
}

function cardSummary(card, stats) {
    return {
        cardId: card.cardId,
        name: card.name,
        type: card.type,
        rarity: card.rarity,
        attack: card.attack,
        defense: card.defense,
        rarityBonusPct: stats.rarityBonusPct,
        typeAdvantage: stats.typeAdvantage,
        typeMultiplier: stats.typeMultiplier,
        effectiveAttack: stats.effectiveAttack / 100,
        effectiveDefense: stats.effectiveDefense / 100,
        damageDealt: stats.damage / 100,
    };
}

function sortCards(cards) {
    return cards.sort((a, b) =>
        rules.rarityRank(b.rarity) - rules.rarityRank(a.rarity) ||
        a.name.localeCompare(b.name) ||
        a.cardId.localeCompare(b.cardId));
}

class TcgGame {
    async InitLedger(ctx) {
        const now = txTime(ctx);
        const txId = ctx.stub.getTxID();
        const created = [];
        const skipped = [];

        for (const seed of SEED_PLAYERS) {
            if (await readState(ctx, keys.player(seed.playerId))) {
                skipped.push(seed.playerId);
            } else {
                await writeState(ctx, keys.player(seed.playerId), newPlayer(seed.playerId, seed.username, now));
                await writeState(ctx, keys.username(seed.username), { docType: 'username', playerId: seed.playerId });
                created.push(seed.playerId);
            }
            for (const card of seed.cards) {
                if (await readState(ctx, keys.card(card.cardId))) {
                    skipped.push(card.cardId);
                } else {
                    await writeState(ctx, keys.card(card.cardId), newCard(card, seed.playerId, 'SEED', now, txId));
                    created.push(card.cardId);
                }
            }
        }
        return { created, skipped };
    }

    async PlayerExists(ctx, playerId) {
        requireId(playerId, 'Player ID');
        return Boolean(await readState(ctx, keys.player(playerId)));
    }

    async RegisterPlayer(ctx, playerId, username) {
        requireId(playerId, 'Player ID');
        if (typeof username !== 'string' || !USERNAME_PATTERN.test(username)) {
            throw invalid('Username must be 3-20 characters using letters, numbers or underscore');
        }
        if (await readState(ctx, keys.player(playerId))) {
            throw conflict(`Player ${playerId} already exists`);
        }
        if (await readState(ctx, keys.username(username))) {
            throw conflict(`Username ${username} is already taken`);
        }

        const now = txTime(ctx);
        const txId = ctx.stub.getTxID();
        const player = newPlayer(playerId, username, now);
        const cards = [];
        for (const attrs of rules.starterCardPlan(playerId)) {
            if (await readState(ctx, keys.card(attrs.cardId))) {
                throw conflict(`Card ${attrs.cardId} already exists`);
            }
            cards.push(newCard(attrs, playerId, 'STARTER', now, txId));
        }

        await writeState(ctx, keys.player(playerId), player);
        await writeState(ctx, keys.username(username), { docType: 'username', playerId });
        for (const card of cards) {
            await writeState(ctx, keys.card(card.cardId), card);
        }
        return { player, cards };
    }

    async GetPlayer(ctx, playerId) {
        requireId(playerId, 'Player ID');
        return this._requirePlayer(ctx, playerId);
    }

    async GetCard(ctx, cardId) {
        requireCardId(cardId, 'Card ID');
        return this._requireCard(ctx, cardId);
    }

    async GetPlayerCards(ctx, playerId) {
        requireId(playerId, 'Player ID');
        await this._requirePlayer(ctx, playerId);
        const cards = await scanPrefix(ctx, 'CARD_');
        return sortCards(cards.filter((card) => card.owner === playerId));
    }

    async GetLeaderboard(ctx) {
        const players = (await scanPrefix(ctx, 'PLAYER_')).map(withDefaults);
        players.sort((a, b) =>
            b.rating - a.rating || b.wins - a.wins || a.username.localeCompare(b.username));
        return players.map((player, i) => ({ rank: i + 1, ...player }));
    }

    async GetLedgerStats(ctx) {
        const players = await scanPrefix(ctx, 'PLAYER_');
        const cards = await scanPrefix(ctx, 'CARD_');
        const trades = await scanPrefix(ctx, 'TRADE_');
        const battles = await scanPrefix(ctx, 'BATTLE_');
        const byRarity = Object.fromEntries(rules.RARITIES.map((r) => [r, cards.filter((c) => c.rarity === r).length]));
        return {
            players: players.length,
            cards: cards.length,
            cardsByRarity: byRarity,
            lockedCards: cards.filter((c) => c.locked).length,
            openTrades: trades.filter((t) => t.status === 'OPEN').length,
            completedTrades: trades.filter((t) => t.status === 'ACCEPTED').length,
            battles: battles.length,
            draws: battles.filter((b) => b.outcome === 'DRAW').length,
        };
    }

    async GetOpenTrades(ctx) {
        const trades = await scanPrefix(ctx, 'TRADE_');
        return trades
            .filter((trade) => trade.status === 'OPEN')
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.tradeId.localeCompare(b.tradeId));
    }

    async GetPlayerTrades(ctx, playerId) {
        requireId(playerId, 'Player ID');
        const trades = await scanPrefix(ctx, 'TRADE_');
        return trades
            .filter((trade) => trade.fromPlayer === playerId || trade.toPlayer === playerId)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.tradeId.localeCompare(b.tradeId));
    }

    async GetBattle(ctx, battleId) {
        requireCardId(battleId, 'Battle ID');
        const battle = await readState(ctx, keys.battle(battleId));
        if (!battle) {
            throw notFound(`Battle ${battleId} does not exist`);
        }
        return battle;
    }

    async GetPlayerBattles(ctx, playerId) {
        requireId(playerId, 'Player ID');
        const battles = await scanPrefix(ctx, 'BATTLE_');
        return battles
            .filter((b) => b.challengerId === playerId || b.opponentId === playerId)
            .sort((a, b) => b.timestamp.localeCompare(a.timestamp) || a.battleId.localeCompare(b.battleId))
            .slice(0, 20);
    }

    async Battle(ctx, challengerId, challengerCardsJson, opponentId) {
        requireId(challengerId, 'Challenger ID');
        requireId(opponentId, 'Opponent ID');
        if (challengerId === opponentId) {
            throw invalid('A player cannot battle against themselves');
        }
        const challengerCardIds = parseCardList(challengerCardsJson, 'Challenger');

        const challenger = await this._requirePlayer(ctx, challengerId);
        const opponent = await this._requirePlayer(ctx, opponentId);
        const challengerCards = await this._loadBattleCards(ctx, challenger, challengerCardIds);

        // The opponent's cards are hidden from the challenger and drawn here.
        const txId = ctx.stub.getTxID();
        const available = (await scanPrefix(ctx, 'CARD_')).filter((c) => c.owner === opponentId && !c.locked);
        if (available.length < 3) {
            throw conflict(`${opponent.username} does not have 3 cards available for battle`);
        }
        const opponentCards = rules.drawCards(available, `${txId}:${opponentId}`);

        const battleId = `B-${txId.slice(0, 12).toUpperCase()}`;
        if (await readState(ctx, keys.battle(battleId))) {
            throw conflict(`Battle ${battleId} already exists`);
        }

        const rounds = [];
        const xpGained = new Map();
        let challengerRounds = 0;
        let opponentRounds = 0;
        let drawnRounds = 0;

        for (let i = 0; i < 3; i++) {
            const cCard = challengerCards[i];
            const oCard = opponentCards[i];
            const { a, b, result } = rules.resolveRound(cCard, oCard);
            let winner = 'DRAW';
            let winnerPlayerId = null;
            if (result === 'A') {
                winner = 'CHALLENGER';
                winnerPlayerId = challengerId;
                challengerRounds++;
            } else if (result === 'B') {
                winner = 'OPPONENT';
                winnerPlayerId = opponentId;
                opponentRounds++;
            } else {
                drawnRounds++;
            }
            const cXp = result === 'A' ? rules.XP_PER_ROUND.WIN : result === 'B' ? rules.XP_PER_ROUND.LOSS : rules.XP_PER_ROUND.DRAW;
            const oXp = result === 'B' ? rules.XP_PER_ROUND.WIN : result === 'A' ? rules.XP_PER_ROUND.LOSS : rules.XP_PER_ROUND.DRAW;
            xpGained.set(cCard.cardId, cXp);
            xpGained.set(oCard.cardId, oXp);
            rounds.push({
                round: i + 1,
                challengerCard: cardSummary(cCard, a),
                opponentCard: cardSummary(oCard, b),
                winner,
                winnerPlayerId,
                xp: { challengerCard: cXp, opponentCard: oXp },
            });
        }

        let winnerId = null;
        let loserId = null;
        if (challengerRounds > opponentRounds) {
            winnerId = challengerId;
            loserId = opponentId;
        } else if (opponentRounds > challengerRounds) {
            winnerId = opponentId;
            loserId = challengerId;
        }

        const challengerScore = winnerId === challengerId ? 1 : winnerId === opponentId ? 0 : 0.5;
        const ratingsBefore = { challenger: challenger.rating, opponent: opponent.rating };
        const elo = rules.updateRatings(challenger.rating, opponent.rating, challengerScore);
        challenger.rating = elo.newA;
        opponent.rating = elo.newB;
        for (const player of [challenger, opponent]) {
            if (!winnerId) {
                player.draws += 1;
                player.winStreak = 0;
            } else if (player.playerId === winnerId) {
                player.wins += 1;
                player.winStreak += 1;
            } else {
                player.losses += 1;
                player.winStreak = 0;
            }
            player.coins += player.playerId === winnerId ? rules.BATTLE_WIN_COINS : 0;
        }
        await writeState(ctx, keys.player(challenger.playerId), challenger);
        await writeState(ctx, keys.player(opponent.playerId), opponent);

        const xpAwarded = [];
        for (const card of [...challengerCards, ...opponentCards]) {
            const gained = xpGained.get(card.cardId);
            card.xp += gained;
            await writeState(ctx, keys.card(card.cardId), card);
            xpAwarded.push({ cardId: card.cardId, name: card.name, owner: card.owner, xpGained: gained, xpTotal: card.xp });
        }

        const summarize = (player, role, ratingBefore) => ({
            playerId: player.playerId,
            username: player.username,
            role,
            result: !winnerId ? 'DRAW' : player.playerId === winnerId ? 'WIN' : 'LOSS',
            ratingBefore,
            ratingAfter: player.rating,
            ratingChange: player.rating - ratingBefore,
            wins: player.wins,
            losses: player.losses,
            draws: player.draws,
            winStreak: player.winStreak,
            coinsEarned: player.playerId === winnerId ? rules.BATTLE_WIN_COINS : 0,
            coins: player.coins,
        });

        // The winner-only reward runs inside this same transaction, after the
        // winner's new rating and streak have been written.
        const reward = winnerId ? await this.RewardWinner(ctx, winnerId) : null;

        const battle = {
            docType: 'battle',
            battleId,
            txId,
            timestamp: txTime(ctx),
            challengerId,
            opponentId,
            challenger: summarize(challenger, 'CHALLENGER', ratingsBefore.challenger),
            opponent: summarize(opponent, 'OPPONENT', ratingsBefore.opponent),
            rounds,
            score: { challenger: challengerRounds, opponent: opponentRounds, drawnRounds },
            outcome: winnerId ? 'WIN' : 'DRAW',
            winnerId,
            loserId,
            xpAwarded,
            reward,
        };
        await writeState(ctx, keys.battle(battleId), battle);
        return battle;
    }

    async RewardWinner(ctx, winnerId) {
        // Only the Battle transaction may mint rewards. A client calling
        // RewardWinner directly is rejected, so rewards cannot be farmed.
        if (invokedFunctionName(ctx) !== 'Battle') {
            throw forbidden('RewardWinner can only run inside a Battle transaction');
        }
        requireId(winnerId, 'Winner ID');
        const winner = await this._requirePlayer(ctx, winnerId);
        const txId = ctx.stub.getTxID();
        const seed = `${txId}:${winner.playerId}:${winner.rating}:${winner.winStreak}`;
        const odds = rules.rewardOdds(winner.rating, winner.winStreak);
        const roll = rules.sha256(`${seed}:rarity`).readUInt32BE(0) % 100;
        const rarity = rules.pickRarity(roll, odds);
        const cardId = `RW-${txId.slice(0, 12).toUpperCase()}`;
        if (await readState(ctx, keys.card(cardId))) {
            throw conflict(`Reward card ${cardId} already exists`);
        }
        const attrs = { cardId, ...rules.generateCardAttributes(`${seed}:card`, rarity) };
        const card = newCard(attrs, winner.playerId, 'BATTLE_REWARD', txTime(ctx), txId);
        await writeState(ctx, keys.card(cardId), card);
        return { card, roll, odds };
    }

    async CreateTrade(ctx, tradeId, fromPlayer, offeredCardId, toPlayer, requestedCardId) {
        requireCardId(tradeId, 'Trade ID');
        requireId(fromPlayer, 'Offering player ID');
        requireId(toPlayer, 'Receiving player ID');
        requireCardId(offeredCardId, 'Offered card ID');
        requireCardId(requestedCardId, 'Requested card ID');
        if (fromPlayer === toPlayer) {
            throw invalid('A player cannot trade with themselves');
        }
        if (await readState(ctx, keys.trade(tradeId))) {
            throw conflict(`Trade ${tradeId} already exists`);
        }
        const from = await this._requirePlayer(ctx, fromPlayer);
        const to = await this._requirePlayer(ctx, toPlayer);
        const offered = await this._requireCard(ctx, offeredCardId);
        const requested = await this._requireCard(ctx, requestedCardId);

        if (offered.owner !== fromPlayer) {
            throw forbidden(`Card ${offered.name} (${offeredCardId}) is not owned by ${from.username}`);
        }
        if (requested.owner !== toPlayer) {
            throw forbidden(`Card ${requested.name} (${requestedCardId}) is not owned by ${to.username}`);
        }
        for (const card of [offered, requested]) {
            if (card.locked) {
                throw conflict(`Card ${card.cardId} is already locked in trade ${card.lockedByTrade}`);
            }
        }

        offered.locked = true;
        offered.lockedByTrade = tradeId;
        requested.locked = true;
        requested.lockedByTrade = tradeId;

        const trade = {
            docType: 'trade',
            tradeId,
            fromPlayer,
            fromUsername: from.username,
            offeredCardId,
            offeredCardName: offered.name,
            toPlayer,
            toUsername: to.username,
            requestedCardId,
            requestedCardName: requested.name,
            status: 'OPEN',
            createdAt: txTime(ctx),
            createdTxId: ctx.stub.getTxID(),
            closedAt: null,
            closedTxId: null,
        };
        await writeState(ctx, keys.card(offeredCardId), offered);
        await writeState(ctx, keys.card(requestedCardId), requested);
        await writeState(ctx, keys.trade(tradeId), trade);
        return trade;
    }

    async AcceptTrade(ctx, tradeId, acceptingPlayer) {
        requireCardId(tradeId, 'Trade ID');
        requireId(acceptingPlayer, 'Accepting player ID');
        const trade = await this._requireOpenTrade(ctx, tradeId);
        if (trade.toPlayer !== acceptingPlayer) {
            throw forbidden(`Only ${trade.toPlayer} can accept trade ${tradeId}`);
        }
        const offered = await this._requireCard(ctx, trade.offeredCardId);
        const requested = await this._requireCard(ctx, trade.requestedCardId);
        if (offered.owner !== trade.fromPlayer || requested.owner !== trade.toPlayer ||
            offered.lockedByTrade !== tradeId || requested.lockedByTrade !== tradeId) {
            throw conflict(`Cards in trade ${tradeId} no longer match the trade terms`);
        }

        offered.owner = trade.toPlayer;
        requested.owner = trade.fromPlayer;
        for (const card of [offered, requested]) {
            card.locked = false;
            card.lockedByTrade = null;
        }
        trade.status = 'ACCEPTED';
        trade.closedAt = txTime(ctx);
        trade.closedTxId = ctx.stub.getTxID();

        await writeState(ctx, keys.card(offered.cardId), offered);
        await writeState(ctx, keys.card(requested.cardId), requested);
        await writeState(ctx, keys.trade(tradeId), trade);
        return { trade, cards: [offered, requested] };
    }

    async CancelTrade(ctx, tradeId, playerId) {
        requireCardId(tradeId, 'Trade ID');
        requireId(playerId, 'Player ID');
        const trade = await this._requireOpenTrade(ctx, tradeId);
        if (trade.fromPlayer !== playerId) {
            throw forbidden(`Only ${trade.fromUsername}, who created trade ${tradeId}, can cancel it`);
        }
        return this._closeTrade(ctx, trade, 'CANCELLED');
    }

    async DeclineTrade(ctx, tradeId, playerId) {
        requireCardId(tradeId, 'Trade ID');
        requireId(playerId, 'Player ID');
        const trade = await this._requireOpenTrade(ctx, tradeId);
        if (trade.toPlayer !== playerId) {
            throw forbidden(`Only ${trade.toUsername} can decline trade ${tradeId}`);
        }
        return this._closeTrade(ctx, trade, 'DECLINED');
    }

    async GetAllCards(ctx) {
        return sortCards(await scanPrefix(ctx, 'CARD_'));
    }

    async GetCardPacks() {
        return rules.CARD_PACKS;
    }

    async BuyCardPack(ctx, playerId, packId) {
        requireId(playerId, 'Player ID');
        const pack = rules.CARD_PACKS.find((p) => p.packId === packId);
        if (!pack) {
            throw invalid(`Unknown card pack ${packId}`);
        }
        const player = await this._requirePlayer(ctx, playerId);
        if (player.coins < pack.price) {
            throw conflict(`${pack.name} costs ${pack.price} coins but ${player.username} has ${player.coins}`);
        }
        const txId = ctx.stub.getTxID();
        const cardId = `PK-${txId.slice(0, 12).toUpperCase()}`;
        if (await readState(ctx, keys.card(cardId))) {
            throw conflict(`Card ${cardId} already exists`);
        }
        const seed = `${txId}:${playerId}:${packId}`;
        const roll = rules.sha256(`${seed}:rarity`).readUInt32BE(0) % 100;
        const rarity = rules.pickRarity(roll, pack.odds);
        const card = newCard({ cardId, ...rules.generateCardAttributes(`${seed}:card`, rarity) },
            playerId, 'PACK', txTime(ctx), txId);

        player.coins -= pack.price;
        await writeState(ctx, keys.player(playerId), player);
        await writeState(ctx, keys.card(cardId), card);
        return { card, pack, roll, coins: player.coins };
    }

    async SendFriendRequest(ctx, requestId, fromPlayer, toUsername) {
        requireCardId(requestId, 'Request ID');
        requireId(fromPlayer, 'Player ID');
        if (typeof toUsername !== 'string' || !USERNAME_PATTERN.test(toUsername)) {
            throw invalid('Enter a valid username');
        }
        const from = await this._requirePlayer(ctx, fromPlayer);
        const index = await readState(ctx, keys.username(toUsername));
        if (!index) {
            throw notFound(`No player is called ${toUsername}`);
        }
        const to = await this._requirePlayer(ctx, index.playerId);
        if (to.playerId === from.playerId) {
            throw invalid('You cannot send a friend request to yourself');
        }
        if (await readState(ctx, keys.friendship(from.playerId, to.playerId))) {
            throw conflict(`${from.username} and ${to.username} are already friends`);
        }
        if (await readState(ctx, keys.friendRequest(requestId))) {
            throw conflict(`Friend request ${requestId} already exists`);
        }
        const pending = (await scanPrefix(ctx, 'FRIENDREQ_')).find((r) => r.status === 'PENDING' &&
            ((r.fromPlayer === from.playerId && r.toPlayer === to.playerId) ||
             (r.fromPlayer === to.playerId && r.toPlayer === from.playerId)));
        if (pending) {
            throw conflict(`A friend request between ${from.username} and ${to.username} is already pending`);
        }
        const request = {
            docType: 'friendRequest',
            requestId,
            fromPlayer: from.playerId,
            fromUsername: from.username,
            toPlayer: to.playerId,
            toUsername: to.username,
            status: 'PENDING',
            createdAt: txTime(ctx),
            closedAt: null,
        };
        await writeState(ctx, keys.friendRequest(requestId), request);
        return request;
    }

    async RespondFriendRequest(ctx, requestId, playerId, decision) {
        requireCardId(requestId, 'Request ID');
        requireId(playerId, 'Player ID');
        if (!['ACCEPT', 'DECLINE'].includes(decision)) {
            throw invalid('Decision must be ACCEPT or DECLINE');
        }
        const request = await readState(ctx, keys.friendRequest(requestId));
        if (!request) {
            throw notFound(`Friend request ${requestId} does not exist`);
        }
        if (request.status !== 'PENDING') {
            throw conflict(`Friend request ${requestId} is already ${request.status.toLowerCase()}`);
        }
        if (request.toPlayer !== playerId) {
            throw forbidden(`Only ${request.toUsername} can respond to this friend request`);
        }
        request.status = decision === 'ACCEPT' ? 'ACCEPTED' : 'DECLINED';
        request.closedAt = txTime(ctx);
        await writeState(ctx, keys.friendRequest(requestId), request);
        if (decision === 'ACCEPT') {
            await writeState(ctx, keys.friendship(request.fromPlayer, request.toPlayer), {
                docType: 'friendship',
                players: [request.fromPlayer, request.toPlayer].sort(),
                since: request.closedAt,
            });
        }
        return request;
    }

    async RemoveFriend(ctx, playerId, friendId) {
        requireId(playerId, 'Player ID');
        requireId(friendId, 'Friend ID');
        const key = keys.friendship(playerId, friendId);
        if (!(await readState(ctx, key))) {
            throw notFound(`${friendId} is not in your friends list`);
        }
        await ctx.stub.deleteState(key);
        writeCache(ctx).delete(key);
        return { removed: friendId };
    }

    async GetFriends(ctx, playerId) {
        requireId(playerId, 'Player ID');
        await this._requirePlayer(ctx, playerId);
        const friendships = (await scanPrefix(ctx, 'FRIEND_')).filter((f) => f.players.includes(playerId));
        const friends = [];
        for (const f of friendships) {
            const friendId = f.players.find((id) => id !== playerId);
            const friend = await readState(ctx, keys.player(friendId));
            if (friend) {
                friends.push({ ...withDefaults(friend), since: f.since });
            }
        }
        const requests = (await scanPrefix(ctx, 'FRIENDREQ_')).filter((r) => r.status === 'PENDING');
        return {
            friends: friends.sort((a, b) => a.username.localeCompare(b.username)),
            incoming: requests.filter((r) => r.toPlayer === playerId),
            outgoing: requests.filter((r) => r.fromPlayer === playerId),
        };
    }

    async _closeTrade(ctx, trade, status) {
        const cards = [];
        for (const cardId of [trade.offeredCardId, trade.requestedCardId]) {
            const card = await this._requireCard(ctx, cardId);
            if (card.lockedByTrade === trade.tradeId) {
                card.locked = false;
                card.lockedByTrade = null;
                await writeState(ctx, keys.card(cardId), card);
            }
            cards.push(card);
        }
        trade.status = status;
        trade.closedAt = txTime(ctx);
        trade.closedTxId = ctx.stub.getTxID();
        await writeState(ctx, keys.trade(trade.tradeId), trade);
        return { trade, cards };
    }

    async _requirePlayer(ctx, playerId) {
        const player = await readState(ctx, keys.player(playerId));
        if (!player) {
            throw notFound(`Player ${playerId} does not exist`);
        }
        return withDefaults(player);
    }

    async _requireCard(ctx, cardId) {
        const card = await readState(ctx, keys.card(cardId));
        if (!card) {
            throw notFound(`Card ${cardId} does not exist`);
        }
        return card;
    }

    async _requireOpenTrade(ctx, tradeId) {
        const trade = await readState(ctx, keys.trade(tradeId));
        if (!trade) {
            throw notFound(`Trade ${tradeId} does not exist`);
        }
        if (trade.status !== 'OPEN') {
            throw conflict(`Trade ${tradeId} is already ${trade.status.toLowerCase()}`);
        }
        return trade;
    }

    async _loadBattleCards(ctx, player, cardIds) {
        const cards = [];
        for (const cardId of cardIds) {
            const card = await this._requireCard(ctx, cardId);
            if (card.owner !== player.playerId) {
                throw forbidden(`Card ${cardId} is not owned by ${player.playerId}`);
            }
            if (card.locked) {
                throw conflict(`Card ${cardId} is locked in trade ${card.lockedByTrade} and cannot battle`);
            }
            cards.push(card);
        }
        return cards;
    }
}

// Transaction names the backend is allowed to call, split by read and write.
const READ_TRANSACTIONS = [
    'PlayerExists', 'GetPlayer', 'GetCard', 'GetPlayerCards', 'GetLeaderboard', 'GetLedgerStats',
    'GetOpenTrades', 'GetPlayerTrades', 'GetBattle', 'GetPlayerBattles', 'GetAllCards', 'GetCardPacks', 'GetFriends',
];
const WRITE_TRANSACTIONS = [
    'InitLedger', 'RegisterPlayer', 'Battle', 'RewardWinner', 'CreateTrade', 'AcceptTrade', 'CancelTrade',
    'DeclineTrade', 'BuyCardPack', 'SendFriendRequest', 'RespondFriendRequest', 'RemoveFriend',
];

module.exports = { TcgGame, GameError, SEED_PLAYERS, READ_TRANSACTIONS, WRITE_TRANSACTIONS, keys };
