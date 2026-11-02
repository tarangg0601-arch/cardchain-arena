# Trading Card Game on Hyperledger Fabric

A web-based trading card game whose players, cards, ownership, battles, rewards and trades are
managed by a Hyperledger Fabric smart contract. Players register, log in, build a deck, battle
other players and trade cards. Accounts and passwords are kept off-chain by the backend.

This is the **100% build** for the first evaluation.

## Features in this build

- Account registration, login, logout, persistent sessions with expiry, password hashing (scrypt),
  login attempt limiting, and protected game routes
- Each account linked to an on-chain player created by `RegisterPlayer` with 3 starter cards
  (2 Common, 1 Rare) and 100 coins
- `InitLedger` demo data: `player1` and `player2` with 4 cards each, safe to run repeatedly
- Battles with 3 cards per side: the player picks their own 3 cards (or a random pick) and the
  opponent's 3 cards stay hidden and are drawn by the contract from the transaction ID. Ownership and
  lock validation, rarity bonuses, Fire > Air > Earth > Water > Fire type advantage (x1.2 attack),
  round results, Elo ratings, XP, win streaks, draws, +20 coins for the winner, and a 3-4 second
  fight animation before the result
- Deterministic winner rewards via `RewardWinner`, called only from inside `Battle`, with odds that
  improve with rating and win streak
- Trade requests: choose what you give and what you want from a list of every other card (owners
  hidden). `CreateTrade` checks the recipient really owns the requested card and rejects it otherwise,
  then locks both cards; `AcceptTrade` or `DeclineTrade` (recipient only) and `CancelTrade` (creator only)
- Card shop: `BuyCardPack` spends coins and mints a card with the pack's odds (Standard, Premium, Elite)
- Friends: `SendFriendRequest` by username, `RespondFriendRequest` (accept or decline), `RemoveFriend`,
  all recorded on the ledger; friends are listed first when choosing an opponent or trade partner
- Reads: player details, player cards, open trades, player trade history, battle history, leaderboard, ledger stats
- **Ledger explorer**: real Fabric blocks read from the peer (via the `qscc` system chaincode) showing
  block hashes, transaction IDs, the submitting identity, endorsing organisations, validation codes and
  the world-state keys each transaction wrote, plus a **Verify chain** check and a list of rejected
  transactions
- Three ledger modes: **Fabric**, **Local** (persistent JSON ledger running the same contract code)
  and **Auto** (Fabric with fallback to Local at startup)
- React UI with a sidebar: Dashboard (with your cards), My deck, Battle arena, Trade market, Card shop,
  Friends, Leaderboard and Ledger explorer; badges for incoming trade and friend requests; coin balance;
  live network status; demo player switcher; and a receipt with the block number and transaction ID
  after every write
- Five visual themes chosen with the **Theme** button (sidebar and login page): Arcane, Forge,
  Forest, Frost and Infernal. Each has its own colours, fonts, panel textures and animated background
  (embers, fireflies, snow). The choice is kept in the browser and only changes the look
- Code-drawn card artwork: each card shows its element emblem over an element scene, with rays,
  sparkles and gems that grow with rarity
- 99 automated tests across chaincode, backend and frontend

Not in this build (reserved for the final evaluation): commit-reveal battles, card fusion, and the
card provenance/audit view.

## Project structure

```
chaincode/            Hyperledger Fabric smart contract (JavaScript)
  lib/rules.js          Pure game rules: stats, battle maths, Elo, reward odds, card generation
  lib/tcgGame.js        All transactions (InitLedger, RegisterPlayer, Battle, RewardWinner, trades, reads)
  lib/tcgContract.js    Fabric Contract class exposing tcgGame.js as chaincode functions
  test/                 Contract tests against an in-memory Fabric-like stub
backend/              Express API
  src/auth/             Accounts, password hashing, sessions (off-chain, data/auth.json)
  src/ledger/           fabricLedger.js (Fabric Gateway), localLedger.js (JSON ledger), mode selection,
                        blockDecoder.js + explorer.js (block decoding, hash checks), tracker.js (rejected txs)
  src/gameService.js    Game actions, always performed as the logged-in player
  src/app.js            HTTP routes and error handling
  test/                 API, auth, ledger-mode and persistence tests
frontend/             React (Vite) user interface
  src/pages/            Login, Register, Dashboard, Deck, Battle, Trade, Leaderboard, Ledger explorer
  src/components/       Sidebar layout, trading card and card art, battle result, network status
  src/theme/            Theme list, theme picker, background effects and themes.css
  src/test/             Component, auth-flow and explorer tests
scripts/fabric-network.sh   Start the Fabric test network and deploy the chaincode
docs/                 Game rules, Fabric setup and demonstration guide
```

## Requirements

- Node.js **22 LTS** (20.19 or newer also works) and npm
- For Fabric mode only: Docker, and Linux/macOS or Windows with WSL2 (see `docs/FABRIC_SETUP.md`)

