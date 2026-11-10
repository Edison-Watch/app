#!/usr/bin/env python3
"""vmctl - drive a libvirt VM over VNC (screenshots, mouse, keyboard).

Needs vncdotool and Pillow (pip install vncdotool Pillow).

Usage:
  vmctl screenshot <out.png>
  vmctl click <x> <y>          vmctl rightclick <x> <y>     vmctl doubleclick <x> <y>
  vmctl move <x> <y>           vmctl drag <x1> <y1> <x2> <y2>
  vmctl type "<text>"          vmctl key <name>   (enter, tab, esc, super, ctrl-alt-del, alt-f4, ctrl-c, f5, win-r ...)
  vmctl ip                     (guest NAT IP from libvirt DHCP leases)
  vmctl virsh-screenshot <out.png>   (fallback path via virsh screenshot)

Env: VMCTL_VM (required: the libvirt domain name), VMCTL_HOST (default 127.0.0.1),
     VMCTL_PASSWORD_FILE (default $VM_DIR/<domain>-vnc-password.txt),
     VM_DIR (default ~/vms), LIBVIRT_DEFAULT_URI (default qemu:///system)
"""
import os, sys, subprocess, time, re, tempfile

VM = os.environ.get("VMCTL_VM") or sys.exit("set VMCTL_VM to the libvirt domain name")
HOST = os.environ.get("VMCTL_HOST", "127.0.0.1")
VM_DIR = os.environ.get("VM_DIR", os.path.expanduser("~/vms"))
PWFILE = os.environ.get("VMCTL_PASSWORD_FILE", os.path.join(VM_DIR, f"{VM}-vnc-password.txt"))
URI = os.environ.get("LIBVIRT_DEFAULT_URI", "qemu:///system")

def virsh(*args, check=True):
    return subprocess.run(["virsh", "-c", URI, *args], capture_output=True, text=True, check=check).stdout

def vnc_port():
    disp = virsh("vncdisplay", VM).strip()          # e.g. 127.0.0.1:0 or :0
    n = int(disp.rsplit(":", 1)[1])
    return 5900 + n

def password():
    with open(PWFILE) as f:
        return f.read().strip()

def connect():
    from vncdotool import api
    client = api.connect(f"{HOST}::{vnc_port()}", password=password(), timeout=15)
    client.refreshScreen()
    return client

KEYMAP = {  # friendly -> vncdotool key names
    "enter": "enter", "return": "enter", "tab": "tab", "esc": "esc", "escape": "esc",
    "space": "space", "backspace": "bsp", "bsp": "bsp", "delete": "delete", "del": "delete",
    "super": "super", "win": "super", "meta": "super", "up": "up", "down": "down", "left": "left", "right": "right",
    "home": "home", "end": "end", "pgup": "pgup", "pgdn": "pgdn", "insert": "insert",
    "ctrl": "ctrl", "control": "ctrl", "alt": "alt", "shift": "shift",
    "ctrl-alt-del": "ctrl-alt-del", "ctrl-alt-delete": "ctrl-alt-del",
}

# US-layout characters that need Shift, mapped to their unshifted key
SHIFTED = {"~": "`", "!": "1", "@": "2", "#": "3", "$": "4", "%": "5", "^": "6", "&": "7", "*": "8", "(": "9", ")": "0",
           "_": "-", "+": "=", "{": "[", "}": "]", "|": "\\", ":": ";", "\"": "'", "<": ",", ">": ".", "?": "/"}

def norm_key(name):
    name = name.lower()
    if name in KEYMAP:
        return KEYMAP[name]
    parts = name.split("-") if name != "-" else ["-"]
    if len(parts) > 1:
        return "-".join(KEYMAP.get(p, p) for p in parts)
    if re.fullmatch(r"f[0-9]{1,2}", name):
        return name
    return name

def main(argv):
    if len(argv) < 2 or argv[1] in ("-h", "--help", "help"):
        print(__doc__); return 0
    cmd, args = argv[1], argv[2:]
    if cmd == "ip":
        out = virsh("domifaddr", VM, "--source", "lease", check=False) or virsh("net-dhcp-leases", "default", check=False)
        m = re.findall(r"(\d+\.\d+\.\d+\.\d+)/\d+", out)
        print("\n".join(m) if m else out.strip() or "no lease yet"); return 0
    if cmd == "virsh-screenshot":
        from PIL import Image
        tmp = tempfile.mktemp(suffix=".ppm")
        virsh("screenshot", VM, tmp)
        Image.open(tmp).save(args[0]); os.unlink(tmp); print(args[0]); return 0
    if cmd == "port":
        print(vnc_port()); return 0

    c = connect()
    try:
        if cmd == "screenshot":
            c.captureScreen(args[0]); print(args[0])
        elif cmd == "move":
            c.mouseMove(int(args[0]), int(args[1]))
        elif cmd in ("click", "rightclick", "doubleclick", "middleclick"):
            x, y = int(args[0]), int(args[1])
            btn = {"click": 1, "doubleclick": 1, "middleclick": 2, "rightclick": 3}[cmd]
            c.mouseMove(x, y); c.pause(0.15)
            c.mousePress(btn)
            if cmd == "doubleclick":
                c.pause(0.08); c.mousePress(btn)
        elif cmd == "drag":
            x1, y1, x2, y2 = map(int, args[:4])
            c.mouseMove(x1, y1); c.pause(0.1); c.mouseDown(1); c.pause(0.1)
            steps = 20
            for i in range(1, steps + 1):
                c.mouseMove(x1 + (x2 - x1) * i // steps, y1 + (y2 - y1) * i // steps); c.pause(0.02)
            c.pause(0.1); c.mouseUp(1)
        elif cmd == "type":
            text = " ".join(args)
            for ch in text:
                if ch == "\n":
                    c.keyPress("enter")
                elif ch == " ":
                    c.keyPress("space")
                elif ch in SHIFTED or ch.isupper():
                    # QEMU maps keysyms to scancodes without inferring Shift; hold it explicitly
                    c.keyDown("shift"); c.pause(0.01)
                    c.keyPress(SHIFTED.get(ch, ch)); c.pause(0.01)
                    c.keyUp("shift")
                else:
                    c.keyPress(ch)
                c.pause(0.03)
        elif cmd == "key":
            for k in args:
                c.keyPress(norm_key(k)); c.pause(0.1)
        else:
            print(f"unknown command {cmd}", file=sys.stderr); print(__doc__); return 2
        c.pause(0.2)
    finally:
        c.disconnect()
        from vncdotool import api
        api.shutdown()
    return 0

if __name__ == "__main__":
    sys.exit(main(sys.argv))
