# Running on Hyperledger Fabric

This guide runs the game on the Hyperledger Fabric **test network** from `fabric-samples`
(two organisations, one peer each, one Raft orderer, channel `mychannel`).

You only need this for **Fabric mode**. Local mode runs without Docker or Fabric (see README).

## 1. Prerequisites

- Linux, macOS, or Windows with **WSL2** (run every command below inside WSL2)
- Docker and Docker Compose (Docker Desktop on Windows/macOS), running
- Git, curl, jq
- Node.js 22 LTS (20.19+ also works)

## 2. Install fabric-samples next to this project

The scripts and backend defaults expect this layout:

```
some-folder/
  fabric-samples/        <- Fabric test network, binaries and config
  tcg-fabric/            <- this project
```

From `some-folder/`:

```bash
curl -sSLO https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh
chmod +x install-fabric.sh
./install-fabric.sh --fabric-version 2.5.10 docker samples binary
```

This creates `fabric-samples/` with the `bin/` tools and pulls the Fabric Docker images.
If you put fabric-samples somewhere else, set `FABRIC_SAMPLES=/path/to/fabric-samples` for the
script below and `FABRIC_CRYPTO_PATH` in `backend/.env`.

## 3. Start the network and deploy the chaincode

From the project folder:

```bash
./scripts/fabric-network.sh up        # starts peers + orderer, creates mychannel
./scripts/fabric-network.sh deploy    # packages, installs, approves and commits chaincode "tcg"
```

`deploy` uses the standard `network.sh deployCC` command with `-ccl javascript`. The first
deploy takes a few minutes because each peer builds the Node.js chaincode image.

After changing chaincode code, upgrade it with a higher version and sequence:

```bash
CC_VERSION=1.1 CC_SEQUENCE=2 ./scripts/fabric-network.sh deploy
```

## 4. Configure and start the backend

```bash
cp backend/.env.example backend/.env
```

The defaults already match the test network (Org1, `localhost:7051`, `User1@org1.example.com`).
Start in Fabric-only mode so you will see an error instead of a silent fallback if something is wrong:

```bash
npm run build            # once, builds the React app that the backend serves
npm run start:fabric
```

Expected output:

```
TCG backend listening on http://localhost:4000
Ledger: Hyperledger Fabric (channel mychannel, chaincode tcg, peer localhost:7051)
Demo data created: player1, P1-01, ... P2-04
```

On first start the backend submits `InitLedger` to create the demo players. Later starts see that
they exist and skip it. Open http://localhost:4000. The status panel in the sidebar reads **Mode: Hyperledger Fabric** with a
green dot, and the Ledger explorer shows the channel's real blocks, including the lifecycle
transactions that deployed the chaincode.

## 5. Inspect the ledger directly with the peer CLI

This proves to evaluators that the data is on the blockchain, not in the backend.
From `fabric-samples/test-network`:

```bash
export PATH=${PWD}/../bin:$PATH
export FABRIC_CFG_PATH=${PWD}/../config/
export CORE_PEER_TLS_ENABLED=true
export CORE_PEER_LOCALMSPID=Org2MSP
export CORE_PEER_TLS_ROOTCERT_FILE=${PWD}/organizations/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/tls/ca.crt
export CORE_PEER_MSPCONFIGPATH=${PWD}/organizations/peerOrganizations/org2.example.com/users/Admin@org2.example.com/msp
export CORE_PEER_ADDRESS=localhost:9051

# Read from Org2's peer (the backend talks to Org1's peer)
peer chaincode query -C mychannel -n tcg -c '{"function":"GetLeaderboard","Args":[]}'
peer chaincode query -C mychannel -n tcg -c '{"function":"GetPlayerCards","Args":["player1"]}'
peer chaincode query -C mychannel -n tcg -c '{"function":"GetOpenTrades","Args":[]}'
peer channel getinfo -c mychannel        # block height grows with every game transaction
```

Show that rewards cannot be minted directly (the peers reject it):

```bash
peer chaincode invoke -o localhost:7050 --ordererTLSHostnameOverride orderer.example.com --tls \
  --cafile "${PWD}/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem" \
  -C mychannel -n tcg \
  --peerAddresses localhost:7051 --tlsRootCertFiles "${PWD}/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt" \
  --peerAddresses localhost:9051 --tlsRootCertFiles "${PWD}/organizations/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/tls/ca.crt" \
  -c '{"function":"RewardWinner","Args":["player1"]}'
# Error: ... [FORBIDDEN] RewardWinner can only run inside a Battle transaction
```

## 6. Stopping

```bash
./scripts/fabric-network.sh down
```

`down` deletes the Fabric ledger. Accounts in `backend/data/auth.json` are kept; when one of them
logs in on a fresh network, the backend registers its player again (with new starter cards).
Delete `backend/data/auth.json` too for a completely clean start.

## How the backend talks to Fabric

- Connection: Fabric Gateway (`@hyperledger/fabric-gateway`) over gRPC/TLS to `peer0.org1`.
- Identity: every transaction is signed by `User1@org1.example.com`. Players are not separate
  Fabric identities; see "Trust model" in the README.
- Reads use `evaluateTransaction` (run on a peer, nothing written).
- Writes are endorsed by the peers required by the endorsement policy (Org1 and Org2 on the
  test network), sent to the orderer, and the backend then **waits for the commit status**.
  Only a `VALID` commit is reported as success. An invalid commit (for example
  `MVCC_READ_CONFLICT`) is reported as an error and nothing changes in the game.
- If Fabric becomes unreachable after startup, requests fail with HTTP 503. The backend never
  switches to the local ledger while running.
- The Ledger explorer reads blocks with Fabric's `qscc` system chaincode (`GetChainInfo`,
  `GetBlockByNumber`) and decodes them in the backend. **Verify chain** recomputes each block's data
  hash and header hash (the same ASN.1 encoding Fabric uses) and checks them against the hashes the
  peer reports, so the result reflects the real chain.

## Troubleshooting

| Problem | Fix |
|---|---|
| `Fabric credentials not found` | The network is not up, or `FABRIC_CRYPTO_PATH` does not point at `.../peerOrganizations/org1.example.com` |
| `Cannot reach Fabric peer at localhost:7051` | Run `docker ps`; start the network with `./scripts/fabric-network.sh up` |
| `chaincode "tcg" ... did not respond` | Deploy the chaincode: `./scripts/fabric-network.sh deploy` |
| `deployCC` fails building the chaincode image | Check Docker has internet access to npmjs.org; rerun deploy |
| Changed chaincode has no effect | Redeploy with a higher `CC_VERSION` and `CC_SEQUENCE` |
| Corporate/college HTTP proxy breaks gRPC | Add `localhost,127.0.0.1` to `NO_PROXY`/`no_proxy` |
