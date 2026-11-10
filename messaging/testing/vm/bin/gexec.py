#!/usr/bin/env python3
"""gexec.py "<cmd line>"  |  gexec.py -ps "<powershell>"  - run a command inside a Windows VM through
qemu-guest-agent and print its output. Commands run as SYSTEM, not as the logged-in user.
Env: GEXEC_VM (default win11), LIBVIRT_DEFAULT_URI (default qemu:///system)."""
import json, os, subprocess, sys, time, base64
VM = os.environ.get("GEXEC_VM", "win11")
URI = os.environ.get("LIBVIRT_DEFAULT_URI", "qemu:///system")
def qga(obj):
    out = subprocess.run(["virsh", "-c", URI, "qemu-agent-command", VM, json.dumps(obj)], capture_output=True, text=True)
    if out.returncode: sys.exit(out.stderr.strip())
    return json.loads(out.stdout)["return"]
args = sys.argv[1:]
if args and args[0] == "-ps":   # run a PowerShell script block instead of cmd /c
    path, arg = "powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", " ".join(args[1:])]
else:
    path, arg = "cmd.exe", ["/c", " ".join(args)]
pid = qga({"execute": "guest-exec", "arguments": {"path": path, "arg": arg, "capture-output": True}})["pid"]
for _ in range(120):
    st = qga({"execute": "guest-exec-status", "arguments": {"pid": pid}})
    if st.get("exited"): break
    time.sleep(1)
sys.stdout.write(base64.b64decode(st.get("out-data", "")).decode("utf-8", "replace"))
sys.stderr.write(base64.b64decode(st.get("err-data", "")).decode("utf-8", "replace"))
sys.exit(st.get("exitcode", 1))
