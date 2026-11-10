# Test VMs for the messaging prototype

This guide builds two virtual machines (VMs) on a Linux host and prepares them
to test the messaging feature of the desktop app:

- a Debian 13 desktop VM, for the Linux build,
- a Windows 11 VM, for the Windows build.

Both VMs install without manual steps. You control them from the host shell:
screenshots, mouse, keyboard and commands. That control is what lets an agent
or a script drive the desktop app end to end.

The commands assume a Debian or Ubuntu host. Other distributions need the same
packages under their own names.

## Contents of this folder

| Path | What it is |
| --- | --- |
| `bin/vmctl.py` | Drives a VM over VNC: screenshot, click, type, key, drag. |
| `bin/gexec.py` | Runs a command inside the Windows VM through the QEMU guest agent. |
| `bin/vmssh` | Opens SSH to the Linux VM. It finds the IP from the libvirt DHCP lease. |
| `debian/` | cloud-init templates and `make-seed.sh`, which builds the first-boot seed ISO. |
| `windows/` | The answer-file template and `make-seed.py`, which builds the unattended-install ISO. |

## 1. Prepare the host

The host needs a CPU with hardware virtualization and the KVM kernel module.
Make sure that `/dev/kvm` exists:

```sh
ls -l /dev/kvm
```

Install the packages. This step needs root:

```sh
sudo apt-get install -y qemu-system-x86 qemu-utils libvirt-daemon-system virtinst \
  ovmf swtpm swtpm-tools genisoimage openssl python3-venv curl
```

Add your user to the `libvirt` and `kvm` groups, then log out and back in:

```sh
sudo usermod -aG libvirt,kvm "$USER"
```

Make sure that libvirt works without root and that the `default` NAT network is active:

```sh
virsh -c qemu:///system net-list --all
virsh -c qemu:///system net-start default      # only if it is inactive
virsh -c qemu:///system net-autostart default
```

The host is `192.168.122.1` on the `default` network. The VMs use that address
to reach services on the host, such as the SealGate backend.

Choose a folder for the VMs on a disk with free space. The two VMs need about
40 GB at first and can grow to 130 GB. Set it once per shell:

```sh
export VM_DIR=/srv/vms           # any folder you own
export KIT="$PWD"                # this folder: messaging/testing/vm
mkdir -p "$VM_DIR"
```

libvirt runs QEMU as its own user. That user must be able to read the files in
`$VM_DIR`. A folder under your home directory can fail for that reason. If
virt-install reports "Permission denied", use a folder outside your home, or
run `chmod o+x` on each parent directory.

Create a Python environment for the control tools:

```sh
python3 -m venv "$VM_DIR/venv"
"$VM_DIR/venv/bin/pip" install vncdotool Pillow pycdlib websockify
export PATH="$VM_DIR/venv/bin:$KIT/bin:$PATH"
```

## 2. Build the Linux VM

This VM runs Debian 13 with the Xfce desktop. It logs in automatically and
never blanks the screen. Its first boot installs the desktop, Chromium, the
QEMU guest agent and SSH, then reboots.

1. Download the official cloud image and check it:

   ```sh
   cd "$VM_DIR"
   B=https://cloud.debian.org/images/cloud/trixie/latest
   curl -fLO "$B/debian-13-generic-amd64.qcow2"
   curl -fLO "$B/SHA512SUMS"
   grep ' debian-13-generic-amd64.qcow2$' SHA512SUMS | sha512sum -c -
   ```

   Use the `generic` image, not `genericcloud`. The `genericcloud` kernel has no graphics drivers.

2. Make a 30 GB disk from the image:

   ```sh
   qemu-img convert -O qcow2 debian-13-generic-amd64.qcow2 deb-proto.qcow2
   qemu-img resize deb-proto.qcow2 30G
   ```

3. Reserve a fixed IP address for the VM. Pick an address outside the default DHCP range:

   ```sh
   virsh -c qemu:///system net-update default add ip-dhcp-host \
     "<host mac='52:54:00:de:b0:01' name='deb-proto' ip='192.168.122.50'/>" --live --config
   ```

4. Build the seed ISO. It holds the user, the password hash and a new SSH key:

   ```sh
   VM_PASSWORD='choose-a-password' bash "$KIT/debian/make-seed.sh" "$VM_DIR/seed-deb" deb-proto ilia
   ```

   The script writes the SSH key to `$VM_DIR/ssh/deb-proto_ed25519`.

5. Choose a VNC password of 8 characters or fewer. VNC ignores longer passwords. Store it:

   ```sh
   umask 077; echo 'Vnc12345' > "$VM_DIR/deb-proto-vnc-password.txt"
   ```

