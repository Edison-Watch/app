//! The `state.json` liveness/status file (stdiod-style): a readable snapshot of
//! the running daemon. `updated_at` doubles as a heartbeat — a stale timestamp
//! means the daemon is wedged or gone.

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

use crate::paths;

#[derive(Debug, Serialize)]
struct DaemonStatus {
    version: String,
    pid: u32,
    is_root: bool,
    socket: String,
    enrolled_users: Vec<String>,
    updated_at: u64,
}

/// Write `state.json` (best-effort; errors are the caller's to log).
pub fn write(socket: &Path, users: &[String]) -> anyhow::Result<()> {
    paths::ensure_base_dir()?;
    let status = DaemonStatus {
        version: env!("CARGO_PKG_VERSION").to_string(),
        pid: std::process::id(),
        is_root: paths::is_root(),
        socket: socket.display().to_string(),
        enrolled_users: users.to_vec(),
        updated_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0),
    };
    std::fs::write(
        paths::state_json_path(),
        serde_json::to_string_pretty(&status)?,
    )?;
    Ok(())
}
