//! Where the daemon keeps its state.
//!
//! The base is **mode-aware**: a root-owned system location when running as the
//! privileged daemon, or the invoking user's config dir in the dev build. State
//! is multi-user — enrollments are keyed by OS user and per-user state lives
//! under `users/<name>/` — so the same layout works for one dev user or many
//! real users under root.
//!
//! ```text
//! <base>/enrollments.json        keyed by OS user
//! <base>/users/<name>/seen.json
//! <base>/users/<name>/quarantined.json
//! <base>/state.json              status + liveness
//! ```

use std::io;
use std::path::PathBuf;

const DIR_NAME: &str = "edison-watch-detectord";

/// True when running as the privileged system daemon (euid 0). Always false on
/// non-Unix targets, which have no root/euid model.
pub fn is_root() -> bool {
    #[cfg(unix)]
    {
        // SAFETY: geteuid has no preconditions and no failure mode.
        unsafe { geteuid() == 0 }
    }
    #[cfg(not(unix))]
    {
        false
    }
}

/// Root of all daemon state: system-level under root, the user's config dir
/// otherwise (dev build).
pub fn base_dir() -> PathBuf {
    if is_root() {
        PathBuf::from("/Library/Application Support").join(DIR_NAME)
    } else {
        dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(DIR_NAME)
    }
}

/// The multi-user enrollment map (`{ os_user: Enrollment }`).
pub fn enrollments_path() -> PathBuf {
    base_dir().join("enrollments.json")
}

/// Per-OS-user state directory.
pub fn user_dir(user: &str) -> PathBuf {
    base_dir().join("users").join(user)
}

pub fn seen_store_path(user: &str) -> PathBuf {
    user_dir(user).join("seen.json")
}

pub fn quarantined_path(user: &str) -> PathBuf {
    user_dir(user).join("quarantined.json")
}

#[allow(dead_code)] // written by the status/liveness reporter (next sub-part)
pub fn state_json_path() -> PathBuf {
    base_dir().join("state.json")
}

pub fn ensure_base_dir() -> io::Result<()> {
    std::fs::create_dir_all(base_dir())
}

pub fn ensure_user_dir(user: &str) -> io::Result<()> {
    std::fs::create_dir_all(user_dir(user))
}

/// The OS user this process is running as — the dev build's single tenant.
/// (Under root, per-connection users come from `getpeereid`, not this.)
pub fn current_username() -> String {
    std::env::var("USER")
        .or_else(|_| std::env::var("LOGNAME"))
        .or_else(|_| std::env::var("USERNAME")) // Windows
        .unwrap_or_else(|_| "unknown".to_string())
}

/// `~/.edison-watch` — where hook scripts and the pending/errors dirs live
/// (shared, app-compatible location). Dev build: the current user's home.
pub fn edison_watch_dir() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".edison-watch"))
}

#[cfg(unix)]
unsafe extern "C" {
    fn geteuid() -> u32;
}
