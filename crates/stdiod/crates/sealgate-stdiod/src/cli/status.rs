//! `sealgate-stdiod status` - one-shot snapshot of the daemon's health.
//!
//! Reads the LaunchAgent state from `launchctl` (via
//! `crate::platform::is_installed` / `is_running`) and the daemon's own
//! liveness from `~/.config/sealgate-stdiod/state.json`. Output is
//! intentionally compact, designed to be tail-grepped by humans rather
//! than parsed by machines - the tray icon should read state.json
//! directly.
//!
//! EXIT CODE reflects the supervisor, following the `systemctl status`
//! convention:
//!
//! - `0` installed and running
//! - `3` installed but not running
//! - `4` not installed
//!
//! It used to be 0 unconditionally, which made `status` useless as a check:
//! `sealgate-stdiod status >/dev/null && echo healthy` reported a dead daemon
//! as healthy, and install-beeper.sh's doctor printed "daemon connected" for a
//! unit that had never started. The desktop app does not shell out to this
//! command (it reads state.json and queries launchctl itself, see
//! main/stdiod/controller.ts), so the codes are free to carry meaning.

use anyhow::Result;
use clap::Args;

use crate::paths;
use crate::platform;
use crate::state::{ConnectionState, ServerStatus, State};

#[derive(Debug, Args)]
pub struct StatusArgs {}

/// Exit code for "installed, but the supervisor reports no running process".
pub const EXIT_NOT_RUNNING: i32 = 3;
/// Exit code for "no supervisor unit installed at all".
pub const EXIT_NOT_INSTALLED: i32 = 4;

pub fn run(_args: StatusArgs) -> Result<()> {
    let installed = platform::is_installed().unwrap_or(false);
    // Ask the supervisor as well as the filesystem. A unit file that exists but
    // was never loaded (a bootstrap that failed) and a unit that loaded and then
    // died look identical on disk, but need different fixes - see
    // supervisor_line.
    let loaded = if installed {
        platform::is_loaded().unwrap_or(false)
    } else {
        false
    };
    let running = if loaded {
        platform::is_running().unwrap_or(false)
    } else {
        false
    };

    println!(
        "Supervisor unit: {}",
        supervisor_line(installed, loaded, running)
    );
    println!("Config file:     {}", config_path_line());
    println!("State file:      {}", state_path_line());
    println!();

    match State::load() {
        Ok(s) => print_state(&s, running),
        Err(_) => {
            println!("Connection:      no state.json yet (daemon hasn't run, or supervisor not installed)");
        }
    }

    // Exit codes describe HEALTH; the line printed above describes the cause.
    // So "loaded but dead" and "never loaded" both map to EXIT_NOT_RUNNING
    // rather than growing a fourth code - callers branch on healthy/unhealthy,
    // and a new code would silently reclassify for anyone already matching on 3.
    let code = match (installed, running) {
        (true, true) => 0,
        (true, false) => EXIT_NOT_RUNNING,
        (false, _) => EXIT_NOT_INSTALLED,
    };
    if code != 0 {
        // Exit directly rather than returning an Err: this is a reporting
        // command and the state has already been printed in full above, so
        // anyhow's "Error: ..." line would add noise without information.
        // stdout is flushed explicitly because process::exit skips teardown.
        use std::io::Write;
        let _ = std::io::stdout().flush();
        std::process::exit(code);
    }
    Ok(())
}

/// The three failure shapes are distinguishable and each has its own fix, so
/// each gets its own line rather than one catch-all "not running":
///
/// - unit file on disk but the supervisor does not know it: the load never
///   succeeded (a failed bootstrap), so logs will be empty and `install` is the
///   fix, not log-reading.
/// - loaded but no process: the daemon started and exited, possibly enough
///   times to be throttled. The logs say why.
/// - nothing on disk: never installed.
fn supervisor_line(installed: bool, loaded: bool, running: bool) -> &'static str {
    match (installed, loaded, running) {
        (true, true, true) => "installed, running",
        (true, true, false) => {
            "installed and loaded, but not running (check `sealgate-stdiod logs`)"
        }
        (true, false, _) => {
            "unit file present but never loaded (run `sealgate-stdiod install` to load it)"
        }
        (false, _, _) => "not installed (run `sealgate-stdiod install`)",
    }
}

