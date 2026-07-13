//! Fallback for platforms without supervisor integration (Linux, etc.). The
//! daemon still builds and can be run directly with `daemon` (e.g. under a
//! systemd user unit); install reports "not supported" rather than failing to
//! compile. `uninstall` is a no-op so `service uninstall --purge` can still wipe
//! data (the shared purge runs in `service::uninstall`).

use anyhow::{Result, bail};

pub fn install(_enforce: bool) -> Result<()> {
    bail!(
        "`service install` is implemented for macOS (launchd) and Windows (Task \
         Scheduler). On this platform run the daemon directly with `daemon` (e.g. \
         under a systemd user unit)."
    )
}

pub fn uninstall() -> Result<()> {
    Ok(())
}

pub fn is_installed() -> bool {
    false
}

pub fn is_running() -> bool {
    false
}
