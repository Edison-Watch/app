//! Keep-awake: block idle system sleep while the machine is on AC power.
//! Windows only. On other systems the daemon does not offer it: it sends no
//! keep-awake fields and no `device_settings` capability, so the backend
//! never sends it settings.
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
mod report;

#[cfg(windows)]
mod windows;

/// Whether this build offers keep-awake.
pub const SUPPORTED: bool = cfg!(windows);

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

/// `[power]` in `config.toml`. Kept across login and logout.
#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PowerConfig {
    /// The local keep-awake choice. Absent means `auto`: follow the dashboard.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub keep_awake: Option<LocalChoice>,
}

impl PowerConfig {
    pub(crate) fn is_default(&self) -> bool {
        self == &Self::default()
    }

    pub fn keep_awake(&self) -> LocalChoice {
        self.keep_awake.unwrap_or_default()
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

/// The sleep-block backend for this OS, or `None` where keep-awake is not
/// offered.
pub(crate) fn platform() -> Option<Box<dyn Platform>> {
    #[cfg(windows)]
    {
        Some(Box::new(windows::WindowsPower::default()))
    }
    #[cfg(not(windows))]
    {
        None
    }
}

/// Save `config` to `path`, but keep the `[power]` section that is on disk
/// now. For commands that load the config, wait (a browser sign-in can take
/// minutes) and then save: a keep-awake change made in the meantime would
/// otherwise be lost. A file on disk that cannot be read is an error, so its
/// choice is never replaced by a stale copy.
pub fn save_keeping_power(
    config: &crate::config::PersistedConfig,
    path: &std::path::Path,
) -> anyhow::Result<()> {
    with_power_lock(path, || {
        let mut config = config.clone();
        config.power = crate::config::PersistedConfig::load_from(path)?.power;
        config.save_to(path)
    })
}

/// A lock file older than this is left over from a killed process.
const LOCK_STALE: std::time::Duration = std::time::Duration::from_secs(10);
/// How long [`with_power_lock`] waits for another command's lock. Longer
/// than [`LOCK_STALE`], so a lock left by a process that just died is taken
/// over within one wait.
const LOCK_WAIT: std::time::Duration = std::time::Duration::from_secs(15);

/// [`with_power_lock`] could not get the lock in time. Callers can tell it
/// apart from a failure of their own work.
#[derive(Debug, thiserror::Error)]
#[error("{0} is locked by another command")]
pub struct LockBusy(pub std::path::PathBuf);

/// Run `f` while holding `<config>.lock`, so the commands that write
/// `config.toml` (`keep-awake`, the login save and logout) cannot interleave
/// their read and write. A lock file older than [`LOCK_STALE`] is left over
/// from a killed process and is taken over.
pub fn with_power_lock<T>(
    path: &std::path::Path,
    f: impl FnOnce() -> anyhow::Result<T>,
) -> anyhow::Result<T> {
    lock_with(path, LOCK_WAIT, LOCK_STALE, f)
}

fn lock_with<T>(
    path: &std::path::Path,
    wait: std::time::Duration,
    stale_after: std::time::Duration,
    f: impl FnOnce() -> anyhow::Result<T>,
) -> anyhow::Result<T> {
    let lock = path.with_extension("toml.lock");
    if let Some(parent) = lock.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let deadline = std::time::Instant::now() + wait;
    loop {
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&lock)
        {
            Ok(_) => break,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                let stale = std::fs::metadata(&lock)
                    .and_then(|meta| meta.modified())
                    .ok()
                    .and_then(|modified| modified.elapsed().ok())
                    .is_some_and(|age| age > stale_after);
                // Retry at once only when the stale lock is really gone. A
                // failed removal falls through to the normal wait and
                // deadline, so the loop cannot spin.
                if stale && std::fs::remove_file(&lock).is_ok() {
                    continue;
                }
                if std::time::Instant::now() >= deadline {
                    return Err(LockBusy(path.to_path_buf()).into());
                }
                std::thread::sleep(std::time::Duration::from_millis(25));
            }
            Err(error) => return Err(error.into()),
        }
    }
    let result = f();
    let _ = std::fs::remove_file(&lock);
    result
}