6. Create and start the VM:

   ```sh
   virt-install --connect qemu:///system --name deb-proto \
     --memory 3072 --vcpus 2 --cpu host-passthrough --machine q35 --osinfo debian13 --import \
     --disk path="$VM_DIR/deb-proto.qcow2",bus=virtio \
     --disk path="$VM_DIR/seed-deb/seed.iso",device=cdrom,bus=sata \
     --network network=default,model=virtio,mac=52:54:00:de:b0:01 \
     --graphics vnc,listen=0.0.0.0,port=5901,password="$(cat "$VM_DIR/deb-proto-vnc-password.txt")" \
     --video virtio --input tablet,bus=virtio --input keyboard,bus=virtio \
     --channel unix,target.type=virtio,target.name=org.qemu.guest_agent.0 \
     --rng /dev/urandom --noautoconsole
   virsh -c qemu:///system autostart --disable deb-proto
   ```

   The virtio tablet makes mouse positions absolute, so a click lands where `vmctl` says.
   If you start the VMs in a different order, a fixed VNC port keeps each port the same.

7. Wait about 10 minutes. The first boot installs packages and then reboots once.
   Watch the progress with screenshots:

   ```sh
   VMCTL_VM=deb-proto vmctl.py screenshot /tmp/deb.png
   ```

8. Make sure that the VM is ready:

   ```sh
   vmssh 'cat /var/lib/deb-proto-ready; uname -a'
   ```

   When the setup is done, the first command prints `deb-proto-cloud-init-done`.

9. Remove the seed ISO, so a later boot cannot run the first-boot setup again:

   ```sh
   virsh -c qemu:///system change-media deb-proto sda --eject --live --config
   ```

## 3. Build the Windows VM

This VM runs Windows 11 Pro with UEFI Secure Boot and an emulated TPM 2.0, so
Windows Setup passes its hardware checks. The installation is unattended. It
creates a local administrator, logs it in automatically, turns on Remote
Desktop and installs the virtio guest tools.

1. Download a Windows 11 x64 ISO from
   <https://www.microsoft.com/software-download/windows11>. Choose "Windows 11
   (multi-edition ISO for x64 devices)". The download link expires after 24 hours.
   Save the file as `$VM_DIR/Win11_x64.iso`.

2. Download the virtio driver ISO:

   ```sh
   cd "$VM_DIR"
   curl -fLO https://fedorapeople.org/groups/virt/virtio-win/direct-downloads/stable-virtio/virtio-win.iso
   ```

3. Build the unattended-install ISO. The computer name can have 15 characters or fewer:

   ```sh
   VM_PASSWORD='choose-a-password' python3 "$KIT/windows/make-seed.py" \
     "$VM_DIR/virtio-win.iso" "$VM_DIR/win11-autounattend.iso" WIN11-DEV ilia
   ```

   The answer file inside the ISO contains the password in plain text. Keep the ISO private.

4. Create the disk and store a VNC password:

   ```sh
   qemu-img create -f qcow2 "$VM_DIR/win11.qcow2" 100G
   umask 077; echo 'Vnc54321' > "$VM_DIR/win11-vnc-password.txt"
   ```

5. Create the VM. Do not start it yet, because the next step must run at power-on:

   ```sh
   virt-install --connect qemu:///system --name win11 \
     --memory 4096 --vcpus 2 --cpu host-passthrough --machine q35 --osinfo win11 \
     --boot loader=/usr/share/OVMF/OVMF_CODE_4M.secboot.fd,loader.readonly=yes,loader.type=pflash,loader.secure=yes,nvram.template=/usr/share/OVMF/OVMF_VARS_4M.ms.fd \
     --features smm.state=on,hyperv.relaxed.state=on,hyperv.vapic.state=on,hyperv.spinlocks.state=on,hyperv.spinlocks.retries=8191,hyperv.vpindex.state=on,hyperv.synic.state=on,hyperv.stimer.state=on,hyperv.frequencies.state=on,hyperv.tlbflush.state=on,hyperv.ipi.state=on \
     --clock offset=localtime,hypervclock_present=yes \
     --tpm backend.type=emulator,backend.version=2.0,model=tpm-crb \
     --disk path="$VM_DIR/win11.qcow2",bus=virtio,cache=none,discard=unmap,boot.order=1 \
     --disk path="$VM_DIR/Win11_x64.iso",device=cdrom,bus=sata,boot.order=2 \
     --disk path="$VM_DIR/virtio-win.iso",device=cdrom,bus=sata \
     --disk path="$VM_DIR/win11-autounattend.iso",device=cdrom,bus=sata \
     --network network=default,model=virtio \
     --graphics vnc,listen=0.0.0.0,port=5900,password="$(cat "$VM_DIR/win11-vnc-password.txt")" \
     --video virtio --input tablet,bus=virtio --input keyboard,bus=virtio \
     --channel unix,target.type=virtio,target.name=org.qemu.guest_agent.0 \
     --rng /dev/urandom --noautoconsole --noreboot --print-xml > "$VM_DIR/win11.xml"
   virsh -c qemu:///system define "$VM_DIR/win11.xml"
   virsh -c qemu:///system autostart --disable win11
   ```

   The disk comes first in the boot order. It is empty on the first boot, so the
   VM boots from the Windows ISO. After the first reboot, the VM boots from the disk.