fn config_path_line() -> String {
    match paths::config_file() {
        Ok(p) if p.exists() => p.display().to_string(),
        Ok(p) => format!("{} (missing; run `sealgate-stdiod login`)", p.display()),
        Err(e) => format!("(unavailable: {e})"),
    }
}

fn state_path_line() -> String {
    match paths::state_file() {
        Ok(p) if p.exists() => p.display().to_string(),
        Ok(p) => format!("{} (missing)", p.display()),
        Err(e) => format!("(unavailable: {e})"),
    }
}

fn print_state(s: &State, running: bool) {
    // If the supervisor isn't reporting a live PID, every field below
    // comes from a state.json that hasn't been rewritten since the
    // daemon's last run. Mark it as stale so callers don't read a
    // dead-since-Tuesday "Connection: connected" as current truth.
    if !running {
        println!("(daemon not currently running - fields below are from the last run)");
    }

    let conn = match s.connection_state {
        ConnectionState::Starting => "starting",
        ConnectionState::Connected => "connected",
        ConnectionState::Reconnecting => "reconnecting",
        ConnectionState::NeedsReauth => "needs reauth (run `sealgate-stdiod login`)",
        ConnectionState::NeedsUpgrade => "needs upgrade (daemon binary too old for backend)",
    };
    let label = if running {
        "Connection:"
    } else {
        "Last state:"
    };
    println!("{:<16} {}", label, conn);
    if let Some(url) = &s.backend_url {
        println!("Backend:         {}", url);
    }
    if let Some(d) = &s.device_id {
        let label = s.device_label.as_deref().unwrap_or("");
        if label.is_empty() {
            println!("Device:          {}", d);
        } else {
            println!("Device:          {} ({})", d, label);
        }
    }
    if let Some(ts) = s.last_connected_at {
        println!("Last connected:  {}", ts.to_rfc3339());
    }
    if let Some(err) = &s.last_error {
        println!("Last error:      {}", err);
    }
    if s.servers.is_empty() {
        println!("Servers:         (none)");
    } else {
        println!("Servers:");
        for srv in &s.servers {
            let state = match srv.state {
                ServerStatus::Starting => "starting",
                ServerStatus::Running => "running",
                ServerStatus::Crashed => "crashed",
            };
            let pid = srv.pid.map(|p| format!("pid {p}")).unwrap_or_default();
            println!("  - {:<24} {} {}", srv.name, state, pid);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn supervisor_line_separates_never_loaded_from_crashed() {
        // The distinction this exists for: both have a unit file on disk, but
        // one never loaded (empty logs, `install` is the fix) and the other
        // loaded and died (logs explain why).
        let never_loaded = supervisor_line(true, false, false);
        let crashed = supervisor_line(true, true, false);
        assert_ne!(never_loaded, crashed);
        assert!(never_loaded.contains("never loaded"));
        assert!(never_loaded.contains("install"));
        assert!(crashed.contains("logs"));
    }

    #[test]
    fn supervisor_line_covers_healthy_and_absent() {
        assert_eq!(supervisor_line(true, true, true), "installed, running");
        assert!(supervisor_line(false, false, false).contains("not installed"));
    }

    // Exit codes are a compatibility surface: install-beeper.sh's doctor
    // branches on them, so pin the mapping rather than letting a refactor
    // renumber it. Both unhealthy-but-installed shapes collapse to 3 on
    // purpose - see the note in run().
    #[test]
    fn exit_codes_group_by_health_not_cause() {
        let code = |installed: bool, running: bool| match (installed, running) {
            (true, true) => 0,
            (true, false) => EXIT_NOT_RUNNING,
            (false, _) => EXIT_NOT_INSTALLED,
        };
        assert_eq!(code(true, true), 0);
        assert_eq!(code(true, false), 3);
        assert_eq!(code(false, false), 4);
    }
}
