#!/usr/bin/env bash
# Starts the Hyperledger Fabric test network from fabric-samples and deploys
# the TCG chaincode to it.
#
#   ./scripts/fabric-network.sh up        start the network and create mychannel
#   ./scripts/fabric-network.sh deploy    deploy (or upgrade) the tcg chaincode
#   ./scripts/fabric-network.sh down      stop the network and delete its ledger
#
# FABRIC_SAMPLES defaults to a fabric-samples folder next to this project.
# To redeploy after changing the chaincode, increase the version and sequence:
#   CC_VERSION=1.1 CC_SEQUENCE=2 ./scripts/fabric-network.sh deploy

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FABRIC_SAMPLES="${FABRIC_SAMPLES:-$PROJECT_DIR/../fabric-samples}"
TEST_NETWORK="$FABRIC_SAMPLES/test-network"
CHANNEL="${CHANNEL:-mychannel}"
CC_NAME="${CC_NAME:-tcg}"
CC_VERSION="${CC_VERSION:-1.0}"
CC_SEQUENCE="${CC_SEQUENCE:-1}"

if [ ! -x "$TEST_NETWORK/network.sh" ]; then
  echo "fabric-samples not found at $FABRIC_SAMPLES"
  echo "Install it next to this project (see docs/FABRIC_SETUP.md) or set FABRIC_SAMPLES=/path/to/fabric-samples"
  exit 1
fi

cd "$TEST_NETWORK"

case "${1:-}" in
  up)
    ./network.sh up createChannel -c "$CHANNEL"
    ;;
  deploy)
    ./network.sh deployCC -c "$CHANNEL" -ccn "$CC_NAME" -ccp "$PROJECT_DIR/chaincode" -ccl javascript \
      -ccv "$CC_VERSION" -ccs "$CC_SEQUENCE"
    echo
    echo "Chaincode deployed. Start the backend in Fabric mode with: npm run start:fabric"
    echo "The demo players are created automatically when the backend starts (InitLedger)."
    ;;
  down)
    ./network.sh down
    echo
    echo "The Fabric ledger was deleted. Registered accounts in backend/data/auth.json still exist;"
    echo "their players are re-created on the new ledger the next time they log in."
    ;;
  *)
    echo "Usage: $0 up|deploy|down"
    exit 1
    ;;
esac
