#!/usr/bin/env bash
#
# install-beeper.sh - wire Beeper into the SealGate MCP gateway on macOS.
#
# Reality check (2026-08): Beeper's local Client API (127.0.0.1:23373-23378)
# now ships a built-in Streamable HTTP MCP server, and `@beeper/mcp-remote` is
# a thin stdio proxy to it. That API is served by either the Beeper Desktop app
# OR a headless `beeper` server (`beeper setup --server`). Full automation
# still stops at the human-gated steps below (device approval, server
# approval, Beeper login).
#
# Auth model: `@beeper/mcp-remote` authenticates with the MCP OAuth flow. On
# first connect Beeper raises an approve/deny prompt (in the Desktop app; a
# headless server prints an approval URL instead) and caches the grant
# locally, so there is no token to mint, discover, or paste. (The earlier
# static-token flow around `@beeper/desktop-mcp`, with its `token` and
# `bind-token` subcommands and its Deno prerequisite, is gone; see git
# history.)
#
# What it automates:
#   1. Install prerequisites (node/npx, `sealgate-stdiod` as a prebuilt
#      checksum-verified release binary, and on macOS the Beeper Desktop app
#      itself via the Homebrew cask), each behind the --install-deps consent
#      gate. NO Rust toolchain and no checkout are needed on this path: the
#      daemon is downloaded from the app's own GitHub release, whose version it
#      matches. `--from-source` opts into a cargo build instead, and is the only
#      way to reach one.
#   2. Authorize this device to SealGate via the stdiod browser/device flow
#      (`sealgate-stdiod login`; no API key paste, no step-up dance).
#   3. Supervise the tunnel daemon (`sealgate-stdiod install`).
#   4. Submit Beeper's stdio MCP proxy (`npx @beeper/mcp-remote`) as a tunnel
#      server (`sealgate-stdiod server add`, which requests admin approval).
#   5. Prime the Beeper OAuth grant by driving one MCP handshake through the
#      proxy, so the approval prompt fires now instead of at first daemon spawn.
#
# What still needs a human (each one printed with the exact action):
#   A. Sign in to Beeper, enable MCP (Settings > Developers > MCP) so :23373
#      answers, and link WhatsApp / Telegram / etc. in the Beeper app.
#   B. Approve the submitted `beeper` server once in the SealGate dashboard.
#   C. Approve the Beeper OAuth prompt when step 5 raises it.
#
# End-to-end topology once those are done:
#   AI client --MCP--> SealGate Gateway --WS tunnel--> sealgate-stdiod
#     --stdio--> npx @beeper/mcp-remote --HTTP+OAuth :23373--> Beeper Client API
#     --> WhatsApp / Telegram / LinkedIn / ...
#
# Built to be driven by an agent or a human: every input is a flag or an
# UPPER_SNAKE env var, nothing blocks on a prompt unless you pass --interactive,
# and missing inputs fail fast with the exact command to fix them.

set -euo pipefail

# Keep sealgate-stdiod (anyhow) from spilling a Rust backtrace on expected
# failures; we translate its exit codes into actionable messages ourselves.
export RUST_BACKTRACE="${RUST_BACKTRACE:-0}"
export RUST_LIB_BACKTRACE="${RUST_LIB_BACKTRACE:-0}"

# Keep `brew install` from dumping its auto-update wall and env hints. Respected
# only by Homebrew; harmless elsewhere.
export HOMEBREW_NO_AUTO_UPDATE="${HOMEBREW_NO_AUTO_UPDATE:-1}"
export HOMEBREW_NO_ENV_HINTS="${HOMEBREW_NO_ENV_HINTS:-1}"

# ---------------------------------------------------------------------------
# Defaults (every one overridable by flag or environment variable)
# ---------------------------------------------------------------------------
# An SG_BACKEND supplied through the environment is an explicit choice, exactly
# like passing --sg-backend, so resolve_backend must not override it with the
# device's saved session. Capture that before applying the release default.
if [ -n "${SG_BACKEND:-}" ]; then SG_BACKEND_SET=1; else SG_BACKEND_SET=0; fi
# sealgate.ai is the canonical host: the old edison.watch domains answer with a
# 308 the login client will not re-POST across.
SG_BACKEND="${SG_BACKEND:-https://dashboard.sealgate.ai}"  # --sg-backend/--demo/--release also set SG_BACKEND_SET
SG_API_KEY="${SG_API_KEY:-}"                       # only for the mcp-url client snippet
SERVER_NAME="${SERVER_NAME:-beeper}"               # tunnel server name / gateway prefix
# Display label for this script's own output only. It does NOT set the stdiod
# device record: `sealgate-stdiod login` issues the device identity server-side.
DEVICE_LABEL="${DEVICE_LABEL:-$(hostname -s 2>/dev/null || echo my-mac)}"
MCP_PKG="${MCP_PKG:-@beeper/mcp-remote}"           # the stdio->HTTP OAuth proxy npx package
OAUTH_WAIT="${OAUTH_WAIT:-120}"                    # seconds to wait for the Beeper OAuth approval
BEEPER_WAIT="${BEEPER_WAIT:-30}"                   # seconds to wait for Beeper's client API after opening the app (0 = skip)
CONNECT_WAIT="${CONNECT_WAIT:-45}"                 # seconds to wait for the daemon to register with the backend
STDIOD_REPO="${STDIOD_REPO:-Edison-Watch/app}"     # GitHub repo whose releases carry stdiod binaries
STDIOD_TAG="${STDIOD_TAG:-}"                       # pin an app release tag, e.g. v0.6.6 (default: newest)
# Daemon channel. Left UNSET, it follows the backend: the demo backend gets the
# demo (-beta) daemon, everything else gets stable - so `--demo` and `--release`
# each pull the matching daemon without a second flag. Setting it explicitly
# (env, --stdiod-prerelease, --stdiod-release) pins it and stops that
# inference; --stdiod-tag overrides both, since a pinned tag names its own
# channel. See resolve_stdiod_channel.
if [ -n "${STDIOD_PRERELEASE:-}" ]; then STDIOD_CHANNEL_SET=1; else STDIOD_CHANNEL_SET=0; fi
STDIOD_PRERELEASE="${STDIOD_PRERELEASE:-0}"        # 1 = demo channel (-beta tags), 0 = stable

DRY_RUN=0
ASSUME_YES=0
INTERACTIVE=0
JSON=0
INSTALL_DEPS=0
VERBOSE=0
NO_COLOR_FLAG=0
NO_OPEN=0            # pass through to `sealgate-stdiod login --no-open` for headless auth
RELOGIN=0           # force a fresh `sealgate-stdiod login` even if already authorized
NO_PREAUTH=0        # skip the OAuth-grant priming step during install
BEEPER_READY=0      # set by ensure_beeper_desktop when Beeper's client API answers
STDIOD_CONNECTED=0  # set by ensure_stdiod_supervised once the daemon registers
FROM_SOURCE=0       # cargo-build sealgate-stdiod instead of downloading the release binary

PROG="$(basename "$0")"
# The user's PATH as we found it, before this script prepends ~/.local/bin or
# ~/.cargo/bin for its own run; used to decide whether to print a PATH todo.
PATH_AT_LAUNCH="$PATH"

# ---------------------------------------------------------------------------
# Colors (auto-off when stderr is not a TTY, when NO_COLOR is set, or with
# --no-color, so piped and agent output stays a clean, parseable stream)
# ---------------------------------------------------------------------------
C_RESET=; C_BOLD=; C_DIM=; C_RED=; C_GREEN=; C_YELLOW=; C_BLUE=; C_CYAN=; C_GREY=
init_colors() {
  if [ "$NO_COLOR_FLAG" -eq 1 ] || [ -n "${NO_COLOR:-}" ] || [ ! -t 2 ] || [ "${TERM:-}" = "dumb" ]; then
    return 0
  fi
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'
  C_BLUE=$'\033[34m'; C_CYAN=$'\033[36m'; C_GREY=$'\033[90m'
}

# ---------------------------------------------------------------------------
# Output helpers (data to stdout, diagnostics + progress to stderr)
# ---------------------------------------------------------------------------
log()  { printf '%s\n' "$*" >&2; }
step() { printf '%s%s>>%s %s%s\n' "$C_BOLD" "$C_BLUE" "$C_RESET" "$C_BOLD" "$*$C_RESET" >&2; }
ok()   { printf '   %s+%s %s\n' "$C_GREEN" "$C_RESET" "$*" >&2; }
info() { printf '   %s-%s %s%s%s\n' "$C_GREY" "$C_RESET" "$C_DIM" "$*" "$C_RESET" >&2; }
warn() { printf '   %s!%s %s%s%s\n' "$C_YELLOW" "$C_RESET" "$C_YELLOW" "$*" "$C_RESET" >&2; }
todo() { printf '   %saction:%s %s\n' "$C_CYAN" "$C_RESET" "$*" >&2; }
vlog() { [ "$VERBOSE" -eq 1 ] && printf '   %sdebug: %s%s\n' "$C_GREY" "$*" "$C_RESET" >&2 || true; }
die()  {
  printf '%s%sx error:%s %s\n' "$C_BOLD" "$C_RED" "$C_RESET" "$1" >&2
  [ -n "${2:-}" ] && printf '     %sfix:%s %s\n' "$C_CYAN" "$C_RESET" "$2" >&2
  exit "${3:-1}"
}

# run CMD... - previews under --dry-run instead of executing.
run() {
  if [ "$DRY_RUN" -eq 1 ]; then printf '   %swould run:%s %s%s%s\n' "$C_CYAN" "$C_RESET" "$C_DIM" "$*" "$C_RESET" >&2; return 0; fi
  vlog "run: $*"
  "$@"
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "required command '$1' not found" "${2:-install $1 and retry}"
}

