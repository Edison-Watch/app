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
#   1. Install prerequisites (node/npx, `sealgate-stdiod`).
#   2. Authorize this device to SealGate via the stdiod browser/device flow
#      (`sealgate-stdiod login`; no API key paste, no step-up dance).
#   3. Supervise the tunnel daemon (`sealgate-stdiod install`).
#   4. Submit Beeper's stdio MCP proxy (`npx @beeper/mcp-remote`) as a tunnel
#      server (`sealgate-stdiod server add`, which requests admin approval).
#   5. Prime the Beeper OAuth grant by driving one MCP handshake through the
#      proxy, so the approval prompt fires now instead of at first daemon spawn.
#
# What still needs a human (each one printed with the exact action):
#   A. Enable MCP in Beeper Desktop (Settings > Developers > MCP) so :23373
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
SG_BACKEND="${SG_BACKEND:-https://dashboard.sealgate.ai}"  # --sg-backend/--demo/--release also set SG_BACKEND_SET
SG_API_KEY="${SG_API_KEY:-}"                       # only for the mcp-url client snippet
SERVER_NAME="${SERVER_NAME:-beeper}"               # tunnel server name / gateway prefix
# Display label for this script's own output only. It does NOT set the stdiod
# device record: `sealgate-stdiod login` issues the device identity server-side.
DEVICE_LABEL="${DEVICE_LABEL:-$(hostname -s 2>/dev/null || echo my-mac)}"
MCP_PKG="${MCP_PKG:-@beeper/mcp-remote}"           # the stdio->HTTP OAuth proxy npx package
OAUTH_WAIT="${OAUTH_WAIT:-120}"                    # seconds to wait for the Beeper OAuth approval

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

PROG="$(basename "$0")"

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
      --no-open)      NO_OPEN=1; shift;;
      --relogin)      RELOGIN=1; shift;;
      --no-preauth)   NO_PREAUTH=1; shift;;
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

