#!/usr/bin/env bash
# Build sealgate-stdiod for Linux (x64 + arm64) and stage it into
# client_2/bin/stdiod/<arch>/ so a (future) linux.extraResources rule can copy
# the matching-arch binary into the packaged app - and so the binary can be
# shipped standalone (the CLI-first Linux story).
#
# Why static musl: targeting *-unknown-linux-musl produces a fully static
# binary with ZERO glibc dependency, so the same file runs on any Linux distro
# (Debian, Fedora, Arch, Alpine, containers) without a per-distro build or a
# glibc-version floor. This is the most distro-agnostic artifact possible.
#
# Why cargo-zigbuild: rustls pulls in `ring`, whose C-crypto needs a real C
# cross-toolchain. zig (via cargo-zigbuild) supplies one with no system cross
# packages, exactly as we already do for the Windows gnullvm target
# (see build-stdiod-win.sh). Works from macOS or Linux hosts.
#
# Usage:  bash scripts/build-stdiod-linux.sh            # both arches
#         TARGET_ARCHES="x64" bash scripts/build-stdiod-linux.sh   # one arch
#
# For official release builds, native Linux CI (ubuntu, oldest supported) is
# also fine and avoids the zig dependency; this script is for local/dev builds
# and cross-building from a Mac.

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

# Stamp the daemon's reported version from this app's package.json - the single
# source of truth for the shipped release. build.rs reads this env var; without
# it the daemon would fall back to the pinned 0.0.1 Rust workspace version.
SEALGATE_DAEMON_VERSION="$(node -p "require('$CLIENT_DIR/package.json').version")"
export SEALGATE_DAEMON_VERSION
echo "Stamping daemon version $SEALGATE_DAEMON_VERSION"

command -v zig >/dev/null 2>&1 || {
  echo "build-stdiod-linux.sh: zig required (brew install zig / see ziglang.org)" >&2; exit 1; }
command -v cargo-zigbuild >/dev/null 2>&1 || {
  echo "build-stdiod-linux.sh: cargo-zigbuild required (cargo install cargo-zigbuild)" >&2; exit 1; }

# electron-builder ${arch} : rust musl target
ALL_SPECS=("x64:x86_64-unknown-linux-musl" "arm64:aarch64-unknown-linux-musl")
WANT="${TARGET_ARCHES:-x64 arm64}"

# Validate requested arches up front. An unknown token (typo, or an unsupported
# value like "amd64") would otherwise be silently skipped by the per-arch filter
# below, letting the script exit 0 after building nothing (or only a subset) and
# leaving bin/stdiod incomplete for electron-builder. Parse into an array so a
# whitespace-only TARGET_ARCHES (which ${:-} does NOT default, since it is not
# empty) collapses to zero tokens and is rejected here rather than silently
# building nothing.
# Tabs/newlines folded to spaces first - see build-stdiod-win.sh for why.
read -ra WANT_ARCHES <<< "${WANT//[$'\t\n']/ }"
if [ ${#WANT_ARCHES[@]} -eq 0 ]; then
  echo "build-stdiod-linux.sh: TARGET_ARCHES requests no architectures" >&2; exit 1
fi
KNOWN_ARCHES=""
for spec in "${ALL_SPECS[@]}"; do KNOWN_ARCHES="$KNOWN_ARCHES ${spec%%:*}"; done
for arch in "${WANT_ARCHES[@]}"; do
  case " $KNOWN_ARCHES " in
    *" $arch "*) ;;
    *) echo "build-stdiod-linux.sh: unsupported arch '$arch' in TARGET_ARCHES (supported:$KNOWN_ARCHES)" >&2; exit 1 ;;
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
  echo "Building sealgate-stdiod for $target ..."
  ( cd "$STDIOD_DIR" && cargo zigbuild --release --target "$target" --bin sealgate-stdiod )
  mkdir -p "$OUT_ROOT/$arch"
  cp "$STDIOD_DIR/target/$target/release/sealgate-stdiod" "$OUT_ROOT/$arch/sealgate-stdiod"
  chmod +x "$OUT_ROOT/$arch/sealgate-stdiod"
  echo "Staged -> $OUT_ROOT/$arch/sealgate-stdiod"
done

echo "Done. Linux daemon binaries staged under $OUT_ROOT/<arch>/"