## Quick start (Local mode, no Docker needed)

```bash
npm run setup          # installs chaincode, backend and frontend dependencies
npm run build          # builds the React app
npm run start:local    # starts the backend on http://localhost:4000
```

Open http://localhost:4000 and click **Continue as player1**, or create your own account.

For frontend development with hot reload, run `npm run start:local` in one terminal and
`npm run dev:frontend` in another, then open http://localhost:5173.

## Running with Hyperledger Fabric

```bash
./scripts/fabric-network.sh up       # needs fabric-samples next to this folder
./scripts/fabric-network.sh deploy
npm run build
npm run start:fabric
```

Full instructions, peer CLI commands for inspecting the ledger, and troubleshooting are in
[docs/FABRIC_SETUP.md](docs/FABRIC_SETUP.md).

## Operating modes

| Command | Mode | Behaviour |
|---|---|---|
| `npm run start:fabric` | Fabric | Connects to Fabric; refuses to start if it cannot |
| `npm run start:local` | Local | Uses `backend/data/local-ledger.json` |
| `npm start` | Auto | Tries Fabric at startup; falls back to Local and shows the reason |

`LEDGER_MODE` in `backend/.env` sets the default for `npm start`. The mode is fixed at startup:
a failed Fabric transaction is reported as an error and is never retried on the local ledger.
The status panel in the sidebar (and on the login page) always shows which mode is active.

## What runs where

| Data | Fabric mode | Local mode |
|---|---|---|
| Players, cards, ownership, XP, ratings, battles, rewards, trades | Fabric world state, endorsed by the peers and committed by the orderer | `backend/data/local-ledger.json` |
| Blocks in the Ledger explorer | Real blocks fetched from the peer and decoded | A simulated hash-linked log, one transaction per block, labelled "simulated" |
| Game rules | Chaincode on the peers | The same `chaincode/lib/tcgGame.js`, run by the backend |
| Accounts, password hashes, sessions | `backend/data/auth.json` (never on the ledger) | same |

Local mode keeps the same rules and the same all-or-nothing transaction behaviour (a failed
transaction writes nothing), but it is **not a blockchain**: there are no peers, signatures,
consensus or immutable history. Use it only when Fabric is unavailable.

**Trust model.** The backend signs every Fabric transaction with one application identity
(`User1@org1.example.com`); players are not individual Fabric identities. The backend
authenticates each user and passes their own player ID to the contract, and the contract enforces
the game rules and role checks (card ownership, only the recipient can accept a trade, only the
creator can cancel it, rewards only through battles). This is the usual custodial design for a
web game on a permissioned network.

## Demo accounts

| Username | Password | Player ID |
|---|---|---|
| player1 | demo1234 | player1 |
| player2 | demo1234 | player2 |

With `DEMO_MODE=true` (default) the login page has one-click buttons for these two, and the sidebar
has a **Demo player switcher**. The switcher lists the demo players plus accounts that have been
signed in on this browser with their own password, so it never lets one registered user act as
another. Set `DEMO_MODE=false` to turn the shortcuts off. **Log out** signs out every account on
the browser.

See [docs/DEMO_GUIDE.md](docs/DEMO_GUIDE.md) for a step-by-step presentation script, including
card selections that produce a win and a draw.

## Game rules

Summary: rarity bonus +0/5/10/15% on attack and defense; type advantage x1.2 attack;
damage = effective attack - opponent's effective defense; more damage wins the round; more rounds
wins the battle; Elo K = 32; XP 20/10/5 per round win/draw/loss; reward rarity odds from 60/28/10/2
improving with rating and win streak; 100 starting coins, +20 per win; packs cost 30, 75 and 150 coins. Formulas and worked examples are in
[docs/GAME_RULES.md](docs/GAME_RULES.md).

## Testing

```bash
npm test
```

| Suite | Tests | Covers |
|---|---|---|
| `chaincode` (node:test) | 34 | Rules maths, InitLedger idempotency, registration and coins, wins, draws, opponent card draw, invalid battles, lock checks, RewardWinner protection, trade create/accept/decline/cancel, requesting a card the recipient does not own, unauthorized and conflicting operations leave state unchanged, card packs, friends, leaderboard, ledger stats |
| `backend` (node:test + supertest) | 41 | Register/login/logout/session expiry/lockout, demo-login limits, passwords kept off the ledger, failed registration leaves no account, battles and trades through the API, local ledger persistence across restarts, auto/fabric mode selection, Fabric commit-status handling and error mapping, no false success on rejected writes, block log and write sets, chain verification detecting edited blocks, rejected-transaction feed, decoding two real Fabric blocks (test fixtures), opponent cards cannot be chosen by the browser, anonymous card catalog, trade decline and notifications, shop and friends through the API |
| `frontend` (Vitest + Testing Library) | 19 | Deck display, trade requests with the anonymous catalog, smart contract rejections, accept/decline, hidden opponent cards, random pick, fight animation then result, shop purchase and insufficient coins, friends, login/logout/expired session, ledger explorer, transaction receipts |