ensure_deps() {
  step "Checking prerequisites"
  require_supported_platform
  local stdiod_src; stdiod_src="$(dirname "$0")/../crates/sealgate-stdiod"
  ensure_tool npx \
    "install Node (brew install node) or re-run with --install-deps" \
    brew install --quiet node
  # No Deno: @beeper/mcp-remote only proxies to Beeper's built-in MCP server.
  # The Deno sandbox was a @beeper/desktop-mcp `execute` tool requirement.
  ensure_tool sealgate-stdiod \
    "run: cargo install --path crates/sealgate-stdiod   (or re-run with --install-deps)" \
    cargo install --path "$stdiod_src"
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

# Non-fatal: if Beeper Desktop is not answering we still wire the automatable
# SealGate side and print the exact action, so `install` makes progress instead of
# stopping the operator at the first prerequisite.
ensure_beeper_desktop() {
  step "Beeper Desktop MCP endpoint"
  if [ "$DRY_RUN" -eq 1 ]; then
    info "would probe 127.0.0.1:23373-23378 for the Beeper Desktop API"
    return 0
  fi
  local base
  if base="$(beeper_api_base)"; then
    ok "Beeper Desktop API reachable at $base"
    return 0
  fi
  warn "the Beeper Client API is not answering on 23373-23378"
  todo "start Beeper: the Desktop app, or a headless server via 'beeper setup --server --install'"
  todo "link the chats you want (WhatsApp / Telegram / ...) in Beeper"
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
  local dir init pid waited=0
  dir="$(mktemp -d "${TMPDIR:-/tmp}/install-beeper.XXXXXX")"
  init='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"install-beeper","version":"1.0.0"}}}'
  # The sleep holds the proxy's stdin open while OAuth completes; after we kill
  # npx, that same EOF (or the sleep expiring) winds down any child it spawned.
  { printf '%s\n' "$init"; sleep "$OAUTH_WAIT"; } | npx -y "$MCP_PKG" >"$dir/out" 2>"$dir/err" &
  pid=$!
  info "if Beeper raises an approval prompt, approve it (waiting up to ${OAUTH_WAIT}s)"
  while [ "$waited" -lt "$OAUTH_WAIT" ]; do
    grep -q '"result"' "$dir/out" 2>/dev/null && break
    kill -0 "$pid" 2>/dev/null || break
    sleep 1; waited=$((waited + 1))
  done
  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
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
stdiod_logged_in() {
  local f; f="$(stdiod_config)"
  [ -f "$f" ] && grep -q 'client_access_token' "$f" 2>/dev/null
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

ensure_stdiod_auth() {
  step "SealGate device authorization (browser)"
  if [ "$DRY_RUN" -eq 1 ]; then
    run sealgate-stdiod login --backend "$SG_BACKEND"
    return 0
  fi
  if [ "$RELOGIN" -eq 0 ] && stdiod_logged_in; then
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
    ok "already authorized on this device (client credential in $(stdiod_config))"
    return 0
  fi
  # `sealgate-stdiod login` runs the OAuth device flow: it prints a URL to approve
  # (and opens a browser unless --no-open), then stores a scoped client
  # credential. No API key, no step-up token.
  local args=(login --backend "$SG_BACKEND")
  [ "$NO_OPEN" -eq 1 ] && args+=(--no-open)
  info "a browser opens to approve this device; on a headless box pass --no-open and open the printed URL elsewhere"
  if ! run sealgate-stdiod "${args[@]}"; then
    die "sealgate-stdiod login failed" "check --sg-backend (${SG_BACKEND}) and complete the browser approval, then re-run: $PROG install"
  fi
  ok "device authorized to ${SG_BACKEND}"
}

ensure_stdiod_supervised() {
  step "SealGate tunnel daemon (supervisor)"
  if ! run sealgate-stdiod install; then
    die "sealgate-stdiod install could not register the supervisor unit" \
      "macOS needs no privileges; Linux needs a logged-in systemd --user session. Fix that, then re-run: $PROG install"
  fi
  ok "daemon installed and supervised"
}

# ---------------------------------------------------------------------------
# Step 4: submit the Beeper stdio server for approval
# ---------------------------------------------------------------------------
# Under device authorization, `server add` submits a request scoped to this
# exact device (POST /api/v1/client/mcp-requests). An org admin approves it once
# in the dashboard; it does not run until then. `server_registered` lists only
# approved servers bound to this device, so we use it as the idempotency check.
submit_beeper_server() {
  step "Submitting the Beeper server"
  if [ "$DRY_RUN" -eq 1 ]; then
    run sealgate-stdiod server add "$SERVER_NAME" --display-name "Beeper" \
      --command npx --arg=-y --arg="$MCP_PKG"
    return 0
  fi
  if server_registered; then
    ok "server '$SERVER_NAME' is already approved and bound to this device"
    return 0
  fi
  # Capture with '&& rc=0 || rc=$?' so a non-zero add does not trip set -e.
  # Use --arg=VALUE: clap rejects a hyphen-leading value in the space form.
  local out rc
  out="$(sealgate-stdiod server add "$SERVER_NAME" --display-name "Beeper" \
        --command npx --arg=-y --arg="$MCP_PKG" 2>&1)" && rc=0 || rc=$?
  printf '%s\n' "$out" | grep -viE '^[[:space:]]*$' >&2 || true
  if [ "$rc" -ne 0 ]; then
    if printf '%s' "$out" | grep -qiE 'already (exists|submitted|pending)|duplicate'; then
      ok "a request for '$SERVER_NAME' is already pending; approve it in the dashboard"
      return 0
    fi
    die "sealgate-stdiod server add failed for '$SERVER_NAME'" \
      "check 'sealgate-stdiod status' shows the daemon connected, then re-run: $PROG install"
  fi
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
  ensure_deps
  ensure_beeper_desktop
  ensure_stdiod_auth
  ensure_stdiod_supervised
  submit_beeper_server
  if [ "$NO_PREAUTH" -eq 1 ]; then
    info "skipping OAuth priming (--no-preauth); the grant prompt appears at the child's first spawn, or run: $PROG preauth"
  else
    prime_oauth_grant
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
  if stdiod_logged_in; then ok "device authorized to SealGate"; else warn "not authorized (run: $PROG install)"; allgood=0; fi
  if command -v sealgate-stdiod >/dev/null 2>&1 && sealgate-stdiod status >/dev/null 2>&1; then
    ok "stdiod daemon connected"; else warn "stdiod daemon not running (run: $PROG install)"; allgood=0; fi
  if server_registered; then
    ok "server '$SERVER_NAME' approved on this device"; else warn "server '$SERVER_NAME' not approved yet (submit + approve in dashboard)"; fi
  if [ "$allgood" -eq 1 ]; then ok "core checks passed"; else die "some checks failed (see above)" "$PROG install --install-deps"; fi
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
  preauth     Prime the Beeper OAuth grant (approve once in Beeper)
  mcp-url     Print the SealGate MCP URL and client snippet
  uninstall   Withdraw the server and remove the supervisor unit

Common flags (also settable as UPPER_SNAKE env vars):
  --sg-backend URL     SealGate backend        (SG_BACKEND, default $SG_BACKEND)
  --demo               Shortcut for --sg-backend https://demo-dashboard.sealgate.ai (main deploy)
  --release            Shortcut for --sg-backend https://dashboard.sealgate.ai
                       With none of these set, commands follow the backend this device
                       is already authorized to (from stdiod config).
  --sg-api-key KEY     SealGate API key for the client snippet only (SG_API_KEY)
  --oauth-wait SECS    How long to wait for the Beeper OAuth approval (OAUTH_WAIT, default $OAUTH_WAIT)
  --no-preauth         Skip OAuth priming during install (prompt then fires at first spawn)
  --no-open            Headless device auth: print the approval URL, do not open a browser
  --relogin            Force a fresh device authorization even if already authorized
  --install-deps       Consent to auto-install missing deps (npx/sealgate-stdiod).
                       Confirms first unless --yes; validates each landed on PATH.
  --dry-run            Print what would run; change nothing
  --yes                Skip confirmations (agents pass this)
  --interactive        Allow interactive prompts as a fallback
  --json               Machine-readable output where supported
  --no-color           Disable colored output (also honors NO_COLOR)
  --verbose            Debug logging on stderr
  -h, --help           This help

Examples:
  # Agent-friendly: install deps and wire the SealGate side, headless device auth
  $PROG install --install-deps --yes --no-open --sg-backend https://demo-dashboard.sealgate.ai

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
              log "  optional: --sg-backend, --no-open, --install-deps, --yes, --dry-run, --no-preauth, --oauth-wait.";;
    preauth)  log "preauth - drive one MCP handshake through 'npx $MCP_PKG' so Beeper raises its"
              log "  approve/deny prompt and caches the OAuth grant. Idempotent; optional --oauth-wait.";;
    mcp-url)  log "mcp-url - print the gateway URL + client snippet. pass --sg-api-key for a ready-to-run snippet. supports --json.";;
    status)   log "status - show stdiod daemon + Beeper Client API status.";;
    doctor)   log "doctor - verify prerequisites and current state (read-only).";;
    uninstall)log "uninstall - withdraw the server and remove the supervisor unit. pass --yes to skip the prompt.";;
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
  # No subcommand takes positional args; reject stray ones so typos are loud.
  [ "${#ARGS[@]}" -gt 0 ] && die "unexpected argument: ${ARGS[0]}" "run '$PROG --help' for usage"
  # Default the backend to the device's authorized session unless set explicitly.
  resolve_backend

  case "$cmd" in
    install)    cmd_install;;
    doctor)     cmd_doctor;;
    status)     cmd_status;;
    preauth)    cmd_preauth;;
    mcp-url)    cmd_mcp_url;;
    uninstall)  cmd_uninstall;;
    ""|help|-h|--help) usage;;
    *) die "unknown command: $cmd" "run '$PROG --help' for the command list";;
  esac
}

main "$@"