/// Read the local choice from `config.toml`. A missing file counts as
/// `auto`. A file that cannot be read or parsed is an error, so that the
/// controller keeps its last choice instead of switching an explicit `on`
/// or `off` to `auto`.
pub fn read_local_choice() -> Result<LocalChoice, String> {
    crate::config::PersistedConfig::load()
        .map(|config| config.power.keep_awake())
        .map_err(|error| format!("{error:#}"))
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
    fn save_keeping_power_keeps_a_change_made_while_waiting() {
        use crate::config::PersistedConfig;
        let dir = std::env::temp_dir().join(format!("sealgate-power-save-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("config.toml");
        PersistedConfig::default().save_to(&path).unwrap();
        // A login loads the file, then waits for the browser...
        let mut login = PersistedConfig::load_from(&path).unwrap();
        // ...while the person turns keep-awake on.
        let mut changed = PersistedConfig::load_from(&path).unwrap();
        changed.power.keep_awake = Some(LocalChoice::On);
        changed.save_to(&path).unwrap();
        // The login then saves its own fields.
        login.device_id = Some("device-1".into());
        save_keeping_power(&login, &path).unwrap();
        let saved = PersistedConfig::load_from(&path).unwrap();
        assert_eq!(saved.power.keep_awake(), LocalChoice::On);
        assert_eq!(saved.device_id.as_deref(), Some("device-1"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn save_keeping_power_refuses_to_replace_an_unreadable_file() {
        use crate::config::PersistedConfig;
        let dir = std::env::temp_dir().join(format!("sealgate-power-bad-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("config.toml");
        std::fs::write(&path, "[power\nkeep_awake = ").unwrap();
        assert!(save_keeping_power(&PersistedConfig::default(), &path).is_err());
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "[power\nkeep_awake = "
        );
        // The lock is released after the failure.
        assert!(!path.with_extension("toml.lock").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_stale_lock_is_taken_over() {
        let dir = std::env::temp_dir().join(format!("sealgate-power-lock-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("config.toml");
        let lock = path.with_extension("toml.lock");
        let file = std::fs::File::create(&lock).unwrap();
        file.set_modified(std::time::SystemTime::now() - std::time::Duration::from_secs(60))
            .unwrap();
        drop(file);
        assert_eq!(with_power_lock(&path, || Ok(7)).unwrap(), 7);
        assert!(!lock.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_stale_lock_that_cannot_be_removed_times_out() {
        let dir =
            std::env::temp_dir().join(format!("sealgate-power-dirlock-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("config.toml");
        // A directory in place of the lock file: it is old, so it counts as
        // stale, but remove_file fails on it.
        let lock = path.with_extension("toml.lock");
        std::fs::create_dir_all(&lock).unwrap();
        let old = std::time::SystemTime::now() - std::time::Duration::from_secs(60);
        std::fs::File::open(&lock)
            .unwrap()
            .set_modified(old)
            .unwrap();
        let error = lock_with(
            &path,
            std::time::Duration::from_millis(200),
            LOCK_STALE,
            || Ok(()),
        )
        .unwrap_err();
        assert!(error.is::<LockBusy>(), "{error:#}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn power_config_round_trips_and_defaults_to_auto() {
        let config: crate::config::PersistedConfig =
            toml::from_str("[power]\nkeep_awake = \"off\"\n").unwrap();
        assert_eq!(config.power.keep_awake(), LocalChoice::Off);
        let written = toml::to_string(&config).unwrap();
        let reread: crate::config::PersistedConfig = toml::from_str(&written).unwrap();
        assert_eq!(reread.power.keep_awake(), LocalChoice::Off);
        let empty: crate::config::PersistedConfig = toml::from_str("").unwrap();
        assert_eq!(empty.power.keep_awake(), LocalChoice::Auto);
        // The default stays out of the file.
        assert!(!toml::to_string(&empty).unwrap().contains("power"));
    }
}