confirm() {
  local ans
  [ "$DRY_RUN" -eq 1 ] && return 0   # dry-run mutates nothing; let its previews through
  [ "$ASSUME_YES" -eq 1 ] && return 0
  [ "$INTERACTIVE" -eq 0 ] && die "refusing to run a confirming action non-interactively: $1" \
    "pass --yes to proceed, or --dry-run to preview"
  printf '%s [y/N] ' "$1" >&2; read -r ans; [ "$ans" = "y" ] || [ "$ans" = "Y" ]
}

# macOS is the supported target because Beeper's MCP endpoint lives in the macOS
# Desktop app. stdiod also carries a Linux (systemd --user) supervisor path, so
# we allow Linux with a warning and let `sealgate-stdiod install` report any gap.
require_supported_platform() {
  case "$(uname -s)" in
    Darwin) ;;
    Linux)  warn "Linux is experimental: the stdiod supervisor needs a systemd --user session, and Beeper's MCP is macOS-Desktop-only, so the child will have nothing to reach";;
    *)      die "unsupported platform: $(uname -s)" "macOS is supported; see stdiod/README.md";;
  esac
}

# ---------------------------------------------------------------------------
# Flag parsing (shared across subcommands; unknown flags fail fast)
# ---------------------------------------------------------------------------
# Guard a value-taking flag before dereferencing its value. Args: remaining
# count ($#), the flag, and the candidate value. Routes through die() (our error
# contract) instead of `set -u`'s raw "unbound variable" when the value is
# missing (`install --sg-backend`), and rejects a flag-looking value so a
# forgotten argument does not silently swallow the next flag
# (`install --sg-backend --no-open`).
needval() {
  local n="$1" flag="$2" val="${3:-}"
  { [ "$n" -ge 2 ] && [ "${val#-}" = "$val" ]; } \
    || die "flag '$flag' needs a value" "example: $flag <value>"
}

parse_flags() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --sg-backend)   needval $# "$1" "${2:-}"; SG_BACKEND="$2"; SG_BACKEND_SET=1; shift 2;;
      --demo)         SG_BACKEND="https://demo-dashboard.sealgate.ai"; SG_BACKEND_SET=1; shift;;
      --release)      SG_BACKEND="https://dashboard.sealgate.ai"; SG_BACKEND_SET=1; shift;;
      --sg-api-key)   needval $# "$1" "${2:-}"; SG_API_KEY="$2"; shift 2;;
      --server-name)  needval $# "$1" "${2:-}"; SERVER_NAME="$2"; shift 2;;
      --device-label) needval $# "$1" "${2:-}"; DEVICE_LABEL="$2"; shift 2;;
      --oauth-wait)   needval $# "$1" "${2:-}"; OAUTH_WAIT="$2"; shift 2;;
      --beeper-wait)  needval $# "$1" "${2:-}"; BEEPER_WAIT="$2"; shift 2;;
      --no-open)      NO_OPEN=1; shift;;
      --relogin)      RELOGIN=1; shift;;
      --no-preauth)   NO_PREAUTH=1; shift;;
      --stdiod-tag)   needval $# "$1" "${2:-}"; STDIOD_TAG="$2"; shift 2;;
      --stdiod-prerelease) STDIOD_PRERELEASE=1; STDIOD_CHANNEL_SET=1; shift;;
      --stdiod-release)    STDIOD_PRERELEASE=0; STDIOD_CHANNEL_SET=1; shift;;
      # --build-from-source is the pre-rename spelling, kept so existing
      # invocations and docs do not break.
      --from-source|--build-from-source) FROM_SOURCE=1; shift;;
      --dry-run)      DRY_RUN=1; shift;;
      -y|--yes)       ASSUME_YES=1; shift;;
      --interactive)  INTERACTIVE=1; shift;;
      --install-deps) INSTALL_DEPS=1; shift;;
      --no-color)     NO_COLOR_FLAG=1; shift;;
      --json)         JSON=1; shift;;
      --verbose)      VERBOSE=1; shift;;
      -h|--help)      return 10;;
      --) shift; break;;
      -*) die "unknown flag: $1" "run '$PROG <command> --help' for accepted flags";;
      *)  ARGS+=("$1"); shift;;
    esac
  done
}

# ---------------------------------------------------------------------------
# Step 1: prerequisites
# ---------------------------------------------------------------------------
#
# ensure_tool <cmd> <human-fix> <install-cmd...>
#   - already present            -> no-op
#   - --dry-run                  -> preview the install command, never fail
#   - no consent to auto-install -> fail fast with <human-fix>
#     (consent = --install-deps, or an --interactive session)
#   - consent given              -> confirm (auto-passed by --yes), run the
#     installer, then VALIDATE the command actually landed on PATH
ensure_tool() {
  local cmd="$1" fix="$2"; shift 2
  command -v "$cmd" >/dev/null 2>&1 && return 0

  if [ "$DRY_RUN" -eq 1 ]; then
    info "dep '$cmd' missing; would install via: $*"
    return 0
  fi
  if [ "$INSTALL_DEPS" -eq 0 ] && [ "$INTERACTIVE" -eq 0 ]; then
    die "'$cmd' is not installed" "$fix"
  fi
  confirm "'$cmd' is missing. Install it now via: $*" \
    || die "declined; '$cmd' not installed" "$fix"
  command -v "$1" >/dev/null 2>&1 || die "cannot auto-install '$cmd': '$1' not found" "$fix"
  step "installing '$cmd' via: $*"
  "$@" || die "auto-install of '$cmd' failed" "$fix"
  command -v "$cmd" >/dev/null 2>&1 || die "'$cmd' still not on PATH after install" "$fix"
  ok "installed '$cmd'"
}

# Rust toolchain, needed only to build sealgate-stdiod. rustup is the
# canonical installer; --no-modify-path leaves the user's shell files alone
# and we extend PATH for this process ourselves. Same consent model as
# ensure_tool, with one extra grace: a rustup already sitting in ~/.cargo/bin
# that just is not on PATH counts as installed.
ensure_rust() {
  command -v cargo >/dev/null 2>&1 && return 0
  if [ -x "$HOME/.cargo/bin/cargo" ]; then
    PATH="$HOME/.cargo/bin:$PATH"
    ok "found cargo in ~/.cargo/bin (added to PATH for this run)"
    return 0
  fi
  if [ "$DRY_RUN" -eq 1 ]; then
    info "dep 'cargo' missing; would install Rust via rustup (https://sh.rustup.rs)"
    return 0
  fi
  if [ "$INSTALL_DEPS" -eq 0 ] && [ "$INTERACTIVE" -eq 0 ]; then
    die "'cargo' is not installed (needed to build sealgate-stdiod)" \
      "install Rust: https://rustup.rs   (or re-run with --install-deps)"
  fi
  confirm "'cargo' is missing. Install Rust now via rustup (curl https://sh.rustup.rs | sh)?" \
    || die "declined; 'cargo' not installed" "install Rust: https://rustup.rs"
  step "installing Rust via rustup"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path \
    || die "rustup install failed" "install Rust manually: https://rustup.rs, then re-run: $PROG install"
  PATH="$HOME/.cargo/bin:$PATH"
  command -v cargo >/dev/null 2>&1 || die "'cargo' still not on PATH after rustup" \
    "open a new terminal and re-run: $PROG install"
  ok "installed Rust (rustup; ~/.cargo/bin on PATH for this run)"
}

# ---------------------------------------------------------------------------
# sealgate-stdiod binary: download the prebuilt release binary
# ---------------------------------------------------------------------------
# The DEFAULT path needs no Rust toolchain and no checkout: the desktop app's
# release workflow (.github/workflows/desktop-release.yml) publishes a
# per-platform sealgate-stdiod binary onto the app's own `v<version>` release,
# so we just download and checksum-verify one. Building from source is the
# opt-in power-user path (--from-source) and is never entered automatically -
# a silent multi-minute cargo build after a failed download is exactly the
# surprise this one-liner exists to avoid.
#
# The daemon version follows the app version (npm run version:sync), so there
# is no separate stdiod-v* tag to discover: the app's newest release IS the
# newest daemon.

# Map this machine to a published asset. Echoes "<asset> <checksums-file>".
# Names and the per-platform-arch checksum split match the upload steps in
# desktop-release.yml; a shared SHA256SUMS would race across its five build legs.
stdiod_release_asset() {
  case "$(uname -s)/$(uname -m)" in
    Darwin/arm64)              printf 'sealgate-stdiod-macos-arm64 SHA256SUMS-macos-arm64';;
    Linux/x86_64)              printf 'sealgate-stdiod-linux-x64 SHA256SUMS-linux-x64';;
    Linux/aarch64|Linux/arm64) printf 'sealgate-stdiod-linux-arm64 SHA256SUMS-linux-arm64';;
    *) return 1;;
  esac
}

