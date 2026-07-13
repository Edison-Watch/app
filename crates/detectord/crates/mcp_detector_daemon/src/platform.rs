//! Privilege helpers used by the root build.
//!
//! When the daemon writes files into a user's home (the `disabled_<config>`
//! sidecar and the `.ew-backup`) it runs as root, so those new files are
//! root-owned. We `chown` them back to the owning user so they behave like the
//! user's own files. In-place config edits and dir renames preserve ownership,
//! so only the newly-created files need this.

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

/// Resolve an OS user name to its home dir via `getpwnam` (`pw_dir`). Used to
/// target the correct user's home when the root daemon writes installs/hooks.
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
