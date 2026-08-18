#!/usr/bin/env bash
# Build the sealgate-stdiod daemon for arm64 macOS and stage it into
# client_2/bin/ so electron-builder's mac.extraResources rule can copy it into
# Contents/Resources/bin/ of the packaged .app.
#
# arm64 ONLY - mirrors build-detectord.sh, which carries the full rationale.
# Short version: mac.target in electron-builder.yml no longer ships an x64
# .app, and the `lipo` merge this replaced produced a Mach-O that codesign
# considers unsigned (the cross-compiled x86_64 slice carries no signature), so
# it had no designated requirement and every TCC grant against it re-prompted
# forever.
#
# Why outside resources/: keeping the staged binary in a top-level bin/
# directory means it does NOT match the default `files` glob (which
# captures resources/**) and so isn't double-included in the asar.
# electron-builder picks it up only via the explicit extraResources rule.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLIENT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$CLIENT_DIR/.." && pwd)"
# Monorepo layout puts the daemon at crates/stdiod; the old sibling-checkout
# layout (../stdiod next to the app checkout) is kept as a fallback.
if [[ -d "$CLIENT_DIR/../../crates/stdiod" ]]; then
  STDIOD_DIR="$(cd "$CLIENT_DIR/../../crates/stdiod" && pwd)"
else
  STDIOD_DIR="$REPO_ROOT/stdiod"
fi
TARGET="aarch64-apple-darwin"
OUT_DIR="$CLIENT_DIR/bin"
OUT_BIN="$OUT_DIR/sealgate-stdiod"
SIGN_IDENTIFIER="com.sealgate.stdiod"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "build-stdiod.sh: only supported on macOS (got $(uname -s))" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

if ! rustup target list --installed | grep -q "^${TARGET}\$"; then
  echo "Installing rustup target $TARGET ..."
  rustup target add "$TARGET"
fi

# Stamp the daemon's reported version from this app's package.json - the single
# source of truth for the shipped release. build.rs reads this env var; without
# it the daemon would fall back to the pinned 0.0.1 Rust workspace version.
SEALGATE_DAEMON_VERSION="$(node -p "require('$CLIENT_DIR/package.json').version")"
export SEALGATE_DAEMON_VERSION
echo "Stamping daemon version $SEALGATE_DAEMON_VERSION"

echo "Building sealgate-stdiod for $TARGET ..."
( cd "$STDIOD_DIR" && cargo build --release --bin sealgate-stdiod --target "$TARGET" )

# Unlink before writing: `cp` truncates in place, and replacing the pages of a
# signed Mach-O while keeping its inode leaves the kernel's cached code-signing
# state for that vnode stale, which SIGKILLs later mmaps with "Code Signature
# Invalid". See the same note in build-detectord.sh.
rm -f "$OUT_BIN"

echo "Staging $OUT_BIN ..."
cp "$STDIOD_DIR/target/$TARGET/release/sealgate-stdiod" "$OUT_BIN"
chmod +x "$OUT_BIN"

# Pins a stable identifier over cargo's churning `sealgate_stdiod-<hash>`, and
# gives CI one place to swap in a Developer ID (CODESIGN_IDENTITY).
SIGN_ID="${CODESIGN_IDENTITY:--}"
echo "Signing $OUT_BIN with identity '$SIGN_ID' ..."
if [[ "$SIGN_ID" == "-" ]]; then
  codesign --force --sign - --identifier "$SIGN_IDENTIFIER" "$OUT_BIN"
else
  codesign --force --options runtime --timestamp \
    --sign "$SIGN_ID" --identifier "$SIGN_IDENTIFIER" "$OUT_BIN"
fi

echo "Verifying architecture ..."
lipo -info "$OUT_BIN"
if lipo -info "$OUT_BIN" | grep -q 'x86_64'; then
  echo "build-stdiod.sh: $OUT_BIN contains an x86_64 slice; expected arm64 only" >&2
  exit 1
fi

# `#?` is load-bearing: codesign comments out a SYNTHESISED requirement (ad-hoc)
# and prints a stored one bare (Developer ID). See the longer note in
# build-detectord.sh - matching only `^# ` fails every signed CI build.
DESIGNATED_RE='^#?[[:space:]]*designated[[:space:]]*=>'
echo "Verifying code signature ..."
codesign --verify --strict "$OUT_BIN"
if ! codesign -d -r- "$OUT_BIN" 2>&1 | grep -qE "$DESIGNATED_RE"; then
  echo "build-stdiod.sh: $OUT_BIN has no designated requirement after signing" >&2
  exit 1
fi
codesign -d -r- "$OUT_BIN" 2>&1 | grep -E "$DESIGNATED_RE"