# Newest app release tag carrying the daemon assets, for the requested channel.
#
# The two channels are separate LINEAGES, not two points on one line, so this
# never mixes them:
#
#   stable (default)      `v<major>.<minor>.<patch>`, built from the release
#                         branch by desktop-release.yml.
#   demo (--stdiod-prerelease)
#                         `v<version>-beta.<n>`, built from main by
#                         desktop-release-demo.yml.
#
# So --stdiod-prerelease selects the newest BETA specifically - not "the newest
# release of any kind". Those differ whenever a stable was cut more recently
# than the last demo build, and picking the stable there would silently hand a
# main-tracking tester a release-branch daemon.
#
# When the API is unreachable (proxy, unauthenticated rate limit), fall back to
# git tag listing over the same endpoint cloning uses, version-sorted
# client-side and filtered to the same channel's tags.
latest_stdiod_tag() {
  local tag tag_re='^v[0-9]+\.[0-9]+\.[0-9]+$'
  if [ "$STDIOD_PRERELEASE" = "1" ]; then
    # Require the prerelease suffix: this pool is betas only.
    tag_re='^v[0-9]+\.[0-9]+\.[0-9]+-[0-9A-Za-z.]+$'
    # The list endpoint carries prereleases (and, unauthenticated, no drafts),
    # but it is ordered by the release's created_at - the TAG date, not the
    # publish date - so its order does not track "newest" at all: this repo
    # currently lists v0.6.4-beta.9, then beta.8, then beta.10. Sort the tags
    # ourselves instead of trusting the order.
    tag="$(curl -fsSL -m 15 "https://api.github.com/repos/$STDIOD_REPO/releases?per_page=100" 2>/dev/null \
      | grep -oE '"tag_name": *"[^"]*"' \
      | sed -E 's/.*"([^"]*)"$/\1/' \
      | grep -E "$tag_re" \
      | sort -uV 2>/dev/null | tail -n 1 || true)"
  else
    # A single authoritative value - GitHub's own "Latest" pointer - so there is
    # nothing to sort and no chance of picking up a prerelease.
    tag="$(curl -fsSL -m 15 "https://api.github.com/repos/$STDIOD_REPO/releases/latest" 2>/dev/null \
      | grep -oE '"tag_name": *"[^"]*"' \
      | sed -E 's/.*"([^"]*)"$/\1/' \
      | head -n 1 || true)"
  fi
  if [ -n "$tag" ]; then printf '%s' "$tag"; return 0; fi
  command -v git >/dev/null 2>&1 || return 1
  git ls-remote --tags "https://github.com/$STDIOD_REPO" 'v*' 2>/dev/null \
    | sed -E 's#.*refs/tags/##; s#\^\{\}$##' \
    | grep -E "$tag_re" \
    | sort -uV 2>/dev/null | tail -n 1
}

sha256_of() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
  else sha256sum "$1" | awk '{print $1}'; fi
}

# curl for release downloads: fail on HTTP errors, follow redirects, and keep
# curl's own error line off stderr unless --verbose asked for it.
curl_quiet() {
  if [ "$VERBOSE" -eq 1 ]; then curl -fsSL "$@"; else curl -fsSL "$@" 2>/dev/null; fi
}

# Download + verify + install the prebuilt binary into ~/.local/bin.
# Returns 1 on any recoverable miss (unsupported platform, no tag, missing asset
# or checksums, binary that will not run here); the caller turns that into a
# clear failure naming --from-source, rather than silently starting a build.
# A checksum MISMATCH is never recoverable; that dies loudly on the spot.
install_stdiod_prebuilt() {
  local pair asset sums tag base dir want got dest="$HOME/.local/bin"
  pair="$(stdiod_release_asset)" \
    || { info "no prebuilt sealgate-stdiod for $(uname -s)/$(uname -m)"; return 1; }
  asset="${pair%% *}"; sums="${pair##* }"
  tag="${STDIOD_TAG:-$(latest_stdiod_tag)}"
  local channel="stable"; [ "$STDIOD_PRERELEASE" = "1" ] && channel="demo (-beta)"
  [ -n "$tag" ] \
    || { warn "no $channel release found on $STDIOD_REPO (or the GitHub API is unreachable)"; return 1; }
  base="https://github.com/$STDIOD_REPO/releases/download/$tag"
  step "downloading prebuilt sealgate-stdiod ($tag)"
  dir="$(mktemp -d)"
  # curl's own stderr is suppressed unless --verbose: a bare "curl: (56) ..."
  # printed above our warn() line reads like the real diagnosis when it is not.
  # The warn lines below say what actually went wrong; -v recovers the detail.
  if ! curl_quiet -m 300 -o "$dir/$asset" "$base/$asset"; then
    warn "release $tag has no asset '$asset' (or the download failed)"
    rm -rf "$dir"; return 1
  fi
  if ! curl_quiet -m 60 -o "$dir/sums" "$base/$sums"; then
    warn "release $tag has no checksums file '$sums'; refusing the unverified binary"
    rm -rf "$dir"; return 1
  fi
  want="$(grep -E "[[:space:]]\*?$asset\$" "$dir/sums" | awk '{print $1}' | head -n 1)"
  got="$(sha256_of "$dir/$asset")"
  if [ -z "$want" ] || [ "$want" != "$got" ]; then
    rm -rf "$dir"
    die "checksum mismatch for $asset from $tag (expected ${want:-<absent>}, got $got)" \
      "the release assets may be corrupt or tampered with; retry, or build locally: $PROG install --from-source"
  fi
  chmod +x "$dir/$asset"
  if ! "$dir/$asset" --version >/dev/null 2>&1; then
    warn "downloaded $asset does not run on this machine ('--version' failed)"
    rm -rf "$dir"; return 1
  fi
  mkdir -p "$dest"
  # Unlink first. Writing over a signed Mach-O in place keeps the inode, and the
  # kernel's cached signing state for that vnode goes stale - the binary then
  # dies with SIGKILL. `mv` across filesystems degrades to a copy, so this is
  # not hypothetical.
  rm -f "$dest/sealgate-stdiod"
  mv "$dir/$asset" "$dest/sealgate-stdiod"
  rm -rf "$dir"
  PATH="$dest:$PATH"
  ok "installed prebuilt sealgate-stdiod $tag -> $dest/sealgate-stdiod (sha256 verified)"
  case ":$PATH_AT_LAUNCH:" in
    *":$dest:"*) ;;
    *) todo "add $dest to your PATH (e.g. append 'export PATH=\"\$HOME/.local/bin:\$PATH\"' to your shell profile)";;
  esac
  return 0
}

# Build sealgate-stdiod locally. Only ever reached via --from-source: this is
# the path with real prerequisites (Rust, a C toolchain for `ring`'s crypto, and
# a checkout of this repo), so it must never happen to someone who just ran the
# one-liner.
build_stdiod_from_source() {
  local fix="drop --from-source to download the prebuilt binary instead"
  local stdiod_src; stdiod_src="$(dirname "$0")/../crates/sealgate-stdiod"
  [ -f "$stdiod_src/Cargo.toml" ] \
    || die "--from-source needs a checkout, and there is none at $stdiod_src" \
           "clone it and run the script from there: git clone https://github.com/$STDIOD_REPO && bash app/crates/stdiod/scripts/$PROG install --from-source"
  # `ring` compiles C, which rustup does not provide a compiler for. Checking
  # here turns a confusing linker error minutes into the build into an
  # actionable message before cargo starts.
  if [ "$(uname -s)" = "Darwin" ] && ! xcrun --find cc >/dev/null 2>&1; then
    die "--from-source needs a C toolchain (the 'ring' crate compiles C) and the Xcode Command Line Tools are missing" \
      "install them: xcode-select --install"
  fi
  ensure_rust
  step "building sealgate-stdiod from source (cargo install; takes a few minutes)"
  cargo install --path "$stdiod_src" || die "cargo install failed" "$fix"
  command -v sealgate-stdiod >/dev/null 2>&1 \
    || die "'sealgate-stdiod' still not on PATH after cargo install" \
           "ensure ~/.cargo/bin is on PATH, then re-run: $PROG install"
  ok "built and installed sealgate-stdiod from source"
}

# One entry point for getting the binary, honoring the shared consent model.
#
# Download-only by default. A failed download does NOT fall through to a build:
# the whole point of the one-liner is that it needs no Rust and no checkout, so
# an automatic fallback would spring a multi-minute toolchain install on someone
# who never asked for one. It fails instead, naming --from-source.
ensure_stdiod_bin() {
  command -v sealgate-stdiod >/dev/null 2>&1 && return 0
  if [ -x "$HOME/.local/bin/sealgate-stdiod" ]; then
    PATH="$HOME/.local/bin:$PATH"
    ok "found sealgate-stdiod in ~/.local/bin (added to PATH for this run)"
    return 0
  fi
  if [ "$DRY_RUN" -eq 1 ]; then
    if [ "$FROM_SOURCE" -eq 1 ]; then
      info "dep 'sealgate-stdiod' missing; would build it from source (needs Rust + a C toolchain + a checkout)"
    else
      info "dep 'sealgate-stdiod' missing; would download the prebuilt release binary (no Rust needed)"
    fi
    return 0
  fi
  local fix="re-run with --install-deps"
  if [ "$INSTALL_DEPS" -eq 0 ] && [ "$INTERACTIVE" -eq 0 ]; then
    die "'sealgate-stdiod' is not installed" "$fix"
  fi
  if [ "$FROM_SOURCE" -eq 1 ]; then
    confirm "sealgate-stdiod is missing. Build it from source now (needs Rust and a few minutes)?" \
      || die "declined; 'sealgate-stdiod' not installed" "$fix"
    build_stdiod_from_source
    return 0
  fi
  confirm "sealgate-stdiod is missing. Download the prebuilt release binary now?" \
    || die "declined; 'sealgate-stdiod' not installed" "$fix"
  install_stdiod_prebuilt && return 0
  die "could not install a prebuilt sealgate-stdiod (see the warnings above)" \
    "check https://github.com/$STDIOD_REPO/releases for an asset matching $(uname -s)/$(uname -m), pin one with --stdiod-tag <tag>, or build locally: $PROG install --install-deps --from-source"
}

