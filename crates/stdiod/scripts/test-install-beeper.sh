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

echo "== update (offline: a stub daemon in a throwaway HOME, the tag pinned)"
# The stub answers --version with $STUB_VERSION and reports "no supervisor unit"
# (status exit 4), so nothing restarts and nothing is downloaded: every check
# below stops at the version comparison or at --check / --dry-run.
FAKE_HOME="$TMP/home"
mkdir -p "$FAKE_HOME/.local/bin" "$FAKE_HOME/.config/sealgate-stdiod"
cat >"$FAKE_HOME/.local/bin/sealgate-stdiod" <<'EOF'
#!/bin/sh
case "$1" in
  --version) echo "sealgate-stdiod ${STUB_VERSION:-0.0.1}";;
  status)    exit 4;;
  *)         exit 0;;
esac
EOF
chmod +x "$FAKE_HOME/.local/bin/sealgate-stdiod"
upd() {
  HOME="$FAKE_HOME" XDG_CONFIG_HOME="$FAKE_HOME/.config" \
    SEALGATE_STDIOD_CONFIG="$FAKE_HOME/.config/sealgate-stdiod/config.toml" \
    NO_COLOR=1 bash "$SCRIPT" update --stdiod-tag v0.6.23 "$@"
}

out="$(STUB_VERSION=0.6.20 upd --check --json 2>/dev/null)"; rc=$?
check "--check exits 10 when outdated" test "$rc" -eq 10
check "--check --json reports the versions and that this script owns it" \
  grep -q '"installed":"0.6.20","latest":"0.6.23","channel":"stable","owner":"oneliner","update_available":true' <<<"$out"
out="$(STUB_VERSION=0.6.23 upd --check --json 2>/dev/null)"; rc=$?
check "--check exits 0 when current" test "$rc" -eq 0
check "--check --json says no update when current" grep -q '"update_available":false' <<<"$out"
out="$(STUB_VERSION=0.0.1 upd --check 2>&1)"; rc=$?
check "a pre-stamp build (0.0.1) counts as outdated" test "$rc" -eq 10
check "the outdated hint names the update command" grep -q 'action: run: .* update' <<<"$out"
out="$(STUB_VERSION=0.6.24 upd --check --json 2>&1)"; rc=$?
check "a daemon ahead of the release is current: never a downgrade" test "$rc" -eq 0
check "and --json says no update" grep -q '"update_available":false' <<<"$out"
out="$(STUB_VERSION=0.6.24 upd --dry-run 2>&1)"; rc=$?
check "update leaves a newer daemon alone" grep -q 'newer than the newest stable release (0.6.23); left as is' <<<"$out"
out="$(STUB_VERSION=0.6.23-beta.4 upd --check 2>&1)"; rc=$?
check "a beta of the same version is older than the release" test "$rc" -eq 10
out="$(STUB_VERSION=0.6.20 upd --dry-run 2>&1)"; rc=$?
check "--dry-run previews the update" grep -q 'would download v0.6.23' <<<"$out"
check "--dry-run leaves the binary alone" \
  test "$(STUB_VERSION=0.6.20 "$FAKE_HOME/.local/bin/sealgate-stdiod" --version)" = "sealgate-stdiod 0.6.20"

# Units in both shapes (launchd plist, systemd unit), so a check holds on
# whichever OS runs it.
mkdir -p "$FAKE_HOME/Library/LaunchAgents" "$FAKE_HOME/.config/systemd/user"
write_units() {
  printf '<plist version="1.0">\n<dict>\n  <key>ProgramArguments</key>\n  <array>\n    <string>%s</string>\n    <string>run</string>\n  </array>\n</dict>\n</plist>\n' \
    "$1" >"$FAKE_HOME/Library/LaunchAgents/com.sealgate.stdiod.plist"
  printf '[Service]\nExecStart="%s" run\n' "$1" >"$FAKE_HOME/.config/systemd/user/sealgate-stdiod.service"
}

# The unit runs this script's copy, but another, newer copy comes first on
# PATH (~/.local/bin is already on PATH, so the script does not move it to the
# front): the version must come from the copy the unit runs.
mkdir -p "$TMP/decoy"
printf '#!/bin/sh\necho "sealgate-stdiod 9.9.9"\n' >"$TMP/decoy/sealgate-stdiod"
chmod +x "$TMP/decoy/sealgate-stdiod"
write_units "$FAKE_HOME/.local/bin/sealgate-stdiod"
out="$(PATH="$TMP/decoy:$FAKE_HOME/.local/bin:$PATH" STUB_VERSION=0.6.20 upd --check --json 2>/dev/null)"; rc=$?
check "the version comes from the copy the unit runs, not the first on PATH" grep -q '"installed":"0.6.20"' <<<"$out"
check "so that daemon is still reported outdated (exit 10)" test "$rc" -eq 10

# A supervisor unit that runs the desktop app's copy.
cat >"$FAKE_HOME/Library/LaunchAgents/com.sealgate.stdiod.plist" <<'EOF'
<plist version="1.0">
<dict>
  <key>ProgramArguments</key>
  <array>
    <string>/Applications/SealGate.app/Contents/Resources/bin/sealgate-stdiod</string>
    <string>run</string>
  </array>
</dict>
</plist>
EOF
printf '[Service]\nExecStart="%s/.local/share/sealgate/bin/sealgate-stdiod" run\n' "$FAKE_HOME" \
  >"$FAKE_HOME/.config/systemd/user/sealgate-stdiod.service"
out="$(STUB_VERSION=0.6.20 upd --check --json 2>&1)"; rc=$?
check "a daemon the desktop app supervises is reported as the app's" grep -q '"owner":"desktop"' <<<"$out"
check "its hint is to update the desktop app" grep -q 'action: update the SealGate desktop app' <<<"$out"
out="$(STUB_VERSION=0.6.20 upd 2>&1)"; rc=$?
check "update refuses to replace the desktop app's daemon" test "$rc" -eq 1
check "and says why" grep -q 'not installed by this script (desktop)' <<<"$out"

echo
if [ "$FAILURES" -gt 0 ]; then echo "$FAILURES check(s) failed"; exit 1; fi
echo "all checks passed"
