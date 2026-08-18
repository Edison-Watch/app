//! Per-user filesystem layout for the daemon.
//!
//! Layout (macOS / Linux):
//!
//! ```text
//! ~/.config/sealgate-stdiod/
//!     config.toml          backend URL + credentials (mode 0600)
//!     state.json           live connection + child snapshot for the tray
//! ~/Library/Logs/sealgate-stdiod/    (macOS)
//! ~/.local/state/sealgate-stdiod/    (Linux, XDG_STATE_HOME)
//!     daemon.log           rotated by the supervisor unit
//!     child-<name>.log     per-child stdout+stderr capture
//! ```
//!
//! Path lookups fall back to the user's home directory if the
//! platform-specific accessor isn't available, so the daemon never crashes
//! on an exotic environment - it just lands files under `~/.sealgate-stdiod/`.

use std::path::PathBuf;

use anyhow::{anyhow, Result};

/// Returns `~/.config/sealgate-stdiod/`, creating the directory if it
/// doesn't already exist.
///
/// We pin to `~/.config/` on every platform (including macOS, where the
/// OS convention is `~/Library/Application Support/`) so the docs in
/// ARCHITECTURE.md can name a single canonical path
/// and so admins shelling into a user's machine know where to look.
pub fn config_dir() -> Result<PathBuf> {
    let home =
        dirs::home_dir().ok_or_else(|| anyhow!("could not resolve home dir; HOME not set?"))?;
    let dir = home.join(".config").join("sealgate-stdiod");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// `~/.config/sealgate-stdiod/config.toml`. Created with mode 0600 on Unix
/// by [`crate::config::write_persisted`].
pub fn config_file() -> Result<PathBuf> {
    Ok(config_dir()?.join("config.toml"))
}

/// `~/.config/sealgate-stdiod/state.json`. Atomically rewritten by the daemon
/// whenever connection state changes; read by `status` and by the desktop
/// tray.
#[allow(dead_code)] // wired up by the `status` subcommand (next commit)
pub fn state_file() -> Result<PathBuf> {
    Ok(config_dir()?.join("state.json"))
}

/// Per-platform log directory.
#[allow(dead_code)] // wired up by the `logs` subcommand (later commit)
pub fn log_dir() -> Result<PathBuf> {
    let dir = if cfg!(target_os = "macos") {
        dirs::home_dir()
            .ok_or_else(|| anyhow!("could not resolve home dir"))?
            .join("Library/Logs/sealgate-stdiod")
    } else {
        dirs::state_dir()
            .or_else(|| dirs::home_dir().map(|h| h.join(".local/state")))
            .ok_or_else(|| anyhow!("could not resolve state dir"))?
            .join("sealgate-stdiod")
    };
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// `<log_dir>/daemon.log`.
#[allow(dead_code)] // wired up by the `logs` subcommand (later commit)
pub fn daemon_log_file() -> Result<PathBuf> {
    Ok(log_dir()?.join("daemon.log"))
}