ensure_deps() {
  step "Checking prerequisites"
  require_supported_platform
  ensure_tool npx \
    "install Node (brew install node) or re-run with --install-deps" \
    brew install --quiet node
  # No Deno: @beeper/mcp-remote only proxies to Beeper's built-in MCP server.
  # The Deno sandbox was a @beeper/desktop-mcp `execute` tool requirement.
  ensure_stdiod_bin
  if [ "$DRY_RUN" -eq 1 ]; then
    info "deps: preview only (nothing was installed)"
  else
    ok "npx and sealgate-stdiod present"
  fi
}

# ---------------------------------------------------------------------------
# Step A: Beeper Desktop app + its MCP endpoint
# ---------------------------------------------------------------------------
# The Beeper Client API is local-only, so every URL that later receives an
# Authorization: Bearer header (the API base and the userinfo endpoint) must
# resolve to a loopback host. This blocks a hostile BEEPER_API_URL or a
# userinfo_endpoint injected into the well-known document from turning token
# discovery into a leak of every scraped candidate to a remote server.
is_loopback_url() {
  local host
  host="$(printf '%s' "$1" | sed -E 's#^[a-zA-Z][a-zA-Z0-9+.-]*://##; s#/.*$##; s#:[0-9]+$##')"
  case "$host" in
    127.0.0.1|localhost|"[::1]"|::1) return 0;;
    *) return 1;;
  esac
}

# Echo the first reachable Beeper Desktop API base URL, or nothing (exit 1).
# The app answers on 127.0.0.1:23373 by default; it may also bind IPv6 ([::1])
# or scan 23373-23378. BEEPER_API_URL overrides the probe (loopback only).
beeper_api_base() {
  local wk="/.well-known/oauth-authorization-server" code h p url
  if [ -n "${BEEPER_API_URL:-}" ]; then
    if is_loopback_url "$BEEPER_API_URL"; then
      code="$(curl -s -m 3 -o /dev/null -w '%{http_code}' "${BEEPER_API_URL}${wk}" 2>/dev/null || true)"
      [ -n "$code" ] && [ "$code" != "000" ] && { printf '%s' "$BEEPER_API_URL"; return 0; }
    else
      warn "ignoring non-loopback BEEPER_API_URL ($BEEPER_API_URL); the Beeper Client API is local-only"
    fi
  fi
  for h in 127.0.0.1 localhost "[::1]"; do
    for p in 23373 23374 23375 23376 23377 23378; do
      url="http://$h:$p"
      code="$(curl -s -m 2 -o /dev/null -w '%{http_code}' "${url}${wk}" 2>/dev/null || true)"
      [ -n "$code" ] && [ "$code" != "000" ] && { printf '%s' "$url"; return 0; }
    done
  done
  return 1
}

# Sets MCP_ENDPOINT (the full /v0/mcp URL) when Beeper answers on a base other
# than the proxy's built-in default (http://localhost:23373), so the proxy must
# be told where to connect; leaves it empty when the default works or Beeper is
# down. The headless `beeper` server commonly lands on 23374, which the probe
# finds but the proxy would never try on its own.
MCP_ENDPOINT=""
resolve_mcp_endpoint() {
  MCP_ENDPOINT=""
  local base
  base="$(beeper_api_base 2>/dev/null)" || return 0
  case "$base" in
    http://127.0.0.1:23373|http://localhost:23373) ;;
    *) MCP_ENDPOINT="$base/v0/mcp";;
  esac
}

# Echo the installed Beeper Desktop bundle path on macOS, or nothing (exit 1).
# The Homebrew cask installs "Beeper Desktop.app"; older manual installs may
# be named "Beeper.app".
beeper_desktop_app() {
  local d
  for d in "/Applications/Beeper Desktop.app" "$HOME/Applications/Beeper Desktop.app" \
           "/Applications/Beeper.app" "$HOME/Applications/Beeper.app"; do
    [ -d "$d" ] && { printf '%s' "$d"; return 0; }
  done
  return 1
}

# Offer to install Beeper Desktop via the Homebrew cask (macOS only; the cask
# needs macOS 12+). Consent model matches ensure_tool (--install-deps or
# --interactive to attempt, confirmed unless --yes), but NON-FATAL throughout:
# install can still wire the whole SealGate side with Beeper absent, so every
# failure path prints the manual action and returns 1 instead of dying.
install_beeper_desktop() {
  local fix="install Beeper Desktop: brew install --cask beeper   (or https://www.beeper.com/download)"
  if ! { [ "$INSTALL_DEPS" -eq 1 ] || [ "$INTERACTIVE" -eq 1 ]; } \
     || ! { [ "$ASSUME_YES" -eq 1 ] || [ "$INTERACTIVE" -eq 1 ]; }; then
    todo "$fix, then re-run: $PROG install"
    return 1
  fi
  confirm "Beeper Desktop is not installed. Install it now via: brew install --cask beeper" \
    || { todo "$fix, then re-run: $PROG install"; return 1; }
  command -v brew >/dev/null 2>&1 \
    || { warn "brew not found; cannot auto-install Beeper Desktop"; todo "$fix"; return 1; }
  step "installing Beeper Desktop via: brew install --cask beeper"
  if ! brew install --quiet --cask beeper; then
    warn "brew install --cask beeper failed (the cask needs macOS 12+)"
    todo "$fix"
    return 1
  fi
  # brew can exit 0 with the cask recorded but the .app never placed (a staged
  # or interrupted install leaves an empty Caskroom dir). Check the artifact,
  # not the exit code.
  local app
  if ! app="$(beeper_desktop_app)"; then
    warn "brew reported success but Beeper Desktop.app is not in /Applications"
    todo "reinstall it: brew reinstall --cask beeper   (or https://www.beeper.com/download)"
    return 1
  fi
  ok "installed Beeper Desktop: $app"
  return 0
}

# Non-fatal: if Beeper Desktop is not answering we still wire the automatable
# SealGate side and print the exact action, so `install` makes progress instead of
# stopping the operator at the first prerequisite. On macOS this also offers to
# install the app itself (consent-gated) and opens it so the operator can sign
# in; signing in and linking chats stay human steps by nature.
# Poll the Beeper client API for up to N seconds. Echoes the base URL when it
# comes up. beeper_api_base returns fast when nothing is listening.
wait_beeper_api() {
  local deadline=$(( SECONDS + $1 )) base
  while [ "$SECONDS" -lt "$deadline" ]; do
    base="$(beeper_api_base 2>/dev/null)" && { printf '%s' "$base"; return 0; }
    sleep 2
  done
  return 1
}

ensure_beeper_desktop() {
  step "Beeper Desktop"
  if [ "$DRY_RUN" -eq 1 ]; then
    info "would look for Beeper Desktop.app in /Applications and ~/Applications"
    info "would probe 127.0.0.1:23373-23378 for the Beeper Client API"
    info "if either is missing on macOS: would offer 'brew install --cask beeper' and open the app"
    return 0
  fi

  # Report the app and the API separately. They are independent: an installed
  # app says nothing about the API (MCP is off by default), and a headless
  # 'beeper' server answers the API with no app at all.
  local app="" base=""
  app="$(beeper_desktop_app)" || true
  if [ -n "$app" ]; then
    ok "app:        $app"
  else
    warn "app:        Beeper Desktop.app not found in /Applications or ~/Applications"
  fi

  base="$(beeper_api_base)" || true
  if [ -n "$base" ]; then
    ok "client API: responding at $base"
    BEEPER_READY=1
  else
    warn "client API: no response on 127.0.0.1:23373-23378"
  fi

  [ -n "$base" ] && return 0

  case "$(uname -s)" in
    Darwin)
      # Install first if needed, then re-read the path: opening by bundle name
      # fails silently if the cask ever ships a different display name.
      if [ -z "$app" ] && install_beeper_desktop; then
        app="$(beeper_desktop_app)" || app=""
      fi
      if [ -n "$app" ]; then
        info "opening $app"
        if open "$app" 2>/dev/null && [ "$BEEPER_WAIT" -gt 0 ]; then
          # An app that is already signed in with MCP on comes up in seconds.
          # Waiting here lets preauth run in this same pass.
          info "waiting up to ${BEEPER_WAIT}s for the client API"
          if base="$(wait_beeper_api "$BEEPER_WAIT")"; then
            ok "client API: responding at $base"
            BEEPER_READY=1
            return 0
          fi
        fi
      fi
      todo "in Beeper Desktop: sign in (create the account if needed), then enable Settings > Developers > MCP"
      todo "link the chats you want (WhatsApp / Telegram / ...) in Beeper"
      info "once MCP is enabled, re-run '$PROG install' (idempotent) or '$PROG preauth' to finish the Beeper side"
      ;;
    *)
      todo "start Beeper: the Desktop app (https://www.beeper.com/download), or a headless server via 'beeper setup --server --install'"
      todo "link the chats you want (WhatsApp / Telegram / ...) in Beeper"
      ;;
  esac
  info "@beeper/mcp-remote proxies this local Client API's MCP server, so either the Desktop app or a headless server works"
  warn "continuing to wire the SealGate side; the Beeper child stays idle until Beeper is reachable"
}

# Escape a value for safe interpolation into a JSON string literal. Covers the
# characters JSON forbids raw: backslash (first), double-quote, and the common
# controls. Keeps --json output valid even when a label or backend contains
# quotes or backslashes.
json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\r'/\\r}"
  s="${s//$'\t'/\\t}"
  printf '%s' "$s"
}

