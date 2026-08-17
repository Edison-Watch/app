//! Privilege + user-identity helpers.
//!
//! Under the privileged (root) macOS/Unix build the daemon writes files into a
//! user's home and must resolve/chown them to that user; those helpers are
//! implemented with libc. Non-Unix targets have no such privileged multi-user
//! model (the daemon runs per-user via a scheduled task), so the same surface is
//! provided as no-op / `None` stubs.

#[cfg(unix)]
mod imp {
    use std::os::unix::ffi::OsStrExt;
    use std::path::Path;

    /// Resolve a uid to its OS user name via `getpwuid`. Used to scope an IPC
    /// connection to the peer's user (from the socket's peer credentials).
    pub fn username_for_uid(uid: u32) -> Option<String> {
        // SAFETY: getpwuid returns a pointer into a static buffer valid until the
        // next passwd call; we copy the name out immediately.
        unsafe {
            let pw = libc::getpwuid(uid);
            if pw.is_null() {
                None
            } else {
                Some(
                    std::ffi::CStr::from_ptr((*pw).pw_name)
                        .to_string_lossy()
                        .into_owned(),
                )
            }
        }
    }

    /// Resolve an OS user name to its home dir via `getpwnam` (`pw_dir`).
    pub fn home_dir_for(user: &str) -> Option<std::path::PathBuf> {
        let cname = std::ffi::CString::new(user).ok()?;
        // SAFETY: getpwnam returns a pointer into a static buffer valid until the
        // next passwd call; we copy pw_dir out immediately.
        unsafe {
            let pw = libc::getpwnam(cname.as_ptr());
            if pw.is_null() || (*pw).pw_dir.is_null() {
                None
            } else {
                let bytes = std::ffi::CStr::from_ptr((*pw).pw_dir).to_bytes();
                Some(std::path::PathBuf::from(std::ffi::OsStr::from_bytes(bytes)))
            }
        }
    }

    /// Resolve an OS user name to its `(uid, gid)` via `getpwnam`.
    pub fn uid_gid_for(user: &str) -> Option<(u32, u32)> {
        let cname = std::ffi::CString::new(user).ok()?;
        // SAFETY: getpwnam returns a pointer into a static buffer valid until the
        // next passwd call; we read its fields immediately and copy them out.
        unsafe {
            let pw = libc::getpwnam(cname.as_ptr());
            if pw.is_null() {
                None
            } else {
                Some(((*pw).pw_uid, (*pw).pw_gid))
            }
        }
    }

    /// `chown(path, uid, gid)`. Errors are the caller's to log (best-effort).
    pub fn chown(path: &Path, uid: u32, gid: u32) -> std::io::Result<()> {
        let cpath = std::ffi::CString::new(path.as_os_str().as_bytes())
            .map_err(|_| std::io::Error::other("path contains NUL"))?;
        // SAFETY: cpath is a valid NUL-terminated C string for the duration of the call.
        let rc = unsafe { libc::chown(cpath.as_ptr(), uid, gid) };
        if rc == 0 {
            Ok(())
        } else {
            Err(std::io::Error::last_os_error())
        }
    }
}

#[cfg(not(unix))]
mod imp {
    use std::path::{Path, PathBuf};

    // Non-Unix has no uid/gid model. IPC peer identity is resolved differently
    // (the named-pipe daemon is per-user), and the root drop-to-user machinery
    // doesn't apply, so these are stubs: the daemon runs as the single logged-in
    // user. (`username_for_uid` is intentionally omitted: only the Unix peer-cred
    // path uses it.)
    pub fn home_dir_for(_user: &str) -> Option<PathBuf> {
        dirs::home_dir()
    }
    pub fn uid_gid_for(_user: &str) -> Option<(u32, u32)> {
        None
    }
    pub fn chown(_path: &Path, _uid: u32, _gid: u32) -> std::io::Result<()> {
        Ok(())
    }
}

pub use imp::*;

/// Best-effort machine hostname, sent to the backend so a local (stdio) server
/// can be approved for the specific host it lives on.
///
/// IMPORTANT: this must stay aligned with sealgate-stdiod's `config::hostname()`
/// (env `HOSTNAME`, then `COMPUTERNAME`, then the `hostname` command) so the
/// backend keys the *same* machine identity for both daemons. The command
/// fallback is what works on macOS, where `HOSTNAME` isn't exported to
/// launchd/user processes. On Windows `COMPUTERNAME` is always set and
/// short-circuits, so the GUI-subsystem daemon never spawns a console
/// `hostname`. Cross-platform, so it lives outside the cfg-split `imp`.
pub fn hostname() -> String {
    for var in ["HOSTNAME", "COMPUTERNAME"] {
        if let Ok(h) = std::env::var(var) {
            let trimmed = h.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
    }
    if let Ok(out) = std::process::Command::new("hostname").output()
        && let Ok(s) = String::from_utf8(out.stdout)
    {
        let trimmed = s.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    "unknown".to_string()
}
