#!/usr/bin/env bash
# Build the mcp_detector_daemon (sealgate-detectord) as a universal macOS binary
# and stage it into desktop/bin/ so electron-builder's mac.extraResources rule
# copies it into Contents/Resources/bin/ of the packaged .app.
#
# Mirrors build-stdiod.sh. The daemon source is the sibling `detectord/` clone
# (sealgate-client/detectord). The cargo binary is `mcp_detector_daemon`; we stage
# it under the friendlier name `sealgate-detectord` (matching the stdiod naming).
#
# Why universal: electron-builder.yml's mac.target ships BOTH arm64 and x64
# .dmg/.zip. extraResources copies one staged file into both .app bundles, so a
# thin arm64 daemon would leave the Intel build with a binary it cannot exec.
# One universal Mach-O satisfies both; each app loads its own slice.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLIENT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$CLIENT_DIR/.." && pwd)"
# Monorepo layout puts the daemon at crates/detectord; the old sibling-checkout
# layout (../detectord next to the app checkout) is kept as a fallback.
if [[ -d "$CLIENT_DIR/../../crates/detectord" ]]; then
  DETECTORD_DIR="$(cd "$CLIENT_DIR/../../crates/detectord" && pwd)"
else
  DETECTORD_DIR="$REPO_ROOT/detectord"
fi
BIN_NAME="mcp_detector_daemon"
OUT_DIR="$CLIENT_DIR/bin"
OUT_BIN="$OUT_DIR/sealgate-detectord"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "build-detectord.sh: only supported on macOS (got $(uname -s))" >&2
  exit 1
fi

if [[ ! -d "$DETECTORD_DIR" ]]; then
  echo "build-detectord.sh: expected the daemon clone at $DETECTORD_DIR" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

# Ensure both rustup targets are installed. The user's machine usually has
# only the host target by default.
for target in aarch64-apple-darwin x86_64-apple-darwin; do
  if ! rustup target list --installed | grep -q "^${target}\$"; then
    echo "Installing rustup target $target ..."
    rustup target add "$target"
  fi
done

echo "Building $BIN_NAME for aarch64-apple-darwin ..."
( cd "$DETECTORD_DIR" && cargo build --release --bin "$BIN_NAME" --target aarch64-apple-darwin )

echo "Building $BIN_NAME for x86_64-apple-darwin ..."
( cd "$DETECTORD_DIR" && cargo build --release --bin "$BIN_NAME" --target x86_64-apple-darwin )

# Unlink before writing, so the staged path is never overwritten in place. cargo
# ad-hoc (linker-)signs its output, and truncating a signed Mach-O in place keeps
# the inode while replacing its pages - the kernel's cached code-signing state
# for that vnode then rejects later mmaps with SIGKILL "Code Signature Invalid"
# (CODESIGNING / Invalid Page), including a `lipo -info` read.
#
# That was the hazard in the `cp`-based staging this replaced (cp truncates,
# inode unchanged). `lipo -create -output` does NOT truncate - it replaces the
# destination, which gets a fresh inode - so this rm is now insurance (it also
# clears a leftover read-only or symlinked path) rather than load-bearing.
# build-stdiod.sh needs no equivalent for the same reason.
rm -f "$OUT_BIN"

echo "Creating universal binary at $OUT_BIN ..."
lipo -create \
  "$DETECTORD_DIR/target/aarch64-apple-darwin/release/$BIN_NAME" \
  "$DETECTORD_DIR/target/x86_64-apple-darwin/release/$BIN_NAME" \
  -output "$OUT_BIN"
chmod +x "$OUT_BIN"

echo "Verifying architectures ..."
lipo -info "$OUT_BIN"
