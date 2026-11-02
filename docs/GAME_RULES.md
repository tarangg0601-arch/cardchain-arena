# Game Rules

All rules below are implemented once, in `chaincode/lib/rules.js` and `chaincode/lib/tcgGame.js`.
The Fabric contract and the local demonstration ledger both run that same code, so a battle gives
the same result in either mode.

## Cards

| Field | Meaning |
|---|---|
| `cardId` | Unique ID, e.g. `P1-04`, `player-3fa91c-S2`, `RW-1A2B3C4D5E6F` |
| `name` | Readable name chosen from the card catalogue for its type and rarity |
| `owner` | Player ID of the current owner |
| `attack`, `defense` | Base stats |
| `type` | Fire, Water, Earth or Air |
| `rarity` | Common, Rare, Epic or Legendary |
| `xp` | Experience earned in battles |
| `locked`, `lockedByTrade` | Trade-lock status. A locked card cannot battle or join another trade |
| `origin`, `mintedAt`, `mintedTxId` | Where the card came from (demo seed, starter, battle reward) |

Base stat ranges by rarity (generated cards add 0-19 to the minimum):

| Rarity | Attack | Defense |
|---|---|---|
| Common | 40-59 | 30-49 |
| Rare | 55-74 | 45-64 |
| Epic | 70-89 | 60-79 |
| Legendary | 85-104 | 75-94 |

## Players

Every player has a player ID, username, skill rating, wins, losses, draws and current win streak.
New players start at rating 1000 with zero wins, losses, draws and streak.

## Card generation (deterministic)

Chaincode must give the same result on every peer, so it never uses `Math.random()` or the clock.
New card attributes come from a SHA-256 hash of a seed string:

- byte 0 picks the type (unless the type is fixed), byte 1 picks one of two names,
  byte 2 adds 0-19 to attack and byte 3 adds 0-19 to defense.
- Starter cards (`RegisterPlayer`): seed is `starter:<playerId>:<n>`. A new player always gets
  two Commons and one Rare, each of a different type. Card IDs are `<playerId>-S1` to `-S3`.
- Reward cards (`RewardWinner`): seed is `<txId>:<playerId>:<rating>:<winStreak>`. The card ID is
  `RW-` plus the first 12 characters of the transaction ID.

## Battles

The challenger picks three of their own cards; the order of selection is the round order. The
opponent's cards are hidden from the challenger: the contract draws three of the opponent's
unlocked cards by sorting them on `SHA-256(txId:opponentId:cardId)` and taking the first three, so
every peer draws the same cards and nobody can choose them in advance.

Before a battle the contract checks that both players exist, they are different players, the
challenger sent exactly three different cards that exist, belong to them and are not locked, and
that the opponent has at least three unlocked cards. Any problem rejects the whole transaction and
nothing is changed.

### 1. Rarity bonus

Both attack and defense are increased by the card's rarity bonus:

| Common | Rare | Epic | Legendary |
|---|---|---|---|
| +0% | +5% | +10% | +15% |

### 2. Type advantage

**Fire > Air > Earth > Water > Fire.** If a card's type beats the other card's type, its attack
is multiplied by **1.2**. Fire vs Earth and Water vs Air have no advantage either way.

### 3. Round resolution

```
effective attack  = attack  x (1 + rarity bonus) x (1.2 if type advantage, else 1)
effective defense = defense x (1 + rarity bonus)
damage dealt      = max(0, my effective attack - their effective defense)
```

The card that deals more damage wins the round. Equal damage (including both dealing 0) is a drawn
round. The contract calculates in whole hundredths so every peer gets exactly the same numbers.

The player who wins more rounds wins the battle. Equal round wins (for example 1-1 with one drawn
round, or 0-0) is a **draw**.

### Worked example (seed cards)

Round 1: player1's Thunder Griffin (Air, Legendary, 96/82) vs player2's Inferno Drake (Fire, Epic, 80/66).

| | Thunder Griffin | Inferno Drake |
|---|---|---|
| Rarity bonus | +15% | +10% |
| Type advantage | no | yes, Fire beats Air (x1.2) |
| Effective attack | 96 x 1.15 = 110.40 | 80 x 1.10 x 1.2 = 105.60 |
| Effective defense | 82 x 1.15 = 94.30 | 66 x 1.10 = 72.60 |
| Damage dealt | 110.40 - 72.60 = **37.80** | 105.60 - 94.30 = **11.30** |

Thunder Griffin wins the round despite the type disadvantage, because of its higher base stats.

### 4. Skill rating (Elo)

```
expected score = 1 / (1 + 10 ^ ((opponent rating - my rating) / 400))
rating change  = round(32 x (actual score - expected score))     actual: win 1, draw 0.5, loss 0
```

