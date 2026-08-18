//! macOS TCC (Transparency, Consent and Control) helpers for the watcher.
//!
//! Watching a directory is not a neutral act on macOS. A non-recursive
//! FSEvents watch on `$HOME` reaches into `~/Desktop`, `~/Documents` and
//! `~/Downloads`, which are three separate TCC services - so the user gets
//! three near-identical "allow access" dialogs, and another one for every
//! protected folder Apple adds later.
//!
//! `$HOME` is not an unusual thing for us to watch, either: it is the parent of
//! `~/.claude.json`, so every Claude Code user gets it. See
//! [`crate::watcher::Watcher`], which watches the PARENT directory of each
//! config file.
//!
//! Full Disk Access supersedes all three services, so the daemon asks for that
//! instead - one grant, and it keeps working as the watch set grows. Until it
//! is granted the watcher defers the protected directories rather than
//! prompting; reading a file that sits directly in `$HOME` is unaffected, so
//! detection degrades to the reconcile loop's periodic rescan instead of
//! stopping.
//!
//! There is no API to REQUEST Full Disk Access - no prompt exists. It is
//! granted by hand in System Settings -> Privacy & Security -> Full Disk
//! Access, which the desktop app links to.
//!
//! NOTE: a grant is only durable if the binary has a valid code signature with
//! a designated requirement. A `lipo`-merged universal Mach-O whose x86_64
//! slice is unsigned has none, and tccd writes grants against it that it can
//! never re-verify - so the dialogs repeat forever no matter how often the user
//! clicks Allow.

use std::path::{Path, PathBuf};

/// Whether this process holds macOS Full Disk Access; `None` off macOS.
///
/// The probe is TCC's own database: nothing but Full Disk Access grants read
/// access to it, and attempting the read never raises a prompt of its own - an
/// un-granted process simply gets EPERM. `None` means "not applicable", never
/// "unknown"; the read either succeeds or it does not.
pub fn has_full_disk_access() -> Option<bool> {
    #[cfg(target_os = "macos")]
    {
        let home = dirs::home_dir()?;
        let probe = home.join("Library/Application Support/com.apple.TCC/TCC.db");
        Some(std::fs::File::open(probe).is_ok())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = dirs::home_dir();
        None
    }
}

/// The directories whose contents are gated by a per-folder TCC service.
///
/// Deliberately NOT exhaustive over everything TCC covers. `~/Library/
/// Application Support/<other app>` is gated too (kTCCServiceSystemPolicyAppData),
/// and that is where Claude Desktop, Cursor and VSCode keep their configs - but
/// deferring those would disable most of the detector for anyone without Full
/// Disk Access, a far worse outcome than an occasional prompt. Only the folders
/// that the `$HOME` watch actually trips over are listed here.
#[cfg(target_os = "macos")]
fn protected_roots(home: &Path) -> [PathBuf; 3] {
    [
        home.join("Desktop"),
        home.join("Documents"),
        home.join("Downloads"),
    ]
}

/// Whether watching `dir` needs Full Disk Access to avoid per-folder prompts.
///
/// True for `$HOME` itself (an FSEvents watch there reaches the protected
/// children) and for the protected folders directly. Always false off macOS.
pub fn watch_needs_full_disk_access(dir: &Path) -> bool {
    #[cfg(target_os = "macos")]
    {
        let Some(home) = dirs::home_dir() else {
            return false;
        };
        if dir == home {
            return true;
        }
        protected_roots(&home)
            .iter()
            .any(|root| dir == root || dir.starts_with(root))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = dir;
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn non_protected_directories_are_watchable() {
        let home = dirs::home_dir().expect("home");
        assert!(!watch_needs_full_disk_access(&home.join(".codex")));
        assert!(!watch_needs_full_disk_access(&home.join(".cursor")));
        assert!(!watch_needs_full_disk_access(&home.join(".sealgate")));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn home_and_protected_folders_need_full_disk_access() {
        let home = dirs::home_dir().expect("home");
        // $HOME is the parent of ~/.claude.json, so this is the case that
        // actually fires for every Claude Code user.
        assert!(watch_needs_full_disk_access(&home));
        assert!(watch_needs_full_disk_access(&home.join("Documents")));
        assert!(watch_needs_full_disk_access(&home.join("Desktop")));
        assert!(watch_needs_full_disk_access(&home.join("Downloads")));
        // Nested project directories inherit the parent folder's service.
        assert!(watch_needs_full_disk_access(
            &home.join("Documents/work/app")
        ));
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn nothing_is_gated_off_macos() {
        let home = dirs::home_dir().expect("home");
        assert!(!watch_needs_full_disk_access(&home));
        assert!(!watch_needs_full_disk_access(&home.join("Documents")));
    }
}
