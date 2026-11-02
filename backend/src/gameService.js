'use strict';

const crypto = require('crypto');
const { AppError } = require('./errors');

function requireString(value, label) {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new AppError(400, 'INVALID_REQUEST', `${label} is required`);
    }
    return value.trim();
}

function requireThreeCards(value, label) {
    if (!Array.isArray(value) || value.length !== 3 || value.some((id) => typeof id !== 'string' || !id)) {
        throw new AppError(400, 'INVALID_REQUEST', `Select exactly 3 cards for ${label}`);
    }
    return value;
}

// Every write uses the authenticated player's ID taken from the session,
// never an ID sent by the browser, so users can only act as themselves.
class GameService {
    constructor(ledger) {
        this.ledger = ledger;
    }

    getPlayer(playerId) {
        return this.ledger.evaluate('GetPlayer', playerId);
    }

    getPlayerCards(playerId) {
        return this.ledger.evaluate('GetPlayerCards', playerId);
    }

    getLeaderboard() {
        return this.ledger.evaluate('GetLeaderboard');
    }

    getOpenTrades() {
        return this.ledger.evaluate('GetOpenTrades');
    }

    getPlayerTrades(playerId) {
        return this.ledger.evaluate('GetPlayerTrades', playerId);
    }

    getBattle(battleId) {
        return this.ledger.evaluate('GetBattle', battleId);
    }

    getPlayerBattles(playerId) {
        return this.ledger.evaluate('GetPlayerBattles', playerId);
    }

    // The opponent's cards are never sent by the browser; the contract draws them.
    async battle(actorId, body) {
        const opponentId = requireString(body.opponentId, 'Opponent');
        const myCards = requireThreeCards(body.myCardIds, 'your side');
        const { result, txId, blockNumber } = await this.ledger.submit(
            'Battle', actorId, JSON.stringify(myCards), opponentId);
        return { battle: result, txId, blockNumber };
    }

    // Every card on the ledger that the player does not own, without owner or
    // lock details, so players can ask for a card without seeing who holds it.
    async cardCatalog(actorId) {
        const cards = await this.ledger.evaluate('GetAllCards');
        return cards
            .filter((c) => c.owner !== actorId)
            .map(({ cardId, name, type, rarity, attack, defense }) => ({ cardId, name, type, rarity, attack, defense }));
    }

    getPacks() {
        return this.ledger.evaluate('GetCardPacks');
    }

    async buyPack(actorId, body) {
        const packId = requireString(body.packId, 'Card pack');
        const { result, txId, blockNumber } = await this.ledger.submit('BuyCardPack', actorId, packId);
        return { ...result, txId, blockNumber };
    }

    getFriends(actorId) {
        return this.ledger.evaluate('GetFriends', actorId);
    }

    async sendFriendRequest(actorId, body) {
        const username = requireString(body.username, 'Username');
        const requestId = `F-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
        const { result, txId, blockNumber } = await this.ledger.submit('SendFriendRequest', requestId, actorId, username);
        return { request: result, txId, blockNumber };
    }

    async respondFriendRequest(actorId, requestId, decision) {
        const { result, txId, blockNumber } = await this.ledger.submit('RespondFriendRequest', requestId, actorId, decision);
        return { request: result, txId, blockNumber };
    }

    async removeFriend(actorId, friendId) {
        const { result, txId, blockNumber } = await this.ledger.submit('RemoveFriend', actorId, friendId);
        return { ...result, txId, blockNumber };
    }

    async notifications(actorId) {
        const [friends, trades] = await Promise.all([this.getFriends(actorId), this.getPlayerTrades(actorId)]);
        return {
            friendRequests: friends.incoming.length,
            tradeRequests: trades.filter((t) => t.status === 'OPEN' && t.toPlayer === actorId).length,
        };
    }

    async createTrade(actorId, body) {
        const toPlayer = requireString(body.toPlayer, 'Recipient');
        const offeredCardId = requireString(body.offeredCardId, 'Offered card');
        const requestedCardId = requireString(body.requestedCardId, 'Requested card');
        const tradeId = `T-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
        const { result, txId, blockNumber } = await this.ledger.submit(
            'CreateTrade', tradeId, actorId, offeredCardId, toPlayer, requestedCardId);
        return { trade: result, txId, blockNumber };
    }

    async acceptTrade(actorId, tradeId) {
        const { result, txId, blockNumber } = await this.ledger.submit('AcceptTrade', tradeId, actorId);
        return { ...result, txId, blockNumber };
    }

    async cancelTrade(actorId, tradeId) {
        const { result, txId, blockNumber } = await this.ledger.submit('CancelTrade', tradeId, actorId);
        return { ...result, txId, blockNumber };
    }

    async declineTrade(actorId, tradeId) {
        const { result, txId, blockNumber } = await this.ledger.submit('DeclineTrade', tradeId, actorId);
        return { ...result, txId, blockNumber };
    }
}

module.exports = { GameService };