The change is zero-sum: one player gains exactly what the other loses. Ratings never go below 100.

| Ratings (me vs them) | Win | Draw | Loss |
|---|---|---|---|
| 1000 vs 1000 | +16 | 0 | -16 |
| 900 vs 1100 | +24 | +8 | -8 |
| 1200 vs 1000 | +8 | -8 | -24 |

### 5. Records, XP and coins

- Win: wins +1, win streak +1, **+20 coins**. Loss: losses +1, streak reset to 0. Draw: draws +1,
  streak reset to 0. No coins for a loss or draw.
- Each card used gets XP for its own round: **20** for a round win, **10** for a drawn round,
  **5** for a round loss.

### 6. Winner reward

When a battle has a winner, `Battle` calls `RewardWinner` inside the same transaction, after the
winner's new rating and streak are saved. A drawn battle gives no reward.

```
skill bonus  = floor((rating - 1000) / 20), between 0 and 20
streak bonus = 3 x win streak, at most 15 (5 wins)
bonus        = skill bonus + streak bonus           (0 to 35)

Common    = 60 - bonus
Rare      = 28 + bonus - floor(bonus/5) - floor(bonus/3)
Epic      = 10 + floor(bonus/3)
Legendary =  2 + floor(bonus/5)
```

The weights always add up to 100. The roll is `SHA-256(seed + ":rarity")` read as a number, modulo
100. Rolls below the Common weight give Common, the next band Rare, then Epic, then Legendary.

| Winner | Bonus | Common | Rare | Epic | Legendary |
|---|---|---|---|---|---|
| Rating 1016, first win | 3 | 57% | 30% | 11% | 2% |
| Rating 1050, 2-win streak | 8 | 52% | 33% | 12% | 3% |
| Rating 1100, 3-win streak | 14 | 46% | 36% | 14% | 4% |
| Rating 1200, 5-win streak | 25 | 35% | 40% | 18% | 7% |
| Rating 1400+, 5+ streak | 35 | 25% | 45% | 21% | 9% |

`RewardWinner` refuses to run unless the transaction that invoked it is `Battle`, so a client
cannot call it directly to mint free cards. On Fabric this is checked by the peers themselves.

## Coins and card packs

Every new player starts with **100 coins**. `BuyCardPack(playerId, packId)` checks the balance,
subtracts the price and mints one card. The rarity roll is `SHA-256(txId:playerId:packId:rarity)`
modulo 100, read against the pack's odds; the card ID is `PK-` plus the first 12 characters of the
transaction ID.

| Pack | Price | Common | Rare | Epic | Legendary |
|---|---|---|---|---|---|
| Standard | 30 | 70% | 24% | 5% | 1% |
| Premium | 75 | 0% | 60% | 32% | 8% |
| Elite | 150 | 0% | 0% | 70% | 30% |

Not enough coins rejects the transaction (CONFLICT) and nothing changes.

## Friends

- `SendFriendRequest(requestId, fromPlayer, toUsername)` finds the player by username and rejects
  unknown names, requests to yourself, existing friends and a request already pending in either direction.
- `RespondFriendRequest(requestId, playerId, ACCEPT|DECLINE)` only works for the receiver.
  Accepting writes a `FRIEND_<a>:<b>` record.
- `RemoveFriend(playerId, friendId)` deletes that record.

## Trades

- `CreateTrade(tradeId, fromPlayer, offeredCardId, toPlayer, requestedCardId)` checks that both
  players exist and differ, the offered card belongs to `fromPlayer`, the requested card belongs
  to `toPlayer`, the trade ID is new, and neither card is already locked. Both cards are then
  locked with the trade ID. The app lists every card without its owner, so asking a player for a
  card they do not own is rejected here: "Card Thunder Griffin (P1-04) is not owned by player2".
- `AcceptTrade(tradeId, acceptingPlayer)` only works for the trade's `toPlayer` while it is OPEN.
  It swaps the owners of the two cards, unlocks them and marks the trade ACCEPTED.
- `DeclineTrade(tradeId, playerId)` only works for the trade's `toPlayer` while it is OPEN. It
  unlocks both cards and marks the trade DECLINED.
- `CancelTrade(tradeId, playerId)` only works for the trade's `fromPlayer` while it is OPEN. It
  unlocks both cards and marks the trade CANCELLED.

Every check happens before anything is written. A rejected transaction changes nothing.

## Error codes

Contract errors start with a code that the backend turns into an HTTP status, in both modes:

| Code | HTTP | Example |
|---|---|---|
| `INVALID_ARGUMENT` | 400 | Selecting the same card twice |
| `FORBIDDEN` | 403 | Accepting a trade meant for someone else |
| `NOT_FOUND` | 404 | Unknown player, card or trade |
| `CONFLICT` | 409 | Card already locked, trade already closed |
