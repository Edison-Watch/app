//! Keep-awake: block idle system sleep while the machine is on AC power.
//!
//! The dashboard owns a per-device value (`device_settings.keep_awake`, the
//! "desired" value). The person at the machine owns a local choice in
//! `config.toml` (`[power] keep_awake = "auto" | "on" | "off"`). A local
//! `on` or `off` wins; `auto` follows the dashboard. When the result is on,
//! the daemon holds an OS sleep block while on AC power and releases it on
//! battery. It blocks idle system sleep only: the display can still turn off,
//! and closing a laptop lid still sleeps the machine.
//!
//! [`controller::KeepAwake`] runs the logic on one long-lived thread, because
//! on Windows the sleep block belongs to the thread that sets it.

use serde::{Deserialize, Serialize};

pub mod controller;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(unix)]
mod unix_hold;
#[cfg(windows)]
mod windows;

/// The local keep-awake choice stored in `config.toml`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, clap::ValueEnum)]
#[serde(rename_all = "lowercase")]
pub enum LocalChoice {
    /// Follow the dashboard value.
    #[default]
    Auto,
    /// Keep the machine awake on AC power, whatever the dashboard says.
    On,
    /// Never keep the machine awake, whatever the dashboard says.
    Off,
}

impl LocalChoice {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::On => "on",
            Self::Off => "off",
        }
    }

    /// The result of this local choice combined with the dashboard value.
    pub fn wants_awake(self, desired: bool) -> bool {
        match self {
            Self::On => true,
            Self::Off => false,
            Self::Auto => desired,
        }
    }
}

/// What the daemon holds now. Reported to the backend and shown on the
/// dashboard.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Effective {
    /// The result is on, the machine is on AC power, and the block is held.
    Active,
    /// The result is on, but the machine is on battery, so no block is held.
    OnBattery,
    /// The result is off.
    Inactive,
    /// The result is on, but the OS refused the block.
    Unsupported,
}

impl Effective {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::OnBattery => "on_battery",
            Self::Inactive => "inactive",
            Self::Unsupported => "unsupported",
        }
    }
}

/// The keep-awake part of `state.json`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct KeepAwakeStatus {
    /// The local choice from `config.toml`.
    pub local: LocalChoice,
    /// The last dashboard value the daemon received. Kept in `state.json` so
    /// that a restart without a backend connection keeps the same behavior.
    pub desired: bool,
    pub effective: Effective,
}

/// One OS sleep-block backend. Every call happens on the controller thread.
pub(crate) trait Platform: Send {
    /// True only when the machine runs on battery. Unknown counts as AC
    /// power, so desktops and VMs without a battery report false.
    fn on_battery(&mut self) -> bool;
    /// Take the sleep block. Calling it while the block is held is a no-op.
    /// The controller calls it on every tick while the block is wanted, so a
    /// block that went away (for example, a helper process exited) comes
    /// back within one tick.
    fn hold(&mut self) -> Result<(), String>;
    /// Release the sleep block. Calling it while nothing is held is a no-op.
    fn release(&mut self);
}

/// The sleep-block backend for this OS.
pub(crate) fn platform() -> Box<dyn Platform> {
    #[cfg(windows)]
    {
        Box::new(windows::WindowsPower::default())
    }
    #[cfg(target_os = "macos")]
    {
        Box::new(macos::MacPower::default())
    }
    #[cfg(target_os = "linux")]
    {
        Box::new(linux::LinuxPower::default())
    }
    #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
    {
        Box::new(Unsupported)
    }
}

#[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
struct Unsupported;

#[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
impl Platform for Unsupported {
    fn on_battery(&mut self) -> bool {
        false
    }
    fn hold(&mut self) -> Result<(), String> {
        Err("keep-awake is not supported on this OS".into())
    }
    fn release(&mut self) {}
}

/// Read the local choice from `config.toml`. A missing or unreadable file
/// counts as `auto`.
pub fn read_local_choice() -> LocalChoice {
    crate::config::PersistedConfig::load()
        .map(|config| config.power.keep_awake())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_choice_wins_over_dashboard() {
        assert!(LocalChoice::On.wants_awake(false));
        assert!(!LocalChoice::Off.wants_awake(true));
        assert!(LocalChoice::Auto.wants_awake(true));
        assert!(!LocalChoice::Auto.wants_awake(false));
    }

    #[test]
    fn wire_strings_match_the_contract() {
        assert_eq!(serde_json::to_value(LocalChoice::Auto).unwrap(), "auto");
        assert_eq!(
            serde_json::to_value(Effective::OnBattery).unwrap(),
            "on_battery"
        );
        for effective in [
            Effective::Active,
            Effective::OnBattery,
            Effective::Inactive,
            Effective::Unsupported,
        ] {
            assert_eq!(serde_json::to_value(effective).unwrap(), effective.as_str());
        }
    }

    #[test]
    fn power_config_round_trips_and_defaults_to_auto() {
        let config: crate::config::PersistedConfig =
            toml::from_str("[power]\nkeep_awake = \"off\"\n").unwrap();
        assert_eq!(config.power.keep_awake(), LocalChoice::Off);
        let empty: crate::config::PersistedConfig = toml::from_str("").unwrap();
        assert_eq!(empty.power.keep_awake(), LocalChoice::Auto);
        // The default stays out of the file.
        assert!(!toml::to_string(&empty).unwrap().contains("power"));
    }
}
