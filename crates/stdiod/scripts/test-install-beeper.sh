#!/usr/bin/env bash
#
# CI checks for install-beeper.sh: the backend a run resolves, for the GitHub
# copy and for a copy a SealGate deployment serves with its own address filled
# in (GET <dashboard>/install.sh). Nothing here installs anything: --help and
# mcp-url only print, and the saved device session is a throwaway config file.
#
#   bash crates/stdiod/scripts/test-install-beeper.sh
set -uo pipefail

SCRIPT="${1:-$(cd "$(dirname "$0")" && pwd)/install-beeper.sh}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FAILURES=0

check() {
  local name="$1"; shift
  if "$@"; then echo "  ok   $name"; else echo "  FAIL $name"; FAILURES=$((FAILURES + 1)); fi
}

# The same substitution the backend route performs.
BAKED="$TMP/baked.sh"
sed -e 's#__SEALGATE_BACKEND__#https://beeper.example#' \
    -e 's#__SEALGATE_SCRIPT_URL__#https://beeper.example/install.sh#' "$SCRIPT" >"$BAKED"

# A device already signed in to another deployment.
SAVED="$TMP/config.toml"
printf 'backend_url = "https://saved.example"\n' >"$SAVED"

# Piped, as `curl ... | bash -s --` runs it: $0 is bash, not a file.
piped() { local file="$1"; shift; NO_COLOR=1 bash -s -- "$@" <"$file" 2>&1; }
mcp_url() { local file="$1"; shift; piped "$file" mcp-url --json "$@" | sed -n 's/.*"mcp_url":"\([^"]*\)".*/\1/p'; }

help_unfilled="$(piped "$SCRIPT" --help)"
help_baked="$(piped "$BAKED" --help)"

echo "== unfilled (the GitHub copy)"
check "defaults to the release backend" \
  grep -q 'SG_BACKEND, default https://dashboard.sealgate.ai)' <<<"$help_unfilled"
check "re-run hints name the GitHub URL" \
  grep -q 'curl -fsSL https://raw.githubusercontent.com/.*/install-beeper.sh | bash -s --' <<<"$help_unfilled"
check "the Windows one-liner is the GitHub one, typed into PowerShell" \
  grep -q '^  irm https://raw.githubusercontent.com/.*/install-beeper.ps1 | iex$' <<<"$help_unfilled"
check "nothing chose a backend, so the saved session is adopted" \
  test "$(SEALGATE_STDIOD_CONFIG="$SAVED" mcp_url "$SCRIPT")" = "https://saved.example/mcp"

echo "== filled in by a deployment"
check "defaults to that deployment" \
  grep -q 'SG_BACKEND, default https://beeper.example)' <<<"$help_baked"
check "re-run hints name that deployment's URL" \
  grep -q 'curl -fsSL https://beeper.example/install.sh | bash -s --' <<<"$help_baked"
check "the Windows one-liner names that deployment" \
  grep -q '^  irm https://beeper.example/install.ps1 | iex$' <<<"$help_baked"
check "it counts as a choice, so a saved session does not override it" \
  test "$(SEALGATE_STDIOD_CONFIG="$SAVED" mcp_url "$BAKED")" = "https://beeper.example/mcp"
check "SG_BACKEND still wins over it" \
  test "$(SG_BACKEND=https://env.example SEALGATE_STDIOD_CONFIG="$SAVED" mcp_url "$BAKED")" = "https://env.example/mcp"
check "--sg-backend still wins over it" \
  test "$(SEALGATE_STDIOD_CONFIG="$SAVED" mcp_url "$BAKED" --sg-backend https://flag.example)" = "https://flag.example/mcp"
check "no placeholder is left in the served copy" \
  bash -c '! grep -q "__SEALGATE_" "$1"' _ "$BAKED"

echo "== the mismatch message names what chose the backend"
fn="$(awk '/^backend_mismatch\(\) \{/,/^}/' "$SCRIPT")"
mismatch() {
  bash -c "die() { printf '%s | %s\n' \"\$1\" \"\$2\"; }; $fn
    SG_BACKEND=https://beeper.example SG_BACKEND_FROM='$1' PROG='prog'
    backend_mismatch https://saved.example"
}
check "a served copy is not blamed on --sg-backend" \
  bash -c '[[ "$1" == *"this installer is for https://beeper.example"* && "$1" != *"--sg-backend"* ]]' _ "$(mismatch baked)"
check "a flag is named as the flag" \
  grep -q 'drop --demo to keep https://saved.example' <<<"$(mismatch --demo)"

echo
if [ "$FAILURES" -gt 0 ]; then echo "$FAILURES check(s) failed"; exit 1; fi
echo "all checks passed"
