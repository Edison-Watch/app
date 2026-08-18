#!/usr/bin/env bash
# Cross-build sealgate-stdiod for Windows (arm64 + x64) from macOS/Linux and stage
# it into client_2/bin/stdiod/<arch>/ so an electron-builder win.extraResources
# rule can copy the matching-arch binary into the packaged app.
#
# Why gnullvm + cargo-zigbuild: rustls pulls in `ring`, whose C-crypto can't be
# cross-compiled to *-windows-msvc from macOS (ring hardcodes bare clang for
# aarch64-windows; cargo-xwin feeds clang-cl /imsvc flags -> incompatible). The
# *-pc-windows-gnullvm targets use a GNU-style LLVM/mingw toolchain that `ring`
# is happy with, and zig (via cargo-zigbuild) supplies that C toolchain with no
# MSVC SDK. gnullvm binaries are UCRT/MSVC-ABI compatible and run natively on
# Windows. For official release builds prefer native Windows CI (see
# .github/workflows/desktop-release.yml, which builds *-pc-windows-msvc per arch
# on a Windows runner); this script is for local builds.
#
# Usage:  bash scripts/build-stdiod-win.sh                       # both arches
#         TARGET_ARCHES="x64" bash scripts/build-stdiod-win.sh   # one arch

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
OUT_ROOT="$CLIENT_DIR/bin/stdiod"

command -v zig >/dev/null 2>&1 || {
  echo "build-stdiod-win.sh: zig required (brew install zig)" >&2; exit 1; }
command -v cargo-zigbuild >/dev/null 2>&1 || {
  echo "build-stdiod-win.sh: cargo-zigbuild required (cargo install cargo-zigbuild)" >&2; exit 1; }

# electron-builder ${arch} : rust gnullvm target
ALL_SPECS=("arm64:aarch64-pc-windows-gnullvm" "x64:x86_64-pc-windows-gnullvm")
WANT="${TARGET_ARCHES:-arm64 x64}"

# Validate requested arches up front. An unknown token (typo, or an unsupported
# value like "amd64") would otherwise be silently skipped by the per-arch filter
# below, letting the script exit 0 after building nothing (or only a subset) and
# leaving bin/stdiod incomplete for electron-builder. Parse into an array so a
# whitespace-only TARGET_ARCHES (which ${:-} does NOT default, since it is not
# empty) collapses to zero tokens and is rejected here rather than silently
# building nothing.
# Tabs/newlines are folded to spaces before the split: `read -ra` splits on any
# IFS whitespace but consumes only the FIRST line, so a multi-line TARGET_ARCHES
# (a YAML block scalar, say) would otherwise have its later tokens silently
# dropped - never validated, never built.
read -ra WANT_ARCHES <<< "${WANT//[$'\t\n']/ }"
if [ ${#WANT_ARCHES[@]} -eq 0 ]; then
  echo "build-stdiod-win.sh: TARGET_ARCHES requests no architectures" >&2; exit 1
fi
KNOWN_ARCHES=""
for spec in "${ALL_SPECS[@]}"; do KNOWN_ARCHES="$KNOWN_ARCHES ${spec%%:*}"; done
for arch in "${WANT_ARCHES[@]}"; do
  case " $KNOWN_ARCHES " in
    *" $arch "*) ;;
    *) echo "build-stdiod-win.sh: unsupported arch '$arch' in TARGET_ARCHES (supported:$KNOWN_ARCHES)" >&2; exit 1 ;;
  esac
done

# Membership test against the PARSED tokens. A glob over the raw " $WANT " string
# tokenizes differently from the `read -ra` above (spaces only vs any IFS
# whitespace), and the two disagreeing is a silent no-op build: with
# TARGET_ARCHES=$'arm64\tx64' validation accepted both arches while the glob
# matched neither, so the loop below staged nothing and still exited 0.
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
  echo "Building sealgate-stdiod for $target ..."
  ( cd "$STDIOD_DIR" && cargo zigbuild --release --target "$target" --bin sealgate-stdiod )
  mkdir -p "$OUT_ROOT/$arch"
  cp "$STDIOD_DIR/target/$target/release/sealgate-stdiod.exe" "$OUT_ROOT/$arch/sealgate-stdiod.exe"
  echo "Staged -> $OUT_ROOT/$arch/sealgate-stdiod.exe"
done

echo "Done. Windows daemon binaries staged under $OUT_ROOT/<arch>/"
