#cloud-config
hostname: @HOSTNAME@
fqdn: @HOSTNAME@
manage_etc_hosts: true
users:
  - name: @USER@
    gecos: @USER@
    groups: [sudo, adm, audio, video, plugdev, netdev, users]
    shell: /bin/bash
    sudo: "ALL=(ALL) NOPASSWD:ALL"
    lock_passwd: false
    passwd: "@PASSWORD_HASH@"
    ssh_authorized_keys:
      - "@SSH_PUBKEY@"
ssh_pwauth: false
disable_root: true
growpart:
  mode: auto
  devices: ["/"]
package_update: true
package_upgrade: true
packages:
  - qemu-guest-agent
  - openssh-server
  - xfce4
  - xfce4-terminal
  - lightdm
  - lightdm-gtk-greeter
  - xserver-xorg
  - x11-xserver-utils
  - dbus-x11
  - chromium
  - fuse3
  - libfuse2t64
  - curl
  - jq
  - sqlite3
  - python3
  - git
  - ca-certificates
  - fonts-dejavu
write_files:
  - path: /etc/lightdm/lightdm.conf.d/50-@HOSTNAME@.conf
    content: |
      [Seat:*]
      autologin-user=@USER@
      autologin-user-timeout=0
      autologin-session=xfce
      user-session=xfce
      xserver-command=X -s 0 -dpms
      display-setup-script=/usr/local/bin/@HOSTNAME@-set-res
  - path: /usr/local/bin/@HOSTNAME@-set-res
    permissions: "0755"
    content: |
      #!/bin/sh
      # Force 1280x800 on the first connected output (virtio-gpu / qxl).
      OUT=$(xrandr 2>/dev/null | awk '/ connected/{print $1; exit}')
      [ -n "$OUT" ] || exit 0
      if ! xrandr --output "$OUT" --mode 1280x800 2>/dev/null; then
        xrandr --newmode 1280x800_60 83.50 1280 1352 1480 1680 800 803 809 831 -hsync +vsync 2>/dev/null || true
        xrandr --addmode "$OUT" 1280x800_60 2>/dev/null || true
        xrandr --output "$OUT" --mode 1280x800_60 2>/dev/null || true
      fi
      exit 0
  - path: /etc/xdg/autostart/@HOSTNAME@-noblank.desktop
    content: |
      [Desktop Entry]
      Type=Application
      Name=Disable screen blanking
      Exec=sh -c 'xset s off; xset s noblank; xset -dpms; /usr/local/bin/@HOSTNAME@-set-res'
      NoDisplay=true
  - path: /etc/xdg/xfce4/xfconf/xfce-perchannel-xml/xfce4-power-manager.xml
    content: |
      <?xml version="1.0" encoding="UTF-8"?>
      <channel name="xfce4-power-manager" version="1.0">
        <property name="xfce4-power-manager" type="empty">
          <property name="dpms-enabled" type="bool" value="false"/>
          <property name="blank-on-ac" type="int" value="0"/>
          <property name="blank-on-battery" type="int" value="0"/>
          <property name="dpms-on-ac-sleep" type="uint" value="0"/>
          <property name="dpms-on-ac-off" type="uint" value="0"/>
          <property name="inactivity-on-ac" type="uint" value="14"/>
          <property name="inactivity-sleep-mode-on-ac" type="uint" value="1"/>
          <property name="lock-screen-suspend-hibernate" type="bool" value="false"/>
          <property name="show-tray-icon" type="bool" value="false"/>
        </property>
      </channel>
  - path: /etc/xdg/xfce4/xfconf/xfce-perchannel-xml/xfce4-screensaver.xml
    content: |
      <?xml version="1.0" encoding="UTF-8"?>
      <channel name="xfce4-screensaver" version="1.0">
        <property name="saver" type="empty">
          <property name="enabled" type="bool" value="false"/>
          <property name="idle-activation" type="empty">
            <property name="enabled" type="bool" value="false"/>
          </property>
        </property>
        <property name="lock" type="empty">
          <property name="enabled" type="bool" value="false"/>
        </property>
      </channel>
runcmd:
  - [sh, -c, "for f in /etc/xdg/autostart/light-locker.desktop /etc/xdg/autostart/xfce4-screensaver.desktop; do [ -f $f ] && echo Hidden=true >> $f; done; true"]
  - [systemctl, mask, sleep.target, suspend.target, hibernate.target, hybrid-sleep.target]
  - [systemctl, set-default, graphical.target]
  - [systemctl, enable, --now, qemu-guest-agent]
  - [systemctl, enable, --now, ssh]
  - [sh, -c, "echo @HOSTNAME@-cloud-init-done > /var/lib/@HOSTNAME@-ready"]
power_state:
  mode: reboot
  delay: now
  message: @HOSTNAME@ first boot done, rebooting into the desktop
  condition: true