# ---------------------------------------------------------------------------
# Step 5 / C: prime the Beeper OAuth grant
# ---------------------------------------------------------------------------
# @beeper/mcp-remote authenticates to Beeper's MCP server with the MCP OAuth
# flow: on first connect Beeper raises an approve/deny prompt (in the Desktop
# app; a headless server prints an approval URL) and caches the grant locally
# for later spawns (same $HOME, so the daemon's child reuses it). Priming here
# surfaces the prompt while a human is watching the install, instead of the
# daemon's first spawn stalling on an unseen dialog. Mechanism: spawn the
# proxy, send one MCP initialize over stdio, and poll for a reply; the proxy
# only answers once the grant exists.
prime_oauth_grant() {
  step "Beeper OAuth grant (approve in Beeper if prompted)"
  if [ "$DRY_RUN" -eq 1 ]; then
    info "would run 'npx -y $MCP_PKG', send an MCP initialize, and wait up to ${OAUTH_WAIT}s for the grant"
    return 0
  fi
  if ! beeper_api_base >/dev/null 2>&1; then
    warn "skipping: the Beeper Client API is not reachable, so there is nothing to authorize yet"
    todo "once Beeper is running with MCP enabled, run: $PROG preauth"
    return 0
  fi
  resolve_mcp_endpoint
  [ -n "$MCP_ENDPOINT" ] && info "Beeper answers on a non-default port; pointing the proxy at $MCP_ENDPOINT"
  local dir init pid waited=0 auth_url=""
  dir="$(mktemp -d "${TMPDIR:-/tmp}/install-beeper.XXXXXX")"
  init='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"install-beeper","version":"1.0.0"}}}'
  # The sleep holds the proxy's stdin open while OAuth completes; after we kill
  # npx, that same EOF (or the sleep expiring) winds down any child it spawned.
  # ${MCP_ENDPOINT:+...} expands to nothing when unset, so the proxy keeps its
  # built-in default; the guarded form stays safe under bash 3.2's set -u.
  { printf '%s\n' "$init"; sleep "$OAUTH_WAIT"; } | npx -y "$MCP_PKG" ${MCP_ENDPOINT:+"$MCP_ENDPOINT"} >"$dir/out" 2>"$dir/err" &
  pid=$!
  info "if Beeper raises an approval prompt, approve it (waiting up to ${OAUTH_WAIT}s)"
  while [ "$waited" -lt "$OAUTH_WAIT" ]; do
    grep -q '"result"' "$dir/out" 2>/dev/null && break
    kill -0 "$pid" 2>/dev/null || break
    # Surface the authorization URL as soon as the proxy prints it: on a
    # headless server there is no Desktop dialog, so this URL is the only way
    # to approve. Print it once. The trailing || true keeps a no-match grep
    # (status 1) from killing the script under set -e + pipefail.
    if [ -z "$auth_url" ]; then
      auth_url="$(grep -oE 'https?://[^[:space:]"'\'']*authorize[^[:space:]"'\'']*' "$dir/err" 2>/dev/null | head -n1 || true)"
      [ -n "$auth_url" ] && todo "no prompt? open this URL in a browser to approve: $auth_url"
    fi
    sleep 1; waited=$((waited + 1))
  done
  # Bounded teardown: TERM, give it a second, then KILL. A blocking `wait`
  # here could stall the whole script if the child defers TERM while inside a
  # long-running call; the script exits soon anyway, so reaping can wait.
  kill "$pid" 2>/dev/null || true
  sleep 1
  kill -9 "$pid" 2>/dev/null || true
  if grep -q '"result"' "$dir/out" 2>/dev/null; then
    if [ "$waited" -le 3 ]; then
      ok "MCP handshake completed immediately (grant already cached)"
    else
      ok "OAuth grant approved; the MCP handshake completed"
    fi
    rm -rf "$dir"
    return 0
  fi
  warn "no MCP handshake within ${OAUTH_WAIT}s"
  [ -s "$dir/err" ] && info "proxy stderr (tail): $(tail -n 3 "$dir/err" | tr '\n' ' ')"
  todo "keep Beeper running and re-run: $PROG preauth   (then approve the prompt it raises)"
  info "until the grant exists, the daemon's '$SERVER_NAME' child cannot reach Beeper"
  rm -rf "$dir"
  return 0
}

# ---------------------------------------------------------------------------
# Shared: is SERVER_NAME already an approved server bound to this device?
# ---------------------------------------------------------------------------
# Single definition of the script's idempotency contract, used by install and
# doctor. Prefers a precise jq match on the server name; falls back to a raw
# substring grep when jq is absent.
server_registered() {
  command -v sealgate-stdiod >/dev/null 2>&1 || return 1
  local json; json="$(sealgate-stdiod server list --json 2>/dev/null || true)"
  [ -n "$json" ] || return 1
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$json" | jq -e --arg n "$SERVER_NAME" 'any(.. | objects; .name? == $n)' >/dev/null 2>&1
  else
    printf '%s' "$json" | grep -q "\"$SERVER_NAME\""
  fi
}

# ---------------------------------------------------------------------------
# Step 2 + 3: authorize this device and supervise the daemon
# ---------------------------------------------------------------------------
stdiod_config() { printf '%s' "${SEALGATE_STDIOD_CONFIG:-$HOME/.config/sealgate-stdiod/config.toml}"; }

# True when config already holds a client credential from a prior browser login.
# Says nothing about whether that credential still WORKS - see
# stdiod_credential_state.
stdiod_logged_in() {
  local f; f="$(stdiod_config)"
  [ -f "$f" ] && grep -q 'client_access_token' "$f" 2>/dev/null
}

# Cached result of stdiod_credential_state. Cleared after a successful login so
# a re-probe reflects the new credential.
STDIOD_CRED_STATE=""

# Echo the real state of the saved credential, one of:
#
#   absent   no credential in config - never logged in, or config was wiped
#   live     the backend accepted it
#   dead     the backend rejected it (401): expired, revoked, or the device was
#            removed by an admin
#   unknown  the check itself could not run (backend unreachable, no binary) -
#            NOT evidence of anything about the credential
#
# `dead` is the state that used to be invisible. Presence of the token in
# config.toml was treated as proof of authorization, so a revoked credential
# reported as authorized while every backend call 401'd, and the failure
# surfaced downstream as "server not approved yet" - pointing at the dashboard
# instead of at `--relogin`, which is the only thing that fixes it.
#
# `unknown` is deliberately distinct from `dead`: an offline machine must not be
# told its credential was revoked, and must not be pushed into a browser login
# that cannot succeed either.
stdiod_credential_state() {
  if [ -n "$STDIOD_CRED_STATE" ]; then printf '%s' "$STDIOD_CRED_STATE"; return 0; fi
  local out
  if ! stdiod_logged_in; then
    STDIOD_CRED_STATE="absent"
  elif ! command -v sealgate-stdiod >/dev/null 2>&1; then
    STDIOD_CRED_STATE="unknown"
  elif out="$(sealgate-stdiod server list --json 2>&1)"; then
    STDIOD_CRED_STATE="live"
  elif printf '%s' "$out" | grep -qiE '\b401\b|unauthorized|invalid[-_ ]?token|token (expired|revoked)'; then
    STDIOD_CRED_STATE="dead"
  else
    # Some other failure - DNS, TLS, proxy, backend 5xx. Report it under
    # --verbose; the step that actually needs the backend will fail with a
    # better message than a guess made here.
    vlog "credential check inconclusive: $(printf '%s' "$out" | tail -n 1)"
    STDIOD_CRED_STATE="unknown"
  fi
  printf '%s' "$STDIOD_CRED_STATE"
}

# Echo the backend_url persisted in config (trailing slash stripped), or nothing.
stdiod_saved_backend() {
  local f; f="$(stdiod_config)"
  [ -f "$f" ] || return 0
  sed -n 's/^[[:space:]]*backend_url[[:space:]]*=[[:space:]]*"\{0,1\}\([^"]*\)"\{0,1\}.*/\1/p' \
    "$f" 2>/dev/null | head -n1 | sed 's:/*$::'
}

# When no backend was given explicitly, follow the one this device is already
# authorized to (from stdiod config) instead of the release default. Stops
# commands from silently targeting the wrong environment.
resolve_backend() {
  [ "$SG_BACKEND_SET" -eq 1 ] && return 0
  local saved; saved="$(stdiod_saved_backend)"
  if [ -n "$saved" ] && [ "$saved" != "${SG_BACKEND%/}" ]; then
    SG_BACKEND="$saved"
    info "using the backend this device is authorized to: ${SG_BACKEND} (override with --sg-backend / --demo / --release)"
  fi
}

# Pick the daemon channel to match the backend, unless it was pinned.
#
# The demo backend is fed by the demo release workflow off main, and stable by
# the release branch - so a device pointed at demo wants the -beta daemon, and
# mixing them means running a daemon from a different lineage than the backend
# it talks to. Runs AFTER resolve_backend so it follows a backend inherited
# from the device's saved session too, not just an explicit flag.
#
# Not applied when --stdiod-tag pinned a tag: the tag already names a specific
# build, and second-guessing it would make the pin unreliable.
resolve_stdiod_channel() {
  [ "$STDIOD_CHANNEL_SET" -eq 1 ] && return 0
  [ -n "$STDIOD_TAG" ] && return 0
  case "${SG_BACKEND%/}" in
    *//demo-*|*//*-demo.*)
      STDIOD_PRERELEASE=1
      vlog "demo backend (${SG_BACKEND}): taking the daemon from the demo channel"
      ;;
  esac
}

