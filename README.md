# CardChain Arena

A browser-based trading card game built with **React**, **Node.js**, and **Hyperledger Fabric**. Players collect cards, build a deck, challenge other players, trade cards, open card packs, and track game activity through a ledger explorer.

The application can run against a local JSON ledger for development or connect to a Hyperledger Fabric test network.

## Features

- **Player accounts** – registration, login, logout, persistent sessions, and password hashing.
- **Card collection and deck** – view owned cards and filter the collection by card attributes.
- **Battles** – choose an opponent and three cards, resolve a three-round match, and view battle results and history. The opponent's cards are selected by the game logic rather than by the challenger.
- **Player ratings and rewards** – battle results update player statistics, experience, coins, and ratings. Winning a battle can also award a card.
- **Card shop** – spend in-game coins on Standard, Premium, and Elite card packs.
- **Trading** – create, accept, decline, and cancel card trade requests. Cards involved in an open trade are locked until the trade is resolved.
- **Friends** – send and respond to friend requests, manage your friends list, and use it to find battle or trade partners.
- **Leaderboard** – compare player ratings and battle records.
- **Ledger explorer** – inspect blocks and transactions, view transaction details, and run the available ledger integrity check.
- **Network status** – see whether the application is using Hyperledger Fabric or the local demonstration ledger.
- **Themes and card artwork** – choose from five visual themes: Arcane, Forge, Forest, Frost, and Infernal. Card artwork is rendered in the frontend.

## Technology

| Part | Technologies |
|---|---|
| Frontend | React 19, React Router, Vite, CSS |
| Backend | Node.js, Express 5 |
| Smart contract | JavaScript, Hyperledger Fabric Contract API and Fabric Shim |
| Fabric connection | Hyperledger Fabric Gateway over gRPC/TLS |
| Tests | Node.js test runner, Vitest, Testing Library, Supertest |

## How it is structured

```text
cardchain-arena/
├── chaincode/
│   ├── index.js
│   ├── lib/
│   │   ├── rules.js          # Card generation and game calculations
│   │   ├── tcgGame.js        # Ledger transactions and queries
│   │   └── tcgContract.js    # Fabric contract interface
│   └── test/                 # Chaincode tests
├── backend/
│   ├── src/
│   │   ├── auth/             # Accounts, password hashing and sessions
│   │   ├── ledger/           # Fabric and local ledger adapters, explorer
│   │   ├── app.js            # Express API routes
│   │   ├── config.js         # Environment-based configuration
│   │   ├── gameService.js    # Game operations used by the API
│   │   └── server.js         # Backend startup
│   ├── test/                 # Backend tests
│   └── .env.example          # Example backend configuration
├── frontend/
│   ├── src/
│   │   ├── auth/             # Authentication state
│   │   ├── components/       # Shared UI components
│   │   ├── ledger/           # Ledger state and formatting
│   │   ├── pages/            # Game pages
│   │   ├── test/             # Frontend tests
│   │   └── theme/            # Themes and theme effects
│   └── vite.config.js
├── docs/
│   ├── DEMO_GUIDE.md         # Walkthrough for demonstrating the game
│   ├── FABRIC_SETUP.md       # Detailed Fabric test-network instructions
│   └── GAME_RULES.md         # Card, battle, reward and trading rules
├── scripts/
│   └── fabric-network.sh     # Start, deploy and stop the Fabric test network
├── package.json              # Root-level development commands
└── README.md
```

## Requirements

For local development:

- Node.js 22 or later
- npm (included with Node.js)

For Hyperledger Fabric mode, you will also need:

- Docker and Docker Compose
- Git, `curl`, and `jq`
- Linux, macOS, or Windows using WSL2
- The Hyperledger Fabric samples, binaries, and test-network setup

The Fabric-specific setup is covered in [docs/FABRIC_SETUP.md](docs/FABRIC_SETUP.md).

## Run locally

Local mode does not require Docker or a Fabric network. It uses the same game rules with a persistent JSON ledger stored under `backend/data/`.

### 1. Install dependencies

Run these commands from the project root:

```bash
npm run setup
```

This installs the dependencies for the chaincode, backend, and frontend.

### 2. Set up backend configuration

Copy the example environment file if you want to customise the backend settings.

**Windows PowerShell:**

```powershell
Copy-Item backend/.env.example backend/.env
```

**Linux or macOS:**

```bash
cp backend/.env.example backend/.env
```

