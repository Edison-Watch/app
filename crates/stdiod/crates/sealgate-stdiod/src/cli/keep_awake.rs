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
    let mut config = PersistedConfig::load()?;
    if let Some(choice) = args.choice {
        // `auto` is the default, so it is stored as an absent value.
        config.power.keep_awake = (choice != LocalChoice::Auto).then_some(choice);
        config.save()?;
    }
    let local = config.power.keep_awake();
    let daemon = State::load().ok().and_then(|state| state.keep_awake);
    // state.json keeps the last value after the daemon stops, and right after
    // a change it can still hold the previous local choice. In both cases its
    // effective value is not what holds now, so leave it out.
    let effective = daemon
        .filter(|status| status.local == local && daemon_running())
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

/// The same check as `status`: the supervisor unit is installed, loaded and
/// has a running process.
fn daemon_running() -> bool {
    use crate::platform;
    platform::is_installed().unwrap_or(false)
        && platform::is_loaded().unwrap_or(false)
        && platform::is_running().unwrap_or(false)
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
