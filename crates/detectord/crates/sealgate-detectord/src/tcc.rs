//! macOS TCC (Transparency, Consent and Control) helpers for the watcher.
//!
//! Watching a directory is not a neutral act on macOS. An FSEvents stream is
//! recursive at the API level whatever [`notify::RecursiveMode`] says, so a
//! watch on `$HOME` reaches into `~/Desktop`, `~/Documents` and `~/Downloads` -
//! three separate TCC services, hence three near-identical "allow access"
//! dialogs, and another for every protected folder Apple adds later.
//!
//! The daemon does NOT ask for Full Disk Access to get around that. FDA is a
//! broad, hand-granted permission over the entire disk, while the actual need
//! is small and fixed: a known set of agent config files. So rather than
//! widening the grant to fit the watch, we narrow the watch to fit what we can
//! already read:
//!
//! * **The protected roots are never watched.** Nothing we look for lives in
//!   Desktop, Documents or Downloads. [`is_tcc_protected`] exists to stop a
//!   future agent from quietly adding a target under one and bringing the
//!   dialogs back.
//! * **`$HOME` itself is never watched.** It was only ever in the set as the
//!   parent of `~/.claude.json` - the watcher watches each config file's PARENT
//!   directory, because editors write via atomic rename. That single file is
//!   watched as a leaf path instead (see [`watch_path_for_file`]); a stream
//!   rooted at the file reaches none of its protected siblings.
//!
//! Every other target already lives in a subdirectory - `~/.claude/`,
//! `~/.codex/`, `~/.cursor/`, `~/.config/...`, `~/Library/Application
//! Support/...` - and none of those are protected roots.
//!
//! `~/Library/Application Support/<other app>` is gated by its own service
//! (kTCCServiceSystemPolicyAppData), and is where Claude Desktop, Cursor and
//! VSCode keep their configs. It is watched anyway: skipping it would disable
//! most of the detector, which is far worse than a single App Data prompt.
//!
//! [`has_full_disk_access`] is kept for diagnostics only - it is surfaced in
//! the daemon status, and no watch decision consults it.

use std::path::{Path, PathBuf};

/// Whether this process holds macOS Full Disk Access; `None` off macOS.
///
/// Diagnostic only - nothing gates on it. The probe is TCC's own database:
/// nothing but Full Disk Access grants read access to it, and attempting the
/// read never raises a prompt of its own - an un-granted process simply gets
/// EPERM. `None` means "not applicable", never "unknown"; the read either
/// succeeds or it does not.
pub fn has_full_disk_access() -> Option<bool> {
    #[cfg(target_os = "macos")]
    {
        let home = dirs::home_dir()?;
        let probe = home.join("Library/Application Support/com.apple.TCC/TCC.db");
        Some(std::fs::File::open(probe).is_ok())
    }
    #[cfg(not(target_os = "macos"))]
    {
        None
    }
}

/// The directories whose contents are gated by a per-folder TCC service.
///
/// Deliberately NOT exhaustive over everything TCC covers - see the module
/// docs on `~/Library/Application Support`, which is gated and watched anyway.
/// These are the three that a watch would prompt for without any of our
/// targets being inside them.
#[cfg(target_os = "macos")]
fn protected_roots(home: &Path) -> [PathBuf; 3] {
    [
        home.join("Desktop"),
        home.join("Documents"),
        home.join("Downloads"),
    ]
}

/// Whether watching `dir` would raise a per-folder TCC prompt.
///
/// True for `~/Desktop`, `~/Documents`, `~/Downloads` and anything beneath
/// them. Notably FALSE for `$HOME` itself: `$HOME` is not watched at all (see
/// [`watch_path_for_file`]), so it never reaches this check, and calling it
/// protected would wrongly suppress a caller that legitimately wants to know
/// about the folders themselves. Always false off macOS.
pub fn is_tcc_protected(dir: &Path) -> bool {
    #[cfg(target_os = "macos")]
    {
        let Some(home) = dirs::home_dir() else {
            return false;
        };
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

/// The path to watch in order to observe changes to the config file `file`.
///
/// Normally the parent directory: editors write via atomic rename, which
/// replaces the file, and a watch on the file alone can miss that (on Linux
/// inotify the watch is dropped outright).
///
/// The exception is a file sitting directly in `$HOME` on macOS - in practice
/// only `~/.claude.json`. Watching `$HOME` would pull the protected roots into
/// an FSEvents stream and prompt three times, so the file is watched as a leaf
/// instead. FSEvents is path-based and notify sets
/// `kFSEventStreamCreateFlagFileEvents`, so a replaced file at the same path
/// still reports; and the reconcile loop's periodic rescan is the backstop if
/// it ever does not.
pub fn watch_path_for_file(file: &Path) -> Option<PathBuf> {
    let parent = file.parent()?;
    #[cfg(target_os = "macos")]
    {
        if dirs::home_dir().is_some_and(|home| parent == home) {
            return Some(file.to_path_buf());
        }
    }
    Some(parent.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ordinary_config_directories_are_not_protected() {
        let home = dirs::home_dir().expect("home");
        assert!(!is_tcc_protected(&home.join(".codex")));
        assert!(!is_tcc_protected(&home.join(".cursor")));
        assert!(!is_tcc_protected(&home.join(".sealgate")));
        // Gated by the App Data service, but watched regardless - see module
        // docs. `is_tcc_protected` covers only the three folder services.
        assert!(!is_tcc_protected(
            &home.join("Library/Application Support/Claude")
        ));
    }

    /// $HOME must NOT be reported protected: it is excluded from the watch set
    /// by `watch_path_for_file`, not by this check.
    #[test]
    fn home_itself_is_not_protected() {
        let home = dirs::home_dir().expect("home");
        assert!(!is_tcc_protected(&home));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn the_three_folder_services_are_protected() {
        let home = dirs::home_dir().expect("home");
        assert!(is_tcc_protected(&home.join("Desktop")));
        assert!(is_tcc_protected(&home.join("Documents")));
        assert!(is_tcc_protected(&home.join("Downloads")));
        // Nested project directories inherit the parent folder's service.
        assert!(is_tcc_protected(&home.join("Documents/work/app")));
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn nothing_is_gated_off_macos() {
        let home = dirs::home_dir().expect("home");
        assert!(!is_tcc_protected(&home.join("Documents")));
    }

    #[test]
    fn a_file_in_a_subdirectory_is_watched_via_its_parent() {
        let home = dirs::home_dir().expect("home");
        let cfg = home.join(".codex/config.toml");
        assert_eq!(watch_path_for_file(&cfg), Some(home.join(".codex")));
    }

    /// The case the whole module exists for: `~/.claude.json` must never put
    /// `$HOME` in the watch set.
    #[cfg(target_os = "macos")]
    #[test]
    fn a_file_directly_in_home_is_watched_as_a_leaf() {
        let home = dirs::home_dir().expect("home");
        let cfg = home.join(".claude.json");
        assert_eq!(watch_path_for_file(&cfg), Some(cfg.clone()));
        assert_ne!(watch_path_for_file(&cfg), Some(home));
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn home_level_files_still_use_the_parent_off_macos() {
        let home = dirs::home_dir().expect("home");
        let cfg = home.join(".claude.json");
        assert_eq!(watch_path_for_file(&cfg), Some(home));
    }
}