ensure_stdiod_auth() {
  step "SealGate device authorization (browser)"
  if [ "$DRY_RUN" -eq 1 ]; then
    run sealgate-stdiod login --backend "$SG_BACKEND"
    return 0
  fi
  # `dead` falls through to the login below rather than short-circuiting: a
  # revoked credential used to be treated as proof of authorization, so install
  # skipped login, then failed at `server add` with a 401 and told the operator
  # to re-run - which skipped login again, forever. Re-authorizing is the repair,
  # and doing it here is what makes `install` idempotent for this case too.
  local cred="skip"
  [ "$RELOGIN" -eq 0 ] && cred="$(stdiod_credential_state)"
  case "$cred" in
    live|unknown)
      local saved; saved="$(stdiod_saved_backend)"
      if [ -n "$saved" ] && [ "$saved" != "${SG_BACKEND%/}" ]; then
        # An explicit --sg-backend that disagrees with the saved session is
        # ambiguous, so stop rather than silently target the wrong backend. With
        # no explicit flag, prefer the authorized session.
        if [ "$SG_BACKEND_SET" -eq 1 ]; then
          die "this device is authorized to ${saved}, but --sg-backend asked for ${SG_BACKEND}" \
            "pass --relogin to switch to ${SG_BACKEND}, or drop --sg-backend to keep ${saved}"
        fi
        warn "using the authorized backend ${saved} (pass --sg-backend <url> --relogin to switch)"
        SG_BACKEND="$saved"
      fi
      if [ "$cred" = "unknown" ]; then
        # Could not reach the backend to check. Logging in again would not work
        # either, so keep the credential and let the next step report the real
        # network error.
        warn "could not verify the saved credential (backend unreachable); using it as-is"
      else
        ok "already authorized on this device (client credential in $(stdiod_config))"
      fi
      return 0
      ;;
    dead)
      warn "the saved credential is expired or revoked (${SG_BACKEND%/} returned 401)"
      info "re-running the browser device flow to replace it"
      ;;
  esac
  # `sealgate-stdiod login` runs the OAuth device flow: it prints a URL to approve
  # (and opens a browser unless --no-open), then stores a scoped client
  # credential. No API key, no step-up token.
  local args=(login --backend "$SG_BACKEND")
  [ "$NO_OPEN" -eq 1 ] && args+=(--no-open)
  info "a browser opens to approve this device; on a headless box pass --no-open and open the printed URL elsewhere"
  if ! run sealgate-stdiod "${args[@]}"; then
    die "sealgate-stdiod login failed" "check --sg-backend (${SG_BACKEND}) and complete the browser approval, then re-run: $PROG install"
  fi
  STDIOD_CRED_STATE=""   # a fresh credential: drop the cached probe result
  ok "device authorized to ${SG_BACKEND}"
}

# Current connection_state from state.json ("connected", "needs_reauth", ...).
stdiod_connection_state() {
  local f="${SEALGATE_STDIOD_STATE:-$HOME/.config/sealgate-stdiod/state.json}"
  [ -f "$f" ] || return 0
  sed -n 's/.*"connection_state"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$f" | head -n1
}

# Wait for the daemon to register with the backend. The backend refuses a
# server request until the device has connected, and answers with a 409 that
# looks exactly like a name conflict - so submitting before this is ready sends
# the caller chasing the wrong problem.
wait_stdiod_connected() {
  local deadline=$(( SECONDS + $1 )) st
  while [ "$SECONDS" -lt "$deadline" ]; do
    st="$(stdiod_connection_state)"
    case "$st" in
      connected) return 0;;
      needs_reauth) warn "the daemon's credential was rejected (run: $PROG install --relogin)"; return 1;;
      needs_upgrade) warn "the daemon is too old for this backend; update it"; return 1;;
    esac
    sleep 2
  done
  return 1
}

ensure_stdiod_supervised() {
  step "SealGate tunnel daemon (supervisor)"
  # Drop the old state file first. It describes the PREVIOUS run, and the
  # daemon does not rewrite it until it starts - so a stale "needs_reauth" from
  # a run before this login would be read as a live verdict and abort the wait
  # below while the new daemon was connecting normally. The daemon recreates it
  # on start; `sealgate-stdiod uninstall` removes it for the same reason.
  [ "$DRY_RUN" -eq 0 ] && rm -f "${SEALGATE_STDIOD_STATE:-$HOME/.config/sealgate-stdiod/state.json}"
  if ! run sealgate-stdiod install; then
    die "sealgate-stdiod install could not register the supervisor unit" \
      "macOS needs no privileges; Linux needs a logged-in systemd --user session. Fix that, then re-run: $PROG install"
  fi
  ok "daemon installed and supervised"
  [ "$DRY_RUN" -eq 1 ] && return 0
  info "waiting up to ${CONNECT_WAIT}s for the daemon to register with the backend"
  if wait_stdiod_connected "$CONNECT_WAIT"; then
    ok "daemon connected"
    STDIOD_CONNECTED=1
  else
    warn "the daemon has not connected yet (state: $(stdiod_connection_state))"
  fi
}

# ---------------------------------------------------------------------------
# Step 4: submit the Beeper stdio server for approval
# ---------------------------------------------------------------------------
# Under device authorization, `server add` submits a request scoped to this
# exact device (POST /api/v1/client/mcp-requests). An org admin approves it once
# in the dashboard; it does not run until then. `server_registered` lists only
# approved servers bound to this device, so we use it as the idempotency check.
# First 3 chars of this device's user id, used to disambiguate a taken server
# name. Empty if the config has no user id (legacy credential).
stdiod_uid_suffix() {
  local f; f="$(stdiod_config)"
  [ -f "$f" ] || return 0
  sed -n 's/^[[:space:]]*authenticated_user_id[[:space:]]*=[[:space:]]*"\{0,1\}\([^"]*\)"\{0,1\}.*/\1/p' \
    "$f" 2>/dev/null | head -n1 | cut -c1-3
}

# Submit one server by name. Echoes the CLI output; returns its exit code.
server_add() {
  sealgate-stdiod server add "$1" --display-name "Beeper" \
    --command npx --arg=-y --arg="$MCP_PKG" ${MCP_ENDPOINT:+--arg="$MCP_ENDPOINT"} 2>&1
}

# True when the add failed with a 409, which the backend uses for a name that
# is already taken. The CLI prints "<op> returned HTTP <status>" (http.rs) and
# never the response body, so the status line is the only thing to match on.
name_taken() {
  printf '%s' "$1" | grep -qiE 'HTTP 409'
}

submit_beeper_server() {
  step "Submitting the Beeper server"
  # The submitted command must carry the endpoint when Beeper sits on a
  # non-default port, or the daemon's child dials 23373 and ECONNREFUSEs.
  resolve_mcp_endpoint
  [ -n "$MCP_ENDPOINT" ] && info "Beeper answers on a non-default port; the server command includes $MCP_ENDPOINT"
  if [ "$DRY_RUN" -eq 1 ]; then
    run sealgate-stdiod server add "$SERVER_NAME" --display-name "Beeper" \
      --command npx --arg=-y --arg="$MCP_PKG" ${MCP_ENDPOINT:+--arg="$MCP_ENDPOINT"}
    return 0
  fi

  local suffix alt=""
  suffix="$(stdiod_uid_suffix)"
  [ -n "$suffix" ] && alt="${SERVER_NAME}-${suffix}"

  if server_registered; then
    ok "server '$SERVER_NAME' is already approved and bound to this device"
    return 0
  fi
  # A previous run may have fallen back to the suffixed name; adopt it so
  # re-running does not submit a second server.
  if [ -n "$alt" ] && SERVER_NAME="$alt" server_registered; then
    SERVER_NAME="$alt"
    ok "server '$SERVER_NAME' is already approved and bound to this device"
    return 0
  fi

  # Capture with '&& rc=0 || rc=$?' so a non-zero add does not trip set -e.
  # Use --arg=VALUE: clap rejects a hyphen-leading value in the space form.
  # `tried` is the name the messages below refer to - it may not be SERVER_NAME,
  # which only changes once an add succeeds.
  local out rc tried="$SERVER_NAME"
  out="$(server_add "$tried")" && rc=0 || rc=$?
  printf '%s\n' "$out" | grep -viE '^[[:space:]]*$' >&2 || true

  # The name is unique across the backend, not per device, so it can be held by
  # a server this device cannot see. Retry once under a user-scoped name rather
  # than stopping on a conflict the operator has no way to inspect.
  if [ "$rc" -ne 0 ] && name_taken "$out" && [ -n "$alt" ]; then
    warn "'$tried' is already taken on this backend; retrying as '$alt'"
    tried="$alt"
    out="$(server_add "$tried")" && rc=0 || rc=$?
    printf '%s\n' "$out" | grep -viE '^[[:space:]]*$' >&2 || true
  fi

  if [ "$rc" -ne 0 ]; then
    if name_taken "$out"; then
      ok "a request for '$tried' already exists on the backend; approve it in the dashboard"
      info "if that request predates this script version its command may be stale; run 'sealgate-stdiod server remove $tried' and re-run install to resubmit"
      return 0
    fi
    die "sealgate-stdiod server add failed for '$tried'" \
      "check 'sealgate-stdiod status' shows the daemon connected, then re-run: $PROG install"
  fi
  SERVER_NAME="$tried"
  ok "submitted '$SERVER_NAME' (npx $MCP_PKG) for approval"
  todo "approve '$SERVER_NAME' as an admin: ${SG_BACKEND%/}  ->  Servers page (pending requests), or Overview"
  info "a 'not verified' badge before the first successful spawn is expected and does not block approval"
}