The default values are suitable for a local demonstration. See [Configuration](#configuration) before changing them.

### 3. Build the frontend

```bash
npm run build
```

### 4. Start the backend in local mode

```bash
npm run start:local
```

Open [http://localhost:4000](http://localhost:4000) in your browser. You can sign in with a demonstration account or register a new account.

When demo mode is enabled, the default demonstration accounts are:

| Username | Password |
|---|---|
| `player1` | `demo1234` |
| `player2` | `demo1234` |

These are demonstration credentials. Change the password or disable demo mode before making the application available to other people.

### Frontend development with hot reload

For frontend development, run the backend and Vite development server in separate terminals.

**Terminal 1 – backend:**

```bash
npm run start:local
```

**Terminal 2 – frontend:**

```bash
npm run dev:frontend
```

Open [http://localhost:5173](http://localhost:5173). Vite forwards `/api` requests to the backend at `http://localhost:4000` by default. Set `BACKEND_URL` when the backend is running at a different address.

## Run with Hyperledger Fabric

Fabric mode connects the backend to a peer through the Fabric Gateway. The included helper script uses the standard Hyperledger Fabric test network.

### 1. Prepare the Fabric test network

Follow the prerequisites and installation steps in [docs/FABRIC_SETUP.md](docs/FABRIC_SETUP.md). By default, the helper script expects `fabric-samples` in a sibling directory next to this repository:

```text
workspace/
├── fabric-samples/
└── cardchain-arena/
```

If your `fabric-samples` directory is elsewhere, set `FABRIC_SAMPLES` when running the helper script and configure `FABRIC_CRYPTO_PATH` in `backend/.env`.

### 2. Start the network and deploy the chaincode

Run these commands from the project root in a Bash-compatible terminal (WSL2 on Windows):

```bash
./scripts/fabric-network.sh up
./scripts/fabric-network.sh deploy
```

The script creates the `mychannel` channel and deploys the chaincode named `tcg` by default.

### 3. Configure and start the application

Copy `backend/.env.example` to `backend/.env` if you have not already done so. The example configuration matches the standard Fabric test-network paths and connection settings.

Build the frontend and start the backend in Fabric-only mode:

```bash
npm run build
npm run start:fabric
```

Open [http://localhost:4000](http://localhost:4000). The application status should report **Hyperledger Fabric** as the active ledger.

For Fabric CLI queries, chaincode upgrades, shutdown instructions, and troubleshooting, see [docs/FABRIC_SETUP.md](docs/FABRIC_SETUP.md).

## Ledger modes

The backend selects its ledger mode when it starts.

| Command | Mode | Behaviour |
|---|---|---|
| `npm run start:local` | Local | Uses the JSON ledger in `backend/data/`. Does not require Fabric. |
| `npm run start:fabric` | Fabric | Connects to Fabric and exits with an error if the network is unavailable. |
| `npm start` | Auto | Tries Fabric first and uses the local ledger if Fabric cannot be reached during startup. |

You can also set `LEDGER_MODE` in `backend/.env` to `auto`, `fabric`, or `local` for the default `npm start` command.

**Local mode is not a blockchain.** It runs the game logic against a persistent JSON file and provides a simulated block history for development and demonstrations. It does not provide Fabric peers, endorsement, ordering, or consensus.

In auto mode, fallback happens only during startup. If the backend has connected to Fabric and Fabric later becomes unavailable, requests fail; the application does not switch ledgers in the middle of a session or retry a failed Fabric transaction against the local ledger.

## Configuration

Backend settings are read from `backend/.env`. Unset values use the defaults shown below.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4000` | HTTP port for the backend. |
| `LEDGER_MODE` | `auto` | Default ledger mode: `auto`, `fabric`, or `local`. |
| `DATA_DIR` | `./data` | Backend data directory, resolved relative to `backend/`. |
| `AUTH_FILE` | `./data/auth.json` | File used for accounts and sessions. |
| `LOCAL_LEDGER_FILE` | `./data/local-ledger.json` | Persistent local ledger file. |
| `SESSION_TTL_HOURS` | `12` | Session lifetime in hours. |
| `DEMO_MODE` | `true` | Enables demonstration login shortcuts and demo accounts. |
| `DEMO_PASSWORD` | `demo1234` | Password used by the demonstration accounts. |
| `FABRIC_CHANNEL` | `mychannel` | Fabric channel name. |
| `FABRIC_CHAINCODE` | `tcg` | Deployed chaincode name. |
| `FABRIC_MSP_ID` | `Org1MSP` | Client organisation MSP ID. |
| `FABRIC_PEER_ENDPOINT` | `localhost:7051` | Peer endpoint used by the Gateway client. |
| `FABRIC_PEER_HOST_ALIAS` | `peer0.org1.example.com` | TLS hostname override for the peer. |
| `FABRIC_CRYPTO_PATH` | Fabric samples Org1 crypto directory | Base directory containing the organisation's certificates and keys. |
| `FABRIC_CERT_DIR` | Derived from `FABRIC_CRYPTO_PATH` | Directory containing the client signing certificate. |
| `FABRIC_KEY_DIR` | Derived from `FABRIC_CRYPTO_PATH` | Directory containing the client private key. |
| `FABRIC_TLS_CERT_PATH` | Derived from `FABRIC_CRYPTO_PATH` | Peer TLS CA certificate path. |
| `FABRIC_CONNECT_TIMEOUT_MS` | `5000` | Fabric connection timeout in milliseconds. |
| `FRONTEND_DIST` | `../frontend/dist` | Built frontend directory served by the backend. |

The Vite development server uses `BACKEND_URL` for its `/api` proxy target. It defaults to `http://localhost:4000` and is set in the environment of the frontend development process, not in `backend/.env`.

### Deployment note

Demo mode is enabled by default to make local demonstrations easier. Before exposing the application on a shared or public network, set `DEMO_MODE=false`, review all environment settings, and use Fabric mode with appropriately managed credentials. Do not commit `backend/.env`, private keys, certificates containing secrets, or runtime data.

## Game rules

The game uses elemental card types, rarity-based stat bonuses, three-round battles, player ratings, experience, in-game coins, card packs, friendships, and card trades. The detailed calculations, card generation rules, reward odds, and worked examples are documented in [docs/GAME_RULES.md](docs/GAME_RULES.md).

For a guided walkthrough of the main screens and game flows, see [docs/DEMO_GUIDE.md](docs/DEMO_GUIDE.md).

## Tests

Run all three test suites from the project root:

```bash
npm test
```

Run an individual suite when needed:

```bash
npm --prefix chaincode test
npm --prefix backend test
npm --prefix frontend test
```

The chaincode and backend suites use Node.js's built-in test runner. The frontend suite uses Vitest and Testing Library.

## API overview

The backend exposes a JSON API under `/api`. The main route groups are:

| Route group | Purpose |
|---|---|
| `/api/auth` | Registration, login, logout, session details, and demonstration login. |
| `/api/players` | Player profiles and player listings. |
| `/api/battles` | Create battles and retrieve battle history/details. |
| `/api/trades` | Create and manage card trades. |
| `/api/cards` and `/api/shop` | Browse the card catalogue and purchase card packs. |
| `/api/friends` | Friend requests and friend management. |
| `/api/leaderboard` | Player rankings. |
| `/api/ledger` | Ledger summary, blocks, transaction details, verification, and rejected writes. |

Most game and ledger routes require a bearer session token. API errors are returned as JSON with an `error` object containing a code and message. The route implementation is in [`backend/src/app.js`](backend/src/app.js).

## Data and identity model

- Account credentials and browser sessions are stored off-chain by the backend. Passwords are hashed before storage.
- Player records, cards, ownership, battles, rewards, trades, and friend relationships are managed by the game ledger.
- In Fabric mode, the backend connects using an application identity from the Fabric test network. Individual players authenticate with the application; they do not each use a separate Fabric identity.
- In local mode, ledger state is stored in `backend/data/local-ledger.json`, while account data is stored in `backend/data/auth.json`.

This is an application-managed identity model for a game running on a permissioned ledger, not a self-custody wallet application.

## Reset local data

To reset local demonstration data:

1. Stop the backend.
2. Delete the `backend/data/` directory.
3. Start the application again with `npm run start:local`.

The backend will initialise a fresh local ledger and create the configured demonstration data. This removes local accounts and game progress stored in that directory.

To reset the Fabric test network, use the shutdown and redeployment steps in [docs/FABRIC_SETUP.md](docs/FABRIC_SETUP.md). The Fabric network reset removes its ledger data; backend account data in `backend/data/auth.json` is stored separately.

## Troubleshooting

| Problem | What to check |
|---|---|
| The page at `localhost:4000` is blank or unavailable | Run `npm run build` before starting the backend, and confirm the backend is running. For frontend development, use `npm run dev:frontend` and open port `5173`. |
| The frontend cannot reach the API | Confirm the backend is running on port `4000`, or set `BACKEND_URL` to the correct backend URL for Vite. |
| The application starts in local mode instead of Fabric mode | Check the network status in the app and the backend startup output. Use `npm run start:fabric` to require Fabric and see connection errors directly. |
| Fabric credentials are not found | Check `FABRIC_CRYPTO_PATH` and confirm the certificate, private key, and TLS CA files exist. |
| The peer at `localhost:7051` cannot be reached | Confirm Docker is running and the Fabric test network is up. |
| The chaincode is unavailable | Run the deploy step in [docs/FABRIC_SETUP.md](docs/FABRIC_SETUP.md) and check the configured channel and chaincode names. |
| A local ledger JSON file cannot be parsed | Stop the backend and inspect the file. For a clean local reset, remove `backend/data/` and start again. |
| Login is temporarily blocked after repeated incorrect passwords | Wait for the lockout period to expire, then try again. |

## Further documentation

- [Fabric setup and deployment](docs/FABRIC_SETUP.md)
- [Game rules](docs/GAME_RULES.md)
- [Demonstration guide](docs/DEMO_GUIDE.md)
