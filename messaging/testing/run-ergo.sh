#!/usr/bin/env bash
# Start a throwaway ergo IRC server for the messaging end-to-end tests.
# Plaintext on port 6667, nick reservation off, so a test can log in with any
# nick and no password. Bind to 127.0.0.1 only unless you pass an address.
#
#   bash testing/run-ergo.sh                  # 127.0.0.1:6667
#   bash testing/run-ergo.sh 192.168.122.1    # also reachable from VMs
#   SEALGATE_TEST_IRC_ADDR=127.0.0.1:6667 go test ./...
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA="${ERGO_DATA:-$(mktemp -d)}"
cp "$DIR/ergo-ircd.yaml" "$DATA/ircd.yaml"
PUBLISH=(-p 127.0.0.1:6667:6667)
for addr in "$@"; do PUBLISH+=(-p "$addr:6667:6667"); done
docker rm -f sealgate-ergo-test >/dev/null 2>&1 || true
docker run -d --name sealgate-ergo-test "${PUBLISH[@]}" -v "$DATA:/ircd" ghcr.io/ergochat/ergo:v2.16.0 >/dev/null
echo "ergo running on port 6667 (data in $DATA)"
