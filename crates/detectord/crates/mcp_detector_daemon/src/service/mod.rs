//! Per-OS supervisor integration: launchd on macOS, Task Scheduler on Windows.
//!
//! Each platform module exposes the same surface (`install` / `uninstall` /
//! `is_installed` / `is_running`). Other platforms (Linux, etc.) compile via a
//! stub that reports "not supported" at runtime, so the daemon still builds
//! everywhere and can be run directly with `daemon`.
//!
//! The shared parts (the optional data purge on uninstall) live here; the
//! platform modules only own the supervisor unit itself.

use anyhow::{Context, Result};

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
use macos as imp;

#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "windows")]
use windows as imp;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "linux")]
use linux as imp;

#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
mod stub;
#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
use stub as imp;

/// Install + start the supervisor unit for the current binary. `enforce` selects
/// the daemon's enforcing (quarantine + hooks) vs report-only mode. Idempotent.
pub fn install(enforce: bool) -> Result<()> {
    imp::install(enforce)
}

/// Stop + remove the supervisor unit. With `purge`, also delete all daemon data
/// (enrollment, seen-store, quarantine records, logs, socket) under base_dir.
pub fn uninstall(purge: bool) -> Result<()> {
    imp::uninstall()?;
    if purge {
        let dir = crate::paths::base_dir();
        match std::fs::remove_dir_all(&dir) {
            Ok(()) => tracing::info!(path = %dir.display(), "purged daemon data dir"),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e).with_context(|| format!("purging {}", dir.display())),
        }
        println!(
            "Uninstalled the supervisor unit and purged all data (enrollment, \
             seen-store, quarantine records, logs, socket) at {}.",
            dir.display()
        );
    } else {
        println!("Uninstalled the supervisor unit (state + logs left in place).");
    }
    Ok(())
}

/// Whether the supervisor unit is installed.
pub fn is_installed() -> bool {
    imp::is_installed()
}

/// Whether the daemon is currently running under the supervisor.
pub fn is_running() -> bool {
    imp::is_running()
}