6. Start the VM and press Enter for it. The Windows ISO waits for "Press any key
   to boot from CD", which stops an unattended install:

   ```sh
   virsh -c qemu:///system start win11
   for i in $(seq 25); do virsh -c qemu:///system send-key win11 KEY_ENTER >/dev/null; sleep 1; done
   ```

7. Wait 20 to 40 minutes. The VM reboots twice. Watch it with screenshots:

   ```sh
   VMCTL_VM=win11 vmctl.py screenshot /tmp/win.png
   ```

   The install is complete if the desktop shows and this command prints `True`:

   ```sh
   gexec.py -ps 'Test-Path C:\unattend-firstlogon-done.txt'
   ```

8. Remove the two install ISOs. The answer file wipes the disk, so it must never boot again:

   ```sh
   virsh -c qemu:///system change-media win11 sda --eject --live --config
   virsh -c qemu:///system change-media win11 sdc --eject --live --config
   ```

   Keep `sdb`, the virtio ISO. Windows uses the guest tools on it.

9. Make sure that Secure Boot and the TPM are on:

   ```sh
   gexec.py -ps 'Confirm-SecureBootUEFI; (Get-Tpm).TpmReady'
   ```

## 4. Control the VMs

`vmctl.py` works for both VMs. Set `VMCTL_VM` to choose one. Coordinates are guest pixels.

```sh
export VMCTL_VM=win11
vmctl.py screenshot out.png
vmctl.py click 640 400          # also: rightclick, doubleclick, move, drag X1 Y1 X2 Y2
vmctl.py type "Hello: World!"   # shifted characters are handled
vmctl.py key super              # also: enter, esc, tab, win-r, alt-f4, ctrl-alt-del
```

Run commands in a VM:

```sh
vmssh 'sudo apt-get install -y socat'               # Linux, as the desktop user
gexec.py -ps 'Get-Process | Select-Object -First 5' # Windows, as SYSTEM
```

`gexec.py` runs commands as SYSTEM, not as the logged-in user. Files written there
belong to SYSTEM, and an installer started there installs for the SYSTEM profile.
To act as the desktop user on Windows, use the Run dialog through `vmctl.py`:

```sh
vmctl.py key win-r; vmctl.py type 'C:\path\to\program.exe'; vmctl.py key enter
```

Start and stop the VMs with virsh:

```sh
virsh -c qemu:///system start win11
virsh -c qemu:///system shutdown win11     # clean shutdown
```

### Optional: watch a VM from a phone

noVNC shows a VM in a browser. Download a noVNC release from
<https://github.com/novnc/noVNC/releases> into `$VM_DIR/noVNC`, then run
websockify. Bind it to an address that only you can reach, such as a Tailscale address:

```sh
websockify --web "$VM_DIR/noVNC" 100.x.y.z:6080 127.0.0.1:5900
```

Open `http://100.x.y.z:6080/vnc.html?autoconnect=true` and enter the VNC password.
To keep it running, put the command in a systemd user unit and run
`loginctl enable-linger "$USER"` once.

## 5. Prepare the VMs for the messaging tests

This section connects both VMs to a SealGate backend and an IRC test server on the host.

1. Start the backend on the host from the backend repository. Set its public URL
   to the address the VMs see:

   ```sh
   EW_SITE_URL=http://192.168.122.1:3001 SEALGATE_DASHBOARD_BASE_URL=http://192.168.122.1:3001 \
     docker compose --profile full up -d --build
   ```

2. Start the IRC test server on the host, reachable from the VMs:

   ```sh
   bash ../run-ergo.sh 192.168.122.1
   ```

