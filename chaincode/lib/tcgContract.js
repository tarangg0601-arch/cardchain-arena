'use strict';

const { Contract } = require('fabric-contract-api');
const { TcgGame } = require('./tcgGame');

const game = new TcgGame();
const toJson = (value) => JSON.stringify(value);

// Fabric entry points. All rules live in tcgGame.js; this class only exposes
// them as chaincode transactions and serialises the results.
class TcgContract extends Contract {
    constructor() {
        super('TcgContract');
    }

    async InitLedger(ctx) {
        return toJson(await game.InitLedger(ctx));
    }

    async RegisterPlayer(ctx, playerId, username) {
        return toJson(await game.RegisterPlayer(ctx, playerId, username));
    }

    async Battle(ctx, challengerId, challengerCardsJson, opponentId) {
        return toJson(await game.Battle(ctx, challengerId, challengerCardsJson, opponentId));
    }

    async RewardWinner(ctx, winnerId) {
        return toJson(await game.RewardWinner(ctx, winnerId));
    }

    async CreateTrade(ctx, tradeId, fromPlayer, offeredCardId, toPlayer, requestedCardId) {
        return toJson(await game.CreateTrade(ctx, tradeId, fromPlayer, offeredCardId, toPlayer, requestedCardId));
    }

    async AcceptTrade(ctx, tradeId, acceptingPlayer) {
        return toJson(await game.AcceptTrade(ctx, tradeId, acceptingPlayer));
    }

    async CancelTrade(ctx, tradeId, playerId) {
        return toJson(await game.CancelTrade(ctx, tradeId, playerId));
    }

    async DeclineTrade(ctx, tradeId, playerId) {
        return toJson(await game.DeclineTrade(ctx, tradeId, playerId));
    }

    async BuyCardPack(ctx, playerId, packId) {
        return toJson(await game.BuyCardPack(ctx, playerId, packId));
    }

    async SendFriendRequest(ctx, requestId, fromPlayer, toUsername) {
        return toJson(await game.SendFriendRequest(ctx, requestId, fromPlayer, toUsername));
    }

    async RespondFriendRequest(ctx, requestId, playerId, decision) {
        return toJson(await game.RespondFriendRequest(ctx, requestId, playerId, decision));
    }

    async RemoveFriend(ctx, playerId, friendId) {
        return toJson(await game.RemoveFriend(ctx, playerId, friendId));
    }

    async GetAllCards(ctx) {
        return toJson(await game.GetAllCards(ctx));
    }

    async GetCardPacks(ctx) {
        return toJson(await game.GetCardPacks(ctx));
    }

    async GetFriends(ctx, playerId) {
        return toJson(await game.GetFriends(ctx, playerId));
    }

    async PlayerExists(ctx, playerId) {
        return toJson(await game.PlayerExists(ctx, playerId));
    }

    async GetPlayer(ctx, playerId) {
        return toJson(await game.GetPlayer(ctx, playerId));
    }

    async GetCard(ctx, cardId) {
        return toJson(await game.GetCard(ctx, cardId));
    }

    async GetPlayerCards(ctx, playerId) {
        return toJson(await game.GetPlayerCards(ctx, playerId));
    }

    async GetLeaderboard(ctx) {
        return toJson(await game.GetLeaderboard(ctx));
    }

    async GetLedgerStats(ctx) {
        return toJson(await game.GetLedgerStats(ctx));
    }

    async GetOpenTrades(ctx) {
        return toJson(await game.GetOpenTrades(ctx));
    }

    async GetPlayerTrades(ctx, playerId) {
        return toJson(await game.GetPlayerTrades(ctx, playerId));
    }

    async GetBattle(ctx, battleId) {
        return toJson(await game.GetBattle(ctx, battleId));
    }

    async GetPlayerBattles(ctx, playerId) {
        return toJson(await game.GetPlayerBattles(ctx, playerId));
    }
}

module.exports = TcgContract;
