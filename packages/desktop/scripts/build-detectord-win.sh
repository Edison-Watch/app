#!/usr/bin/env bash
# Cross-build mcp_detector_daemon (edison-detectord) for Windows (arm64 + x64)
# from macOS/Linux and stage it into desktop/bin/detectord/<arch>/ so an
# electron-builder win.extraResources rule can copy the matching-arch binary
# into the packaged app. Mirrors build-stdiod-win.sh.
#
# Why gnullvm + cargo-zigbuild: rustls pulls in `ring`, whose C-crypto can't be
# cross-compiled to *-windows-msvc from macOS/Linux. The *-pc-windows-gnullvm
# targets use a GNU-style LLVM/mingw toolchain that `ring` is happy with, and
# zig (via cargo-zigbuild) supplies that C toolchain with no MSVC SDK. gnullvm
# binaries are UCRT/MSVC-ABI compatible and run natively on Windows. For official
# release builds prefer native Windows CI.
#
# Usage:  bash scripts/build-detectord-win.sh                       # both arches
#         TARGET_ARCHES="x64" bash scripts/build-detectord-win.sh   # one arch

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
OUT_ROOT="$CLIENT_DIR/bin/detectord"

if [[ ! -d "$DETECTORD_DIR" ]]; then
  echo "build-detectord-win.sh: expected the daemon clone at $DETECTORD_DIR" >&2
  exit 1
fi

command -v zig >/dev/null 2>&1 || {
  echo "build-detectord-win.sh: zig required (brew install zig)" >&2; exit 1; }
command -v cargo-zigbuild >/dev/null 2>&1 || {
  echo "build-detectord-win.sh: cargo-zigbuild required (cargo install cargo-zigbuild)" >&2; exit 1; }

# electron-builder ${arch} : rust gnullvm target
ALL_SPECS=("arm64:aarch64-pc-windows-gnullvm" "x64:x86_64-pc-windows-gnullvm")
WANT="${TARGET_ARCHES:-arm64 x64}"

# Validate requested arches up front - see build-stdiod-win.sh for why an
# unknown or whitespace-only TARGET_ARCHES must fail loudly instead of quietly
# staging nothing.
# Tabs/newlines folded to spaces first - see build-stdiod-win.sh for why.
read -ra WANT_ARCHES <<< "${WANT//[$'\t\n']/ }"
if [ ${#WANT_ARCHES[@]} -eq 0 ]; then
  echo "build-detectord-win.sh: TARGET_ARCHES requests no architectures" >&2; exit 1
fi
KNOWN_ARCHES=""
for spec in "${ALL_SPECS[@]}"; do KNOWN_ARCHES="$KNOWN_ARCHES ${spec%%:*}"; done
for arch in "${WANT_ARCHES[@]}"; do
  case " $KNOWN_ARCHES " in
    *" $arch "*) ;;
    *) echo "build-detectord-win.sh: unsupported arch '$arch' in TARGET_ARCHES (supported:$KNOWN_ARCHES)" >&2; exit 1 ;;
  esac
done

# Match the PARSED tokens, not a glob over the raw $WANT - see build-stdiod-win.sh
# for why the two tokenizations disagreeing silently stages nothing.
wants_arch() {
  local want
  for want in "${WANT_ARCHES[@]}"; do
    if [[ "$want" == "$1" ]]; then return 0; fi
  done
  return 1
}

for spec in "${ALL_SPECS[@]}"; do
  arch="${spec%%:*}"
  target="${spec##*:}"
  wants_arch "$arch" || continue

  if ! rustup target list --installed | grep -q "^${target}\$"; then
    echo "Installing rustup target $target ..."
    rustup target add "$target"
  fi
  echo "Building $BIN_NAME for $target ..."
  ( cd "$DETECTORD_DIR" && cargo zigbuild --release --target "$target" --bin "$BIN_NAME" )
  mkdir -p "$OUT_ROOT/$arch"
  cp "$DETECTORD_DIR/target/$target/release/$BIN_NAME.exe" "$OUT_ROOT/$arch/edison-detectord.exe"
  echo "Staged -> $OUT_ROOT/$arch/edison-detectord.exe"
done

echo "Done. Windows daemon binaries staged under $OUT_ROOT/<arch>/"
