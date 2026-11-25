//! macOS: `caffeinate -i -w <daemon pid>`, and `pmset -g batt` for the power
//! source.
//!
//! `-i` creates a `PreventUserIdleSystemSleep` assertion: the display can still
//! sleep, and a lid close or a sleep that the user starts still works. `-w`
//! makes caffeinate exit when the daemon exits. Both tools ship with macOS.

use std::process::Command;

use super::unix_hold::HelperHold;

pub(crate) struct MacPower {
    hold: HelperHold,
}

impl Default for MacPower {
    fn default() -> Self {
        Self {
            hold: HelperHold::new(
                "/usr/bin/caffeinate",
                vec!["-i".into(), "-w".into(), std::process::id().to_string()],
            ),
        }
    }
}

impl super::Platform for MacPower {
    fn on_battery(&mut self) -> bool {
        Command::new("/usr/bin/pmset")
            .args(["-g", "batt"])
            .output()
            .map(|output| on_battery_from_pmset(&String::from_utf8_lossy(&output.stdout)))
            .unwrap_or(false)
    }

    fn hold(&mut self) -> Result<(), String> {
        self.hold.hold()
    }

    fn release(&mut self) {
        self.hold.release();
    }
}

/// `pmset -g batt` starts with `Now drawing from 'AC Power'` or
/// `Now drawing from 'Battery Power'`.
fn on_battery_from_pmset(output: &str) -> bool {
    output
        .lines()
        .next()
        .is_some_and(|line| line.contains("'Battery Power'"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_pmset_power_source() {
        assert!(on_battery_from_pmset(
            "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1)\t80%; discharging"
        ));
        assert!(!on_battery_from_pmset(
            "Now drawing from 'AC Power'\n -InternalBattery-0 (id=1)\t80%; charging"
        ));
        assert!(!on_battery_from_pmset(""));
    }
}
