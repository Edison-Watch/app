//! `sealgate-stdiod keep-awake [on|off|auto] [--json]`
//!
//! Sets or shows the local keep-awake choice. The choice is stored in
//! `config.toml` under `[power]`; the running daemon reads it again within a
//! few seconds, so no restart is needed. `auto` follows the dashboard value.

use anyhow::Result;
use clap::Args;
use serde::Serialize;

use crate::config::PersistedConfig;
use crate::power::{Effective, LocalChoice};
use crate::state::State;

#[derive(Debug, Args)]
pub struct KeepAwakeArgs {
    /// The new local choice. Leave it out to print the current state.
    #[arg(value_enum)]
    pub choice: Option<LocalChoice>,
    /// Print the result as one JSON object (for the desktop app).
    #[arg(long)]
    pub json: bool,
}

#[derive(Serialize)]
struct Report {
    /// The local choice in `config.toml`.
    local: LocalChoice,
    /// The last dashboard value the daemon received, if the daemon ran.
    desired: Option<bool>,
    /// What the running daemon holds, if it reported one.
    effective: Option<Effective>,
}

pub fn run(args: KeepAwakeArgs) -> Result<()> {
    if !crate::power::SUPPORTED {
        anyhow::bail!("keep-awake is only available on Windows");
    }
    let path = crate::paths::config_file()?;
    let config = crate::power::with_power_lock(&path, || {
        let mut config = PersistedConfig::load_from(&path)?;
        if let Some(choice) = args.choice {
            // `auto` is the default, so it is stored as an absent value.
            config.power.keep_awake = (choice != LocalChoice::Auto).then_some(choice);
            config.save_to(&path)?;
        }
        Ok(config)
    })?;
    let local = config.power.keep_awake();
    let state = State::load().ok();
    let daemon_pid = state.as_ref().and_then(|state| state.pid);
    let daemon = state.and_then(|state| state.keep_awake);
    // state.json keeps the last value after the daemon stops, and right after
    // a change it can still hold the previous local choice. In both cases its
    // effective value is not what holds now, so leave it out.
    let effective = daemon
        .filter(|status| status.local == local && daemon_running(daemon_pid))
        .map(|status| status.effective);
    let report = Report {
        local,
        desired: daemon.map(|status| status.desired),
        effective,
    };

    if args.json {
        println!("{}", serde_json::to_string(&report)?);
        return Ok(());
    }
    if args.choice.is_some() {
        println!("Local keep-awake choice set to {}.", local.as_str());
    }
    println!("{}", describe(&report));
    Ok(())
}

/// Whether the daemon that wrote `state.json` (process `pid`) still runs.
/// Keep-awake is Windows-only (see `platform::windows::daemon_running`).
#[cfg(windows)]
fn daemon_running(pid: Option<u32>) -> bool {
    crate::platform::windows::daemon_running(pid)
}

#[cfg(not(windows))]
fn daemon_running(_pid: Option<u32>) -> bool {
    false
}

fn describe(report: &Report) -> String {
    let local = match report.local {
        LocalChoice::Auto => "follow the dashboard (auto)",
        LocalChoice::On => "on",
        LocalChoice::Off => "off",
    };
    let dashboard = match report.desired {
        Some(true) => "on",
        Some(false) => "off",
        None => "not received yet",
    };
    let effective = match report.effective {
        Some(Effective::Active) => "keeping this computer awake (on AC power)",
        Some(Effective::OnBattery) => "on, but paused while on battery",
        Some(Effective::Inactive) => "not keeping this computer awake",
        Some(Effective::Unsupported) => "on, but this OS refused the sleep block",
        None => "unknown (the daemon is not running or has not read the change yet)",
    };
    format!("Local choice: {local}\nDashboard value: {dashboard}\nNow: {effective}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn json_shape_is_stable() {
        let report = Report {
            local: LocalChoice::Auto,
            desired: Some(true),
            effective: Some(Effective::OnBattery),
        };
        assert_eq!(
            serde_json::to_value(&report).unwrap(),
            serde_json::json!({"local": "auto", "desired": true, "effective": "on_battery"})
        );
    }

    #[test]
    fn describe_names_every_part() {
        let text = describe(&Report {
            local: LocalChoice::Off,
            desired: None,
            effective: Some(Effective::Inactive),
        });
        assert!(text.contains("Local choice: off"));
        assert!(text.contains("not received yet"));
        assert!(text.contains("not keeping"));
    }
}
