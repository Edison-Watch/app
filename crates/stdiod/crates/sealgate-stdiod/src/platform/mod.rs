//! Per-OS supervisor integration (launchd / systemd / Scheduled Task).
//!
//! v1 ships macOS only; Linux and Windows ports land in v1.1. Each platform
//! exposes the same surface:
//!
//! - [`install`] - writes the supervisor unit pointing at the current
//!   binary and starts the daemon now. Idempotent (re-running replaces).
//! - [`uninstall`] - stops + removes the unit. Idempotent.
//! - [`restart`] - restart the daemon in place, without re-rendering the
//!   unit or touching credentials.
//! - [`is_installed`] / [`is_loaded`] / [`is_running`] - used by ``status``.
//!   `is_installed` asks the filesystem, `is_loaded` asks the supervisor, and
//!   they disagree exactly when a unit was written but never loaded.
//!
//! Non-macOS builds compile and surface "not yet supported on this
//! platform" at runtime rather than failing to build, so dev iteration on
//! Linux/Windows still produces a working binary.

#[cfg(target_os = "macos")]
pub mod macos;

#[cfg(target_os = "macos")]
pub use macos::{install, restart, uninstall, unit_definition};

// is_installed / is_running are consumed by the `status` subcommand
// (next commit). Pull them through with an allow so the unused-import
// lint doesn't fire until that subcommand lands.
#[cfg(target_os = "macos")]
#[allow(unused_imports)]
pub use macos::{is_installed, is_loaded, is_running};

#[cfg(target_os = "windows")]
pub mod windows;

#[cfg(target_os = "windows")]
pub use windows::{install, restart, stop, uninstall, unit_definition};

#[cfg(target_os = "windows")]
#[allow(unused_imports)]
pub use windows::{is_installed, is_loaded, is_running};

#[cfg(target_os = "linux")]
pub mod linux;

#[cfg(target_os = "linux")]
pub use linux::{install, restart, uninstall, unit_definition};

#[cfg(target_os = "linux")]
#[allow(unused_imports)]
pub use linux::{is_installed, is_loaded, is_running};

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
mod stub {
    use anyhow::{anyhow, Result};

    pub fn install() -> Result<()> {
        Err(anyhow!(
            "install is implemented for macOS, Linux (systemd), and Windows. \
             This OS has no supervisor integration - run `sealgate-stdiod run` \
             directly. See stdiod/REQUIREMENTS.md.",
        ))
    }

    pub fn uninstall() -> Result<()> {
        Err(anyhow!(
            "uninstall is implemented for macOS, Linux (systemd), and Windows.",
        ))
    }

    pub fn restart() -> Result<()> {
        Err(anyhow!(
            "restart is implemented for macOS, Linux (systemd), and Windows.",
        ))
    }

    pub fn is_installed() -> Result<bool> {
        Ok(false)
    }

    pub fn unit_definition() -> Result<Option<String>> {
        Ok(None)
    }

    pub fn is_loaded() -> Result<bool> {
        Ok(false)
    }

    pub fn is_running() -> Result<bool> {
        Ok(false)
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
pub use stub::{install, is_installed, is_loaded, is_running, restart, uninstall, unit_definition};

/// Whether `schtasks /query /fo csv /nh` output lists the task `name` in the
/// root folder (first column `"\<name>"`). Pure, so the parsing is tested on
/// every platform; the task names this daemon uses are ASCII, so the output's
/// code page does not matter.
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub(crate) fn schtasks_csv_lists(csv: &str, name: &str) -> bool {
    let want = format!("\"\\{name}\"");
    csv.lines()
        .any(|line| line.trim_start().split(',').next() == Some(want.as_str()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schtasks_csv_lists_matches_the_exact_root_task() {
        let csv = "\"\\SealGate stdiod S-1-5-21-1-500\",\"N/A\",\"Running\"\r\n\
                   \"\\Other\",\"N/A\",\"Ready\"\r\n\
                   \"\\Microsoft\\SealGate stdiod\",\"N/A\",\"Ready\"\r\n";
        assert!(schtasks_csv_lists(csv, "SealGate stdiod S-1-5-21-1-500"));
        // Another account's task, a prefix, or one in a subfolder is not ours.
        assert!(!schtasks_csv_lists(csv, "SealGate stdiod S-1-5-21-1-501"));
        assert!(!schtasks_csv_lists(csv, "SealGate stdiod"));
        assert!(!schtasks_csv_lists("", "SealGate stdiod S-1-5-21-1-500"));
    }
}
