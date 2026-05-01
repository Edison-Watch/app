//! Full-Disk-Access detection. macOS's TCC framework exposes no query API —
//! the canonical workaround is to attempt a read of a TCC-protected path and
//! interpret EPERM as "denied".

use std::fs::File;
use std::path::{Path, PathBuf};

/// Default probe path: the system's TCC database. Any read of this file from
/// an unprivileged process is gated by Full Disk Access.
pub fn default_probe_path() -> PathBuf {
    let base = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/Users"));
    base.join("Library/Application Support/com.apple.TCC/TCC.db")
}

/// Attempt to open the probe path for reading. Returns true if the open
/// succeeds (FDA granted) and false on `EPERM` / `EACCES` / `ENOENT`.
pub fn check(probe_path: &Path) -> bool {
    match File::open(probe_path) {
        Ok(_) => true,
        Err(e) => {
            tracing::debug!(error = %e, path = %probe_path.display(), "FDA probe failed");
            false
        }
    }
}
