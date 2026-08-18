#!/usr/bin/env bash
# Build the mcp_detector_daemon (sealgate-detectord) for arm64 macOS and stage it
# into desktop/bin/ so electron-builder's mac.extraResources rule copies it into
# Contents/Resources/bin/ of the packaged .app.
#
# Mirrors build-stdiod.sh. The daemon source is the sibling `detectord/` clone
# (sealgate-client/detectord). The cargo binary is `mcp_detector_daemon`; we stage
# it under the friendlier name `sealgate-detectord` (matching the stdiod naming).
#
# arm64 ONLY. This used to build both Darwin arches and `lipo` them into one
# universal Mach-O, because electron-builder shipped an x64 .app too and
# extraResources copies a single staged file into every bundle. That is gone:
# mac.target in electron-builder.yml is arm64-only, and the merge actively broke
# TCC. On Apple Silicon the linker ad-hoc-signs only the native arm64 output;
# the cross-compiled x86_64 slice has no signature at all, and the lipo'd result
# is "code object is not signed at all" with NO designated requirement. tccd
# writes a grant against such a binary and then fails to re-verify it -
#
#   Failed to match existing code requirement for subject .../sealgate-detectord
#
# - so every protected folder the daemon touches re-prompts forever: the user
# clicks Allow and the same dialog comes straight back. A thin arm64 binary
# keeps its linker signature and its `cdhash H"..."` requirement, which is why
# the pre-universal builds only ever prompted once per folder.

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
TARGET="aarch64-apple-darwin"
OUT_DIR="$CLIENT_DIR/bin"
OUT_BIN="$OUT_DIR/sealgate-detectord"
# Stable signing identifier. cargo's default is the crate name plus a build hash
# (`mcp_detector_daemon-e7ccc8148ccbba07`), which churns; TCC and the Full Disk
# Access list read better with a fixed reverse-DNS id.
SIGN_IDENTIFIER="com.sealgate.detectord"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "build-detectord.sh: only supported on macOS (got $(uname -s))" >&2
  exit 1
fi

if [[ ! -d "$DETECTORD_DIR" ]]; then
  echo "build-detectord.sh: expected the daemon clone at $DETECTORD_DIR" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

if ! rustup target list --installed | grep -q "^${TARGET}\$"; then
  echo "Installing rustup target $TARGET ..."
  rustup target add "$TARGET"
fi

echo "Building $BIN_NAME for $TARGET ..."
( cd "$DETECTORD_DIR" && cargo build --release --bin "$BIN_NAME" --target "$TARGET" )

# Unlink before writing, so the staged path is never overwritten in place. cargo
# ad-hoc (linker-)signs its output, and truncating a signed Mach-O in place keeps
# the inode while replacing its pages - the kernel's cached code-signing state
# for that vnode then rejects later mmaps with SIGKILL "Code Signature Invalid"
# (CODESIGNING / Invalid Page). `cp` truncates, so this rm is load-bearing here
# (it also clears a leftover read-only or symlinked path).
rm -f "$OUT_BIN"

echo "Staging $OUT_BIN ..."
cp "$DETECTORD_DIR/target/$TARGET/release/$BIN_NAME" "$OUT_BIN"
chmod +x "$OUT_BIN"

# cargo's linker signature would already carry a designated requirement, so this
# is not repairing anything - it pins a stable identifier instead of the churning
# `mcp_detector_daemon-<hash>` cargo derives, and gives CI one place to swap in a
# Developer ID. Ad-hoc pins cdhash, so each new dev build re-prompts once;
# a Developer ID identity makes the requirement identifier-based, and TCC grants
# then survive app updates. Idempotent with @electron/osx-sign, which re-signs
# nested executables during packaging.
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
  echo "build-detectord.sh: $OUT_BIN contains an x86_64 slice; expected arm64 only" >&2
  exit 1
fi

# A designated requirement is what the universal build was missing; fail here
# rather than ship another binary whose TCC grants cannot stick.
echo "Verifying code signature ..."
codesign --verify --strict "$OUT_BIN"
if ! codesign -d -r- "$OUT_BIN" 2>&1 | grep -q '^# designated'; then
  echo "build-detectord.sh: $OUT_BIN has no designated requirement after signing" >&2
  exit 1
fi
codesign -d -r- "$OUT_BIN" 2>&1 | grep '^# designated'
