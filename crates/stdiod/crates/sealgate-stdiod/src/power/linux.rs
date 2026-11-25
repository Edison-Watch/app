//! Linux (best effort): a logind `idle` inhibitor through `systemd-inhibit`,
//! and `/sys/class/power_supply` for the power source.
//!
//! The inhibitor runs `tail --pid=<daemon pid> -f /dev/null`, so it ends when
//! the daemon ends. Only `idle` is inhibited: a sleep that the user starts and
//! a lid close still work. Desktop environments run their own idle-suspend
//! logic, and not all of them honor logind idle inhibitors. If logind refuses
//! the inhibitor (no session, no D-Bus), the daemon reports `unsupported`.

use std::path::Path;

use super::unix_hold::HelperHold;

const POWER_SUPPLY_DIR: &str = "/sys/class/power_supply";

pub(crate) struct LinuxPower {
    hold: HelperHold,
}

impl Default for LinuxPower {
    fn default() -> Self {
        Self {
            hold: HelperHold::new(
                "systemd-inhibit",
                vec![
                    "--what=idle".into(),
                    "--who=SealGate".into(),
                    "--why=Keep this computer awake for remote MCP calls while plugged in".into(),
                    "--mode=block".into(),
                    "tail".into(),
                    format!("--pid={}", std::process::id()),
                    "-f".into(),
                    "/dev/null".into(),
                ],
            ),
        }
    }
}

impl super::Platform for LinuxPower {
    fn on_battery(&mut self) -> bool {
        on_battery_from_sysfs(Path::new(POWER_SUPPLY_DIR))
    }

    fn hold(&mut self) -> Result<(), String> {
        self.hold.hold()
    }

    fn release(&mut self) {
        self.hold.release();
    }
}

/// On battery when no mains or USB supply is online and a battery
/// discharges. No supplies at all (desktops, VMs) counts as AC power.
fn on_battery_from_sysfs(dir: &Path) -> bool {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return false;
    };
    let read = |path: &Path, name: &str| {
        std::fs::read_to_string(path.join(name))
            .map(|value| value.trim().to_string())
            .unwrap_or_default()
    };
    let mut discharging = false;
    for entry in entries.flatten() {
        let path = entry.path();
        match read(&path, "type").as_str() {
            "Mains" | "USB" if read(&path, "online") == "1" => return false,
            "Battery" if read(&path, "status") == "Discharging" => discharging = true,
            _ => {}
        }
    }
    discharging
}

#[cfg(test)]
mod tests {
    use super::*;

    fn supply(root: &Path, name: &str, files: &[(&str, &str)]) {
        let dir = root.join(name);
        std::fs::create_dir_all(&dir).unwrap();
        for (file, value) in files {
            std::fs::write(dir.join(file), format!("{value}\n")).unwrap();
        }
    }

    fn temp_root(name: &str) -> std::path::PathBuf {
        let root =
            std::env::temp_dir().join(format!("sealgate-power-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn mains_online_means_ac() {
        let root = temp_root("ac");
        supply(&root, "AC", &[("type", "Mains"), ("online", "1")]);
        supply(
            &root,
            "BAT0",
            &[("type", "Battery"), ("status", "Charging")],
        );
        assert!(!on_battery_from_sysfs(&root));
    }

    #[test]
    fn discharging_battery_without_mains_means_battery() {
        let root = temp_root("battery");
        supply(&root, "AC", &[("type", "Mains"), ("online", "0")]);
        supply(
            &root,
            "BAT0",
            &[("type", "Battery"), ("status", "Discharging")],
        );
        assert!(on_battery_from_sysfs(&root));
    }

    #[test]
    fn no_supplies_means_ac() {
        let root = temp_root("none");
        assert!(!on_battery_from_sysfs(&root));
        assert!(!on_battery_from_sysfs(&root.join("missing")));
    }
}
