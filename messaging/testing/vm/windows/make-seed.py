#!/usr/bin/env python3
"""Build the Windows unattended-install ISO.

    VM_PASSWORD='...' python3 make-seed.py <virtio-win.iso> <out.iso> [computername] [user]

The ISO holds autounattend.xml (filled in from autounattend.xml.tpl) and a
$WinpeDriver$ folder with the Windows 11 x64 virtio drivers, copied from the
virtio-win ISO. Windows Setup scans $WinpeDriver$ on every drive, so the
virtio disk is visible without any driver-loading step in the answer file.

Only the drivers listed in DRIVERS are copied. Two things broke earlier
attempts and are avoided on purpose:
  - smbus, qemufwcfg, viofs, viomem, viogpudo and pvpanic stop modern Setup
    with error 0xD000A000, so they are left out.
  - Do not add drvload commands to the answer file. They bind viostor before
    Setup does, and Setup then fails with 0x80070103-0x40031.

Needs pycdlib (pip install pycdlib).
"""
import io
import os
import sys

import pycdlib

DRIVERS = ["Balloon", "NetKVM", "vioinput", "viorng", "vioscsi", "vioserial", "viostor"]


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    virtio, out = sys.argv[1], sys.argv[2]
    computer = sys.argv[3] if len(sys.argv) > 3 else "WIN11-DEV"
    user = sys.argv[4] if len(sys.argv) > 4 else "ilia"
    password = os.environ.get("VM_PASSWORD")
    if not password:
        sys.exit("set VM_PASSWORD to the Windows login password")
    if len(computer) > 15:
        sys.exit("the computer name must be 15 characters or fewer")

    tpl = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "autounattend.xml.tpl")).read()
    xml = tpl.replace("@PASSWORD@", password).replace("@COMPUTERNAME@", computer).replace("@USER@", user)

    src = pycdlib.PyCdlib()
    src.open(virtio)
    dst = pycdlib.PyCdlib()
    dst.new(joliet=3, rock_ridge="1.09", vol_ident="AUTOUNATTEND")
    data = xml.encode()
    dst.add_fp(io.BytesIO(data), len(data), "/AUTOUNAT.XML;1", joliet_path="/autounattend.xml", rr_name="autounattend.xml")
    dst.add_directory("/WINPEDRV", joliet_path="/$WinpeDriver$", rr_name="$WinpeDriver$")
    n = 0
    for drv in DRIVERS:
        base = f"/{drv}/w11/amd64"
        iso_dir = f"/WINPEDRV/{drv.upper()[:8]}"
        dst.add_directory(iso_dir, joliet_path=f"/$WinpeDriver$/{drv}", rr_name=drv)
        # virtio-win ISOs carry Rock Ridge names (no Joliet).
        for child in src.list_children(rr_path=base):
            if not child.is_file() or child.rock_ridge is None:
                continue
            name = child.rock_ridge.name().decode()
            if name.endswith(".pdb"):
                continue  # debug symbols, not needed by Setup
            buf = io.BytesIO()
            src.get_file_from_iso_fp(buf, rr_path=f"{base}/{name}")
            iso_name = f"F{n:06d}.;1"
            n += 1
            dst.add_fp(io.BytesIO(buf.getvalue()), len(buf.getvalue()), f"{iso_dir}/{iso_name}",
                       joliet_path=f"/$WinpeDriver$/{drv}/{name}", rr_name=name)
    dst.write(out)
    print(f"wrote {out} with {n} driver files")
    return 0


if __name__ == "__main__":
    sys.exit(main())