Each folder can also be tested on its own with `npm test` inside it.

## Configuration

Copy `backend/.env.example` to `backend/.env`. Main settings:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | 4000 | Backend port |
| `LEDGER_MODE` | auto | `auto`, `fabric` or `local` |
| `DATA_DIR` | ./data | Folder for `auth.json` and `local-ledger.json` |
| `SESSION_TTL_HOURS` | 12 | Session lifetime |
| `DEMO_MODE` / `DEMO_PASSWORD` | true / demo1234 | Demo shortcuts and demo account password |
| `FABRIC_CHANNEL` / `FABRIC_CHAINCODE` | mychannel / tcg | Channel and chaincode name |
| `FABRIC_PEER_ENDPOINT` | localhost:7051 | Gateway peer |
| `FABRIC_CRYPTO_PATH` | ../../fabric-samples/test-network/organizations/peerOrganizations/org1.example.com | Org1 crypto material |

## API

All routes are under `/api`. Everything except `status` and the `auth/*` login routes needs
`Authorization: Bearer <token>`. Errors are returned as `{ "error": { "code", "message" } }`.

| Method | Route | Purpose |
|---|---|---|
| GET | /status | Active ledger mode and fallback reason |
| POST | /auth/register | `{ username, password, confirmPassword }` |
| POST | /auth/login | `{ username, password }` |
| POST | /auth/demo-login | `{ playerId }` for seeded demo players (demo mode only) |
| POST | /auth/logout | Revokes the session |
| GET | /auth/me | Current account and player |
| GET | /players, /leaderboard | Players ordered by rating |
| GET | /players/:id, /players/:id/cards | Player details and cards |
| POST | /battles | `{ opponentId, myCardIds[3] }`; the contract draws the opponent's cards |
| GET | /battles/mine, /battles/:id | Battle history and details |
| GET | /trades/open, /trades/mine | Open trades, own trade history |
| POST | /trades | `{ toPlayer, offeredCardId, requestedCardId }` |
| POST | /trades/:id/accept, /trades/:id/decline, /trades/:id/cancel | Accept or decline (recipient), cancel (creator) |
| GET | /cards/catalog | Every card the player does not own, without owner or lock details |
| GET | /shop/packs, POST /shop/buy | Card packs; buy with `{ packId }` |
| GET | /friends | Friends, incoming and outgoing requests |
| POST | /friends/requests | `{ username }` |
| POST | /friends/requests/:id/accept, /friends/requests/:id/decline, /friends/:playerId/remove | Respond to a request or remove a friend |
| GET | /me/notifications | Counts of incoming trade and friend requests |
| GET | /ledger/summary | Block height, transaction counts, ledger stats, latest game transaction |
| GET | /ledger/blocks?before=&limit=, /ledger/blocks/:n | Decoded blocks, newest first |
| GET | /ledger/verify | Recompute all block hashes and check the chain links |
| GET | /ledger/rejected | Recently rejected write transactions (kept in memory) |

## Chaincode functions

Writes: `InitLedger`, `RegisterPlayer(playerId, username)`,
`Battle(challengerId, challengerCardsJson, opponentId)`, `RewardWinner(winnerId)` (only callable from
`Battle`), `CreateTrade(tradeId, fromPlayer, offeredCardId, toPlayer, requestedCardId)`,
`AcceptTrade(tradeId, acceptingPlayer)`, `DeclineTrade(tradeId, playerId)`, `CancelTrade(tradeId, playerId)`,
`BuyCardPack(playerId, packId)`, `SendFriendRequest(requestId, fromPlayer, toUsername)`,
`RespondFriendRequest(requestId, playerId, ACCEPT|DECLINE)`, `RemoveFriend(playerId, friendId)`.

Reads: `PlayerExists`, `GetPlayer`, `GetCard`, `GetPlayerCards`, `GetAllCards`, `GetLeaderboard`,
`GetLedgerStats`, `GetOpenTrades`, `GetPlayerTrades`, `GetBattle`, `GetPlayerBattles`, `GetCardPacks`,
`GetFriends`.

## Resetting data

- Local mode: stop the backend and delete `backend/data/`.
- Fabric mode: `./scripts/fabric-network.sh down`, then `up` and `deploy`. Delete
  `backend/data/auth.json` to remove accounts too.

## Troubleshooting

| Problem | Fix |
|---|---|
| Blank page at :4000 | Run `npm run build` first, or use `npm run dev:frontend` on :5173 |
| "Cannot reach the backend server" | Start the backend; check `PORT` |
| Amber "Local demo ledger" status when you expected Fabric | The status panel shows why Fabric failed; use `npm run start:fabric` to see the error at startup |
| `... local-ledger.json is not valid JSON` | The file was edited by hand; fix it or delete it to start over (the backend never resets it silently) |
| "Too many failed attempts" | Wait one minute after 5 wrong passwords |
