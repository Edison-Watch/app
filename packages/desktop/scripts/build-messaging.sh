#!/usr/bin/env bash
# Build the sealgate-messaging binary (messaging/ in this repo) and stage it at
# bin/messaging/<arch>/ so electron-builder's extraResources rule copies it into
# resources/bin/ of the packaged app.
#
# The binary uses cgo (SQLite), so cross-builds go through zig as the C
# toolchain, the same way build-stdiod-win.sh builds the Rust daemon:
#   linux   -> static musl binary, runs on any distro
#   windows -> *-windows-gnu, no MSVC SDK needed
#   darwin  -> native build on a Mac
#
# Usage:  TARGET_OS=linux TARGET_ARCHES="x64" bash scripts/build-messaging.sh
#         TARGET_OS=windows TARGET_ARCHES="x64 arm64" bash scripts/build-messaging.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLIENT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MSG_DIR="$(cd "$CLIENT_DIR/../../messaging" && pwd)"
OUT_ROOT="$CLIENT_DIR/bin/messaging"

TARGET_OS="${TARGET_OS:-$(go env GOOS)}"
read -ra ARCHES <<< "${TARGET_ARCHES:-x64}"
VERSION="${SEALGATE_MESSAGING_VERSION:-$(node -p "require('$CLIENT_DIR/package.json').version")}"

command -v go >/dev/null || { echo "build-messaging.sh: go required" >&2; exit 1; }

for arch in "${ARCHES[@]}"; do
  case "$arch" in
    x64) goarch=amd64; zarch=x86_64 ;;
    arm64) goarch=arm64; zarch=aarch64 ;;
    *) echo "build-messaging.sh: unsupported arch '$arch'" >&2; exit 1 ;;
  esac
  out="$OUT_ROOT/$arch"
  mkdir -p "$out"
  ldflags="-s -w -X main.Version=$VERSION"
  case "$TARGET_OS" in
    linux)
      command -v zig >/dev/null || { echo "build-messaging.sh: zig required" >&2; exit 1; }
      export CC="zig cc -target $zarch-linux-musl" CXX="zig c++ -target $zarch-linux-musl"
      ldflags="$ldflags -linkmode external -extldflags -static"
      exe="$out/sealgate-messaging" ;;
    windows)
      command -v zig >/dev/null || { echo "build-messaging.sh: zig required" >&2; exit 1; }
      export CC="zig cc -target $zarch-windows-gnu" CXX="zig c++ -target $zarch-windows-gnu"
      exe="$out/sealgate-messaging.exe" ;;
    darwin)
      exe="$out/sealgate-messaging" ;;
    *) echo "build-messaging.sh: unsupported TARGET_OS '$TARGET_OS'" >&2; exit 1 ;;
  esac
  echo "Building sealgate-messaging $VERSION for $TARGET_OS/$goarch ..."
  ( cd "$MSG_DIR" && CGO_ENABLED=1 GOOS="$TARGET_OS" GOARCH="$goarch" \
      go build -trimpath -ldflags "$ldflags" -o "$exe" ./cmd/sealgate-messaging )
  echo "Staged -> $exe"
done