# ---------------------------------------------------------------------------
# Result
# ---------------------------------------------------------------------------
print_result() {
  local mcp_url="${SG_BACKEND%/}/mcp"
  if [ "$JSON" -eq 1 ]; then
    printf '{"mcp_url":"%s","server":"%s","device_label":"%s","mcp_pkg":"%s"}\n' \
      "$(json_escape "$mcp_url")" "$(json_escape "$SERVER_NAME")" "$(json_escape "$DEVICE_LABEL")" \
      "$(json_escape "$MCP_PKG")"
    return 0
  fi
  local b=$C_BOLD g=$C_GREEN d=$C_DIM r=$C_RESET
  [ -t 1 ] || { b=; g=; d=; r=; }
  printf '%smcp_url:%s %s%s%s\n' "$b" "$r" "$g" "$mcp_url" "$r"
  printf '%sserver:%s  %s (gateway prefix: %s_*)\n' "$b" "$r" "$SERVER_NAME" "$SERVER_NAME"
  printf '%sdevice:%s  %s (display label)\n' "$b" "$r" "$DEVICE_LABEL"
  if [ -n "$SG_API_KEY" ]; then
    printf '\n%s# add to Claude Code (gateway auth uses your SealGate API key):%s\n' "$d" "$r"
    printf 'claude mcp add sealgate %s -t http -H "Authorization: Bearer %s" -s user\n' "$mcp_url" "$SG_API_KEY"
  else
    printf '\n%s# the AI client authenticates to the gateway with your SealGate API key or OAuth;%s\n' "$d" "$r"
    printf '%s# pass --sg-api-key to print a ready-to-run claude-mcp-add snippet.%s\n' "$d" "$r"
  fi
}

# ===========================================================================
# Subcommands
# ===========================================================================
cmd_install() {
  # The daemon is installed and authorized regardless of Beeper: it is useful on
  # its own, and Beeper can be down for reasons that have nothing to do with
  # this machine. Registering the Beeper SERVER is different - that is the step
  # that only makes sense once Beeper actually works, so it is gated below.
  ensure_deps
  ensure_beeper_desktop
  ensure_stdiod_auth
  ensure_stdiod_supervised

  # Both gates must hold before registering the server.
  #
  # BEEPER_READY: otherwise the name gets taken by a server whose child cannot
  # reach Beeper.
  #
  # STDIOD_CONNECTED: the backend refuses a server request until the device has
  # registered over the tunnel, and answers with a 409 - the same status it uses
  # for a name conflict. Submitting before then produces a 409 that this script
  # would read as "name taken", rename, and fail again, pointing the operator at
  # a conflict that does not exist.
  if [ "$DRY_RUN" -eq 1 ]; then
    submit_beeper_server
    prime_oauth_grant
  elif [ "$STDIOD_CONNECTED" -eq 0 ]; then
    warn "not registering the '$SERVER_NAME' server: the daemon has not registered its device yet"
    todo "check 'sealgate-stdiod status', then re-run: $PROG install"
  elif [ "$BEEPER_READY" -eq 0 ]; then
    warn "not registering the '$SERVER_NAME' server: Beeper is not reachable yet"
    todo "sign in to Beeper with MCP enabled, then re-run: $PROG install"
  else
    submit_beeper_server
    if [ "$NO_PREAUTH" -eq 1 ]; then
      info "skipping OAuth priming (--no-preauth); the grant prompt appears at the child's first spawn, or run: $PROG preauth"
    else
      prime_oauth_grant
    fi
  fi

  printf '\n%s%s== SealGate side wired ==%s\n' "$C_BOLD" "$C_GREEN" "$C_RESET" >&2
  log "remaining human steps are printed above as 'action:' lines (approve the server in the dashboard)."
  print_result
}

cmd_doctor() {
  step "Doctor"
  local allgood=1
  for c in npx sealgate-stdiod; do
    if command -v "$c" >/dev/null 2>&1; then ok "$c"; else warn "$c missing"; allgood=0; fi
  done
  if beeper_api_base >/dev/null 2>&1; then ok "Beeper Client API reachable"; else warn "Beeper Client API not reachable (start Beeper Desktop with MCP enabled, or a headless 'beeper' server)"; allgood=0; fi
  # Report what the backend says about the credential, not merely whether one is
  # on disk. `dead` is the case worth naming: only --relogin clears it, and it
  # otherwise shows up as an unrelated-looking failure further down.
  local cred; cred="$(stdiod_credential_state)"
  local fix="$PROG install --install-deps"
  case "$cred" in
    live)    ok "device authorized to SealGate";;
    dead)    warn "SealGate credential expired or revoked (backend returned 401)"
             todo "re-authorize this device: $PROG install --relogin"
             fix="$PROG install --relogin"; allgood=0;;
    unknown) warn "could not verify the SealGate credential (backend unreachable)"; allgood=0;;
    *)       warn "not authorized (run: $PROG install)"; allgood=0;;
  esac
  # `status` exit codes: 0 running, 3 installed-but-not-running, 4 not
  # installed (see cli/status.rs). It used to exit 0 unconditionally, so this
  # check passed for a daemon that had never started and reported it as
  # connected. Distinguish the two failures - they have different fixes.
  if ! command -v sealgate-stdiod >/dev/null 2>&1; then
    warn "cannot check the daemon: sealgate-stdiod is not installed"; allgood=0
  else
    # Capture with '&& st=0 || st=$?' so a non-zero status does not trip set -e
    # now that the command reports unhealthy states through its exit code.
    local st
    sealgate-stdiod status >/dev/null 2>&1 && st=0 || st=$?
    case "$st" in
      0) ok "stdiod daemon running";;
      3) warn "supervisor installed but the daemon is not running"
         todo "check why it exited: sealgate-stdiod logs --follow"; allgood=0;;
      4) warn "no supervisor unit installed (run: $PROG install)"; allgood=0;;
      *) warn "sealgate-stdiod status failed (exit $st)"; allgood=0;;
    esac
  fi
  # Only meaningful once the credential works: server_registered lists servers
  # over the same API, so with a dead credential it fails for auth reasons and
  # would read as "not approved yet" - sending the operator to the dashboard to
  # approve something that is already approved.
  if [ "$cred" = "live" ]; then
    if server_registered; then
      ok "server '$SERVER_NAME' approved on this device"; else warn "server '$SERVER_NAME' not approved yet (submit + approve in dashboard)"; fi
  else
    info "skipped the '$SERVER_NAME' server check: it needs a working credential"
  fi
  if [ "$allgood" -eq 1 ]; then ok "core checks passed"; else die "some checks failed (see above)" "$fix"; fi
}

# tags: list the releases a daemon binary can be pulled from, so --stdiod-tag
# does not have to be guessed. Marks which ones actually carry an asset for THIS
# machine - a release cut before the daemon assets existed has none, which is
# otherwise only discoverable by trying it and reading the failure.
#
# The rows are DATA and go to stdout, per this script's contract (see the output
# helpers above): the whole point of the command is to feed a tag to something
# else, so this has to work -
#
#   newest tag with a daemon for this machine:
#     install-beeper.sh tags | awk '$3 == "yes" { print $1; exit }'
#
# Only the heading, the column header, the jq warning and the closing hints are
# diagnostics; those stay on stderr so they never contaminate a pipe.
cmd_tags() {
  local pair asset
  pair="$(stdiod_release_asset)" \
    || die "no prebuilt sealgate-stdiod exists for $(uname -s)/$(uname -m)" \
           "build locally instead: $PROG install --install-deps --from-source"
  asset="${pair%% *}"
  step "Releases on $STDIOD_REPO carrying $asset"
  local json
  json="$(curl_quiet -m 20 "https://api.github.com/repos/$STDIOD_REPO/releases?per_page=100")" \
    || die "could not reach the GitHub API" "check connectivity, or browse https://github.com/$STDIOD_REPO/releases"
  # jq gives the asset list per release; without it the third column cannot be
  # determined, but tag + channel still answer "what can I pass to --stdiod-tag".
  # Warn BEFORE the header so the caveat precedes the table it applies to.
  local has_jq=1
  command -v jq >/dev/null 2>&1 || {
    has_jq=0
    warn "jq not installed: the DAEMON column reads 'unknown' (cannot inspect assets)"
  }
  # Three whitespace-separated columns, always: TAG CHANNEL DAEMON. Kept to one
  # word each (no "daemon: yes", which awk would split into two fields) so $3 is
  # directly testable. The header is a diagnostic, so it goes to stderr and a
  # pipe sees only rows; it carries no indent so it lines up with those rows,
  # which start at column 0 to keep the fields clean.
  printf '%-24s %-8s %s\n' "TAG" "CHANNEL" "DAEMON" >&2
  if [ "$has_jq" -eq 1 ]; then
    # Sort on the numbers pulled out of the tag, not the string: lexically
    # "v0.6.4-beta.9" beats "v0.6.4-beta.10", which would list a stale build as
    # the newest. [0,6,4,9] vs [0,6,4,10] compares correctly.
    printf '%s' "$json" | jq -r --arg a "$asset" '
      sort_by(.tag_name | [scan("[0-9]+") | tonumber]) | reverse | .[]
      | select(.draft | not)
      | [ .tag_name,
          (if .prerelease then "demo" else "stable" end),
          (if any(.assets[]?; .name == $a) then "yes" else "no" end)
        ] | @tsv' \
      | awk -F'\t' '{ printf "%-24s %-8s %s\n", $1, $2, $3 }'
  else
    printf '%s' "$json" \
      | grep -oE '"(tag_name|prerelease)": *("[^"]*"|true|false)' \
      | sed -E 's/.*: *"?([^"]*)"?$/\1/' \
      | paste - - \
      | awk -F'\t' '{ printf "%-24s %-8s %s\n", $1, ($2 == "true" ? "demo" : "stable"), "unknown" }'
  fi
  log ""
  info "install from one:   $PROG install --install-deps --stdiod-tag <tag>"
  info "newest stable:      $PROG install --install-deps            (or --release)"
  info "newest demo build:  $PROG install --install-deps --demo     (or --stdiod-prerelease)"
}

