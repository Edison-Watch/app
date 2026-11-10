#!/usr/bin/env bash
# Build the cloud-init seed ISO for the Linux test VM.
#
#   VM_PASSWORD='...' bash make-seed.sh <out-dir> [hostname] [user]
#
# Writes <out-dir>/user-data, meta-data and seed.iso, and creates the SSH key
# <out-dir>/../ssh/<hostname>_ed25519 if it does not exist. Needs genisoimage
# (or xorriso), openssl and ssh-keygen.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT=${1:?usage: make-seed.sh <out-dir> [hostname] [user]}
HOST=${2:-deb-proto}
USER_NAME=${3:-ilia}
: "${VM_PASSWORD:?set VM_PASSWORD to the desktop login password}"
mkdir -p "$OUT" "$OUT/../ssh"
KEY="$OUT/../ssh/${HOST}_ed25519"
[ -f "$KEY" ] || ssh-keygen -q -t ed25519 -N '' -C "$HOST@host" -f "$KEY"
HASH=$(openssl passwd -6 "$VM_PASSWORD")
PUB=$(cat "$KEY.pub")
INSTANCE=$(date +%s)
# The hash contains $ and / characters, so substitute with Python, not sed.
python3 - "$HERE" "$OUT" "$HOST" "$USER_NAME" "$HASH" "$PUB" "$INSTANCE" <<'PY'
import sys
here, out, host, user, h, pub, inst = sys.argv[1:]
for name in ("user-data", "meta-data"):
    s = open(f"{here}/{name}.tpl").read()
    for k, v in {"@HOSTNAME@": host, "@USER@": user, "@PASSWORD_HASH@": h, "@SSH_PUBKEY@": pub, "@INSTANCE@": inst}.items():
        s = s.replace(k, v)
    open(f"{out}/{name}", "w").write(s)
PY
chmod 600 "$OUT/user-data"
if command -v genisoimage >/dev/null; then
  genisoimage -quiet -output "$OUT/seed.iso" -volid cidata -joliet -rock "$OUT/user-data" "$OUT/meta-data"
else
  xorriso -as mkisofs -quiet -output "$OUT/seed.iso" -volid cidata -joliet -rock "$OUT/user-data" "$OUT/meta-data"
fi
echo "seed: $OUT/seed.iso  ssh key: $KEY"