3. Forward the backend to `localhost` in each VM. The stdio daemon accepts a
   plain-HTTP backend only on a loopback address, so `http://192.168.122.1:3001`
   does not work for it.

   On the Linux VM:

   ```sh
   vmssh 'sudo apt-get install -y socat && mkdir -p ~/.config/systemd/user && for p in 3000 3001; do
     printf "[Service]\nExecStart=/usr/bin/socat TCP-LISTEN:$p,bind=127.0.0.1,reuseaddr,fork TCP:192.168.122.1:$p\nRestart=always\n[Install]\nWantedBy=default.target\n" \
       > ~/.config/systemd/user/sg-fwd-$p.service; done &&
     systemctl --user daemon-reload && systemctl --user enable --now sg-fwd-3000 sg-fwd-3001 &&
     curl -s localhost:3001/health'
   ```

   On the Windows VM:

   ```sh
   gexec.py -ps 'foreach ($p in 3000,3001) { netsh interface portproxy add v4tov4 listenaddress=127.0.0.1 listenport=$p connectaddress=192.168.122.1 connectport=$p };
     (Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3001/health).Content'
   ```

   If the forward works, both commands print `{"status":"healthy",...}`.

4. Build the app on the host, from `packages/desktop`. Then copy it into the VMs.
   The Windows installer needs Wine for its last step. If the host has no Wine,
   run that step in the `electronuserland/builder:wine` Docker image.

   ```sh
   npm run build:linux:x64     # dist/SealGate-<version>-x86_64.AppImage
   npm run build:win:x64       # dist/SealGate-<version>-x64-setup.exe
   ```

   Copy the AppImage with `scp` to the Linux VM. To copy the Windows installer,
   serve `dist/` with `python3 -m http.server 8765 --bind 192.168.122.1`, then
   download it inside Windows with `Invoke-WebRequest`.

5. Point the app at the backend and turn off automatic updates, before the first start.
   Without this step, the update check replaces your build with a published release.
   Write these two files in the app's data folder:

   | File | Content |
   | --- | --- |
   | `sealgate_debug_env.json` | `{"env":"custom","customApiBaseUrl":"http://localhost:3001","customMcpBaseUrl":"http://localhost:3001"}` |
   | `update-settings.json` | `{"autoDownload":false,"autoInstallOnQuit":false}` |

   The data folder is `~/.config/SealGate` on Linux and
   `C:\Users\<user>\AppData\Roaming\SealGate` on Windows. On Windows, write the
   files as the desktop user, or give that user ownership afterwards.

6. Install and start the app as the desktop user.

   - **Linux:** start the AppImage as a user unit, so it keeps running after SSH disconnects:
     `vmssh 'systemd-run --user --unit=sealgate-app --setenv=DISPLAY=:0 ~/SealGate.AppImage'`.
   - **Windows:** run the installer from the Run dialog with `vmctl.py`, as shown in section 4.

7. In the app, sign in with the browser, finish onboarding, then open the
   **Messaging** tab. If the tab asks for the local stdio tunnel, turn it on.
   Then choose **Turn on messaging**. An admin approves the request in the dashboard, under
   Manage Connectors, Requests.

8. Add an IRC account. Choose **Server not listed? Add one** and enter
   `192.168.122.1:6667` with TLS off. Enter any nick and `:` as the credentials.

Each VM registers its own server in SealGate, named `messaging-<computer name>`.

## Problems and fixes

| Symptom | Cause and fix |
| --- | --- |
| virt-install says "Permission denied" on a disk | The libvirt QEMU user cannot read `$VM_DIR`. Move it out of your home folder, or `chmod o+x` each parent folder. |
| Windows Setup shows a blue screen with no window | A driver in `$WinpeDriver$` stopped modern Setup. Build the ISO with `make-seed.py`, which copies only the safe drivers. |
| Setup fails with 0x80070103-0x40031 | The answer file loads drivers with `drvload`. Remove those commands. `$WinpeDriver$` is enough. |
| The Windows VM sits at "Press any key to boot from CD" | Step 6 of section 3 ran too late. Destroy the VM, start it, and send the Enter keys at once. |
| Characters such as `:` or `!` arrive unshifted | Use `vmctl.py type`. It holds Shift for shifted characters, which QEMU does not do. |
| Turning on the stdio tunnel fails with "cleartext HTTP backend URLs are allowed only for localhost" | The app points at `192.168.122.1`. Add the loopback forward from section 5 and use `http://localhost:3001`. |
| The Windows installer ran but the app did not change | It ran through `gexec.py`, so it installed for SYSTEM. Run it from the desktop user's Run dialog. |
| The dashboard says the Windows host is offline | The stdiod logon task is not running. Start it: `gexec.py -ps 'Get-ScheduledTask "SealGate stdiod*" \| Start-ScheduledTask'`. |
| Turning on messaging fails with HTTP 409 Conflict | An older build used the fixed name `messaging`, which another computer already holds. Delete that server in the dashboard. |