cmd_status() {
  need_cmd sealgate-stdiod
  run sealgate-stdiod status
  local base; base="$(beeper_api_base 2>/dev/null || true)"
  if [ -n "$base" ]; then ok "Beeper Client API: $base"; else warn "Beeper Client API not reachable (Beeper Desktop with MCP enabled, or a headless 'beeper' server)"; fi
}

# preauth: run the OAuth-grant priming on its own, e.g. after enabling MCP in
# Beeper later, after revoking the grant, or after --no-preauth.
cmd_preauth() {
  if [ "$DRY_RUN" -eq 0 ] && ! beeper_api_base >/dev/null 2>&1; then
    die "the Beeper Client API is not reachable on 23373-23378" \
      "start Beeper Desktop with MCP enabled (or a headless 'beeper' server), then re-run: $PROG preauth"
  fi
  prime_oauth_grant
}

cmd_mcp_url() { print_result; }

cmd_uninstall() {
  confirm "withdraw the '$SERVER_NAME' request/server and remove the stdiod supervisor unit?" || die "aborted" ""
  command -v sealgate-stdiod >/dev/null 2>&1 && {
    run sealgate-stdiod server remove "$SERVER_NAME" || true
    run sealgate-stdiod uninstall
  }
  log "uninstall complete. Approved-server removal may need a dashboard/admin action; Beeper Desktop was left untouched."
}

# ===========================================================================
# Help
# ===========================================================================
usage() {
  # UNQUOTED heredoc delimiter, deliberately: $PROG, $STDIOD_REPO and friends
  # have to interpolate. The cost is that backticks in here are COMMAND
  # SUBSTITUTION, not quoting - a `sealgate-stdiod login` in the prose runs and
  # is replaced by its (empty) output. Quote command names with 'single quotes'.
  cat >&2 <<EOF
$PROG - wire Beeper into the SealGate MCP gateway (macOS)

Beeper only serves MCP from the Desktop app, so this automates the SealGate side
and prints the exact human steps Beeper and the dashboard still require.

Usage:
  $PROG <command> [flags]

Commands:
  install     Deps, Beeper check, device auth, supervise daemon, submit Beeper server, prime OAuth
  doctor      Check prerequisites and current state (read-only)
  status      Show stdiod daemon + Beeper Client API status
  tags        List releases the sealgate-stdiod binary can be pulled from
  preauth     Prime the Beeper OAuth grant (approve once in Beeper)
  mcp-url     Print the SealGate MCP URL and client snippet
  uninstall   Withdraw the server and remove the supervisor unit

Common flags (also settable as UPPER_SNAKE env vars):
  --sg-backend URL     SealGate backend        (SG_BACKEND, default $SG_BACKEND)
  --demo               Shortcut for --sg-backend https://demo-dashboard.sealgate.ai (main deploy).
                       Also selects the DEMO daemon build (newest v*-beta.N).
  --release            Shortcut for --sg-backend https://dashboard.sealgate.ai (the default).
                       Also selects the STABLE daemon build.
                       With none of these set, commands follow the backend this device
                       is already authorized to (from stdiod config), and the daemon
                       channel follows that backend. Override the daemon side alone
                       with --stdiod-tag / --stdiod-release / --stdiod-prerelease.
  --sg-api-key KEY     SealGate API key for the client snippet only (SG_API_KEY)
  --server-name NAME   Tunnel server name, and the gateway tool prefix
                       (SERVER_NAME, default beeper). Change it to wire a second
                       Beeper account alongside the first.
  --device-label TEXT  Label for this script's own output only (DEVICE_LABEL,
                       default this host's short name). It does NOT name the
                       stdiod device record - 'sealgate-stdiod login' issues the
                       device identity server-side.
  --oauth-wait SECS    How long to wait for the Beeper OAuth approval (OAUTH_WAIT, default $OAUTH_WAIT)
  --beeper-wait SECS   After opening Beeper, how long to wait for its client API
                       before falling back to the manual steps (BEEPER_WAIT,
                       default $BEEPER_WAIT; 0 skips the wait)
  --no-preauth         Skip OAuth priming during install (prompt then fires at first spawn)
  --no-open            Headless device auth: print the approval URL, do not open a browser
  --relogin            Force a fresh device authorization even if already authorized
  --install-deps       Consent to auto-install missing deps: npx (brew),
                       sealgate-stdiod (prebuilt release download - no Rust
                       needed), and on macOS Beeper Desktop itself (brew cask).
                       Confirms first unless --yes.
  --stdiod-tag TAG     Pin the release the sealgate-stdiod binary comes from,
                       e.g. v0.6.6 (default: the newest published app release;
                       the daemon version follows the app version). Env:
                       STDIOD_TAG. STDIOD_REPO overrides the repo (default
                       $STDIOD_REPO).
  --stdiod-prerelease  Force the DEMO daemon channel: the newest
                       v<version>-beta.N prerelease, built from main.
                       Env: STDIOD_PRERELEASE=1.
  --stdiod-release     Force the STABLE daemon channel: the newest v<version>
                       release, built from the release branch.
                       Env: STDIOD_PRERELEASE=0.
                       Both: the channels are separate lineages, so each picks
                       from its own and never from the other, however recent
                       the other may be. Neither flag is usually needed - with
                       neither set the daemon channel FOLLOWS THE BACKEND, so
                       --demo gets the demo daemon and --release (the default)
                       gets the stable one. Reach for these only to cross the
                       streams deliberately. --stdiod-tag overrides both.
  --from-source        Build sealgate-stdiod with cargo instead of downloading
                       it. Adds real prerequisites - a Rust toolchain (installed
                       via rustup under --install-deps), a C toolchain for the
                       'ring' crate, and a checkout of this repo to run from -
                       so it is never entered automatically. Without it, a
                       failed download is an error, not a silent build.
  --dry-run            Print what would run; change nothing
  --yes                Skip confirmations (agents pass this)
  --interactive        Allow interactive prompts as a fallback
  --json               Machine-readable output where supported
  --no-color           Disable colored output (also honors NO_COLOR)
  --verbose            Debug logging on stderr
  -h, --help           This help

Examples:
  # Agent-friendly: install deps and wire the SealGate side, headless device auth
  $PROG install --install-deps --yes --no-open --demo

  # Preview without changing anything
  $PROG install --dry-run

  # Re-run the one-time Beeper OAuth approval (e.g. after enabling MCP later)
  $PROG preauth

Exit codes: 0 ok, 1 error (message + fix printed to stderr).
EOF
}

subcmd_help() {
  case "$1" in
    install)  log "install - wire the SealGate side and print remaining human steps. Idempotent; safe to re-run."
              log "  optional: --sg-backend, --no-open, --install-deps, --yes, --dry-run, --no-preauth, --oauth-wait,"
              log "            --stdiod-tag <tag>, --from-source (build the daemon instead of downloading it).";;
    preauth)  log "preauth - drive one MCP handshake through 'npx $MCP_PKG' so Beeper raises its"
              log "  approve/deny prompt and caches the OAuth grant. Idempotent; optional --oauth-wait.";;
    mcp-url)  log "mcp-url - print the gateway URL + client snippet. pass --sg-api-key for a ready-to-run snippet. supports --json.";;
    status)   log "status - show stdiod daemon + Beeper Client API status.";;
    doctor)   log "doctor - verify prerequisites and current state (read-only).";;
    uninstall)log "uninstall - withdraw the server and remove the supervisor unit. pass --yes to skip the prompt.";;
    tags)     log "tags - list releases a sealgate-stdiod binary can come from, and whether each carries"
              log "  one for this platform. Feed a tag to --stdiod-tag.";;
    *)        usage;;
  esac
}

# ===========================================================================
# Dispatch
# ===========================================================================
main() {
  local cmd="${1:-}"; shift || true
  ARGS=()
  parse_flags "$@" || { init_colors; subcmd_help "$cmd"; exit 0; }
  init_colors
  # A binary we installed to ~/.local/bin (or cargo put in ~/.cargo/bin) may
  # not be on the user's PATH yet; every subcommand should still find it.
  local d
  for d in "$HOME/.local/bin" "$HOME/.cargo/bin"; do
    if [ -x "$d/sealgate-stdiod" ]; then
      case ":$PATH:" in *":$d:"*) ;; *) PATH="$d:$PATH";; esac
    fi
  done
  # No subcommand takes positional args; reject stray ones so typos are loud.
  [ "${#ARGS[@]}" -gt 0 ] && die "unexpected argument: ${ARGS[0]}" "run '$PROG --help' for usage"
  # Default the backend to the device's authorized session unless set explicitly,
  # then match the daemon channel to whatever backend that settled on.
  resolve_backend
  resolve_stdiod_channel

  case "$cmd" in
    install)    cmd_install;;
    doctor)     cmd_doctor;;
    status)     cmd_status;;
    preauth)    cmd_preauth;;
    mcp-url)    cmd_mcp_url;;
    uninstall)  cmd_uninstall;;
    tags)       cmd_tags;;
    ""|help|-h|--help) usage;;
    *) die "unknown command: $cmd" "run '$PROG --help' for the command list";;
  esac
}

main "$@"
