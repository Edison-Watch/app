//! ChatGPT desktop app [`Agent`] — presence detection only.
//!
//! ChatGPT's MCP servers are **Connectors**: configured in the OpenAI account
//! and run server-side, so unlike every other agent here there is no local
//! config file. Presence alone is the signal — the app uses it to warn that
//! these connectors are outside SealGate's reach.
//!
//! With no config to fall back on, a wrong path fails silently: the app never
//! appears, and the user never learns their connectors are unprotected. Hence
//! the evidence attached to each path below.

use std::path::{Path, PathBuf};

use crate::agent::Agent;
use crate::error::Result;
use crate::types::DiscoveredServer;
use crate::watch::WatchTargets;

const CLIENT_NAME: &str = "chatgpt";

pub struct ChatGpt {
    /// Places the app can live; present when any one of them exists.
    candidates: Vec<PathBuf>,
}

impl ChatGpt {
    pub fn discover() -> Result<Self> {
        Ok(Self {
            candidates: default_app_paths(),
        })
    }

    /// Construct from explicit candidate paths (tests / non-standard installs).
    pub fn from_paths(candidates: Vec<PathBuf>) -> Self {
        Self { candidates }
    }
}

impl Agent for ChatGpt {
    fn name(&self) -> &'static str {
        CLIENT_NAME
    }

    fn is_installed(&self) -> bool {
        self.candidates
            .iter()
            .any(|p| p.exists() && is_openai_owned(p))
    }

    fn is_manageable(&self) -> bool {
        false
    }

    fn watch_targets(&self) -> WatchTargets {
        // No local file changes when a connector is added; watching the bundle
        // would only report ChatGPT's own updates.
        WatchTargets {
            files: Vec::new(),
            dirs: Vec::new(),
            needs_periodic_rescan: false,
        }
    }

    fn discover(&self) -> Result<Vec<DiscoveredServer>> {
        // Connectors live in the OpenAI account and cannot be enumerated from
        // here. Empty means "unknowable", not "none" — the wizard's
        // partially-supported section is what says so to the user.
        Ok(Vec::new())
    }

    // `sealgate_installs` / `hook_install` stay at their empty defaults: no local
    // surface to install into.
}

/// Prefix of every OpenAI desktop bundle id: `com.openai.codex` for the merged
/// app, `com.openai.chat` for the older one.
const OPENAI_BUNDLE_PREFIX: &[u8] = b"com.openai.";

/// Whether a candidate that exists really belongs to OpenAI.
///
/// Only `.app` bundles need vetting; the Windows package family names carry the
/// publisher hash, so only the real package can create those directories.
///
/// A substring search over the raw `Info.plist` rather than a plist parser: the
/// id is ASCII in both the XML and binary formats, and the `chatgpt` feature is
/// deliberately dependency-free (see Cargo.toml).
///
/// An unreadable plist falls back to the name, asymmetrically: `ChatGPT.app`
/// fails open because losing detection is the silent direction, `Codex.app`
/// fails closed because trusting it unread hands back the false positive this
/// check exists to stop.
fn is_openai_owned(path: &Path) -> bool {
    if path.extension().is_none_or(|e| e != "app") {
        return true;
    }
    match std::fs::read(path.join("Contents").join("Info.plist")) {
        Ok(bytes) => bytes
            .windows(OPENAI_BUNDLE_PREFIX.len())
            .any(|w| w == OPENAI_BUNDLE_PREFIX),
        Err(_) => path
            .file_name()
            .is_some_and(|n| SELF_EVIDENT_BUNDLES.iter().any(|b| n == *b)),
    }
}

/// Names carrying OpenAI's product name, distinctive enough to stand as
/// evidence on their own. `Codex.app` is deliberately absent — it is generic.
const SELF_EVIDENT_BUNDLES: [&str; 2] = ["ChatGPT.app", "ChatGPT Classic.app"];

/// Every bundle name OpenAI has shipped the macOS desktop app under.
///
/// `Codex.app` because the July 2026 merge folded Codex and ChatGPT into one
/// app *without* renaming existing installs; OpenAI's own detection probes the
/// same two names (`codex-rs/cli/src/desktop_app/mac.rs`). `ChatGPT Classic.app`
/// is an unconfirmed guess at the pre-merge app's current name, kept because a
/// wrong extra name costs one `stat` and a missing one costs detection.
/// (The Codex *CLI* is a separate, fully supported agent — `clients/codex.rs`.)
const MACOS_BUNDLES: [&str; 3] = ["ChatGPT.app", "Codex.app", "ChatGPT Classic.app"];

/// Package family names for the two Store apps, under `%LOCALAPPDATA%\Packages`.
/// The merged app kept the **Codex** package identity while branded ChatGPT,
/// which is why the first says nothing about ChatGPT.
const WINDOWS_PACKAGE_FAMILIES: [&str; 2] = [
    "OpenAI.Codex_2p2nqsd0c76g0",
    "OpenAI.ChatGPT-Desktop_2p2nqsd0c76g0",
];

/// Bundle paths to probe on macOS. `home` is absent when it cannot be resolved,
/// leaving only `/Applications`.
///
/// Takes its base directory as an argument, rather than reading it here, so the
/// probe list can be asserted on any platform — the CI matrix is Linux and
/// macOS, so a `#[cfg(windows)]` test would compile nowhere.
fn macos_candidates(home: Option<&Path>) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = MACOS_BUNDLES
        .iter()
        .map(|n| PathBuf::from("/Applications").join(n))
        .collect();
    if let Some(home) = home {
        out.extend(
            MACOS_BUNDLES
                .iter()
                .map(|n| home.join("Applications").join(n)),
        );
    }
    out
}

/// Paths to probe on Windows, given `%LOCALAPPDATA%`.
///
/// Store/MSIX only — no direct installer, so nothing ever lands in
/// `%LOCALAPPDATA%\Programs`, and the per-package data directory is the one
/// place an install leaves something readable without elevation. Not the
/// executable: it sits under `C:\Program Files\WindowsApps\`, whose ACLs deny
/// ordinary reads, and a denied read surfaces as `exists() == false`.
///
/// The `WindowsApps\ChatGPT.exe` probe is not expected to hit — that name is
/// the manifest's package-relative `Executable`, not a declared
/// `AppExecutionAlias` — but it costs one `stat`.
fn windows_candidates(local: &Path) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = WINDOWS_PACKAGE_FAMILIES
        .iter()
        .map(|fam| local.join("Packages").join(fam))
        .collect();
    out.push(
        local
            .join("Microsoft")
            .join("WindowsApps")
            .join("ChatGPT.exe"),
    );
    out
}

fn default_app_paths() -> Vec<PathBuf> {
    if cfg!(target_os = "macos") {
        macos_candidates(dirs::home_dir().as_deref())
    } else if cfg!(target_os = "windows") {
        dirs::data_local_dir()
            .map(|local| windows_candidates(&local))
            .unwrap_or_default()
    } else {
        // No official Linux desktop app — never detected.
        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn installed_when_any_candidate_exists() {
        let dir = tempdir().unwrap();
        let app = dir.path().join("ChatGPT.app");
        let missing = dir.path().join("ChatGPT Classic.app");

        assert!(!ChatGpt::from_paths(vec![app.clone(), missing.clone()]).is_installed());
        std::fs::create_dir(&app).unwrap();
        assert!(ChatGpt::from_paths(vec![app, missing]).is_installed());
    }

    /// Write a `.app` bundle whose `Info.plist` declares `bundle_id`.
    fn bundle_with_id(root: &std::path::Path, name: &str, bundle_id: &str) -> PathBuf {
        let app = root.join(name);
        std::fs::create_dir_all(app.join("Contents")).unwrap();
        std::fs::write(
            app.join("Contents").join("Info.plist"),
            format!(
                "<plist><dict><key>CFBundleIdentifier</key><string>{bundle_id}</string></dict></plist>"
            ),
        )
        .unwrap();
        app
    }

    #[test]
    fn a_codex_app_from_someone_else_is_not_chatgpt() {
        // Matching the name alone would warn that ChatGPT connectors are
        // unprotected on a machine with no ChatGPT.
        let dir = tempdir().unwrap();
        let theirs = bundle_with_id(dir.path(), "Codex.app", "com.example.codex");
        assert!(!ChatGpt::from_paths(vec![theirs]).is_installed());

        let dir = tempdir().unwrap();
        let openai = bundle_with_id(dir.path(), "Codex.app", "com.openai.codex");
        assert!(ChatGpt::from_paths(vec![openai]).is_installed());
    }

    #[test]
    fn an_unreadable_plist_is_decided_by_how_distinctive_the_name_is() {
        let dir = tempdir().unwrap();

        // Distinctive name: fail open, since losing detection is the direction
        // the user never sees and so never reports.
        let chatgpt = dir.path().join("ChatGPT.app");
        std::fs::create_dir(&chatgpt).unwrap();
        assert!(ChatGpt::from_paths(vec![chatgpt]).is_installed());

        // Generic name: fail closed, or the false positive comes back through a
        // permission error instead of a name match.
        let codex = dir.path().join("Codex.app");
        std::fs::create_dir(&codex).unwrap();
        assert!(!ChatGpt::from_paths(vec![codex]).is_installed());
    }

    #[test]
    fn a_windows_package_dir_needs_no_bundle_id() {
        // Only `.app` bundles are vetted — the family name carries the
        // publisher hash, so only the real package can create the directory.
        let dir = tempdir().unwrap();
        let pkg = dir.path().join("OpenAI.Codex_2p2nqsd0c76g0");
        std::fs::create_dir(&pkg).unwrap();
        assert!(ChatGpt::from_paths(vec![pkg]).is_installed());
    }

    #[test]
    fn discovers_nothing_and_is_not_an_install_target() {
        // If any of these ever returns something, the app has to stop calling
        // ChatGPT unmanageable.
        let dir = tempdir().unwrap();
        let app = dir.path().join("ChatGPT.app");
        std::fs::create_dir(&app).unwrap();
        let agent = ChatGpt::from_paths(vec![app]);

        assert!(agent.is_installed());
        assert!(!agent.is_manageable());
        assert!(agent.discover().unwrap().is_empty());
        assert!(agent.sealgate_installs(dir.path()).is_empty());
        assert!(agent.hook_install(dir.path()).is_none());
        assert!(agent.watch_targets().files.is_empty());
    }

    // The probe lists are the only real logic here, and they only fail
    // silently, so the next two tests run on every platform rather than under
    // `#[cfg(target_os = ...)]`.

    #[test]
    fn macos_probes_every_bundle_name_in_both_application_dirs() {
        let home = PathBuf::from("/Users/someone");
        let paths = macos_candidates(Some(&home));
        for name in MACOS_BUNDLES {
            assert!(
                paths.contains(&PathBuf::from("/Applications").join(name)),
                "{name} not probed in /Applications"
            );
            assert!(
                paths.contains(&home.join("Applications").join(name)),
                "{name} not probed in ~/Applications"
            );
        }
        // Named rather than left to the loop: dropping it from MACOS_BUNDLES
        // would silently stop detecting in-place Codex updates.
        assert!(paths.iter().any(|p| p.ends_with("Codex.app")));

        // Without a home dir, `/Applications` alone.
        assert_eq!(macos_candidates(None).len(), MACOS_BUNDLES.len());
    }

    #[test]
    fn windows_probes_both_store_package_dirs_and_the_alias() {
        let local = PathBuf::from("C:").join("Users").join("a").join("Local");
        let paths = windows_candidates(&local);
        for fam in WINDOWS_PACKAGE_FAMILIES {
            assert!(
                paths.contains(&local.join("Packages").join(fam)),
                "package family {fam} not probed"
            );
        }
        // Covered so that removing the alias fallback has to be deliberate.
        assert!(
            paths.contains(
                &local
                    .join("Microsoft")
                    .join("WindowsApps")
                    .join("ChatGPT.exe")
            )
        );
        // The path this file's bug was: a direct-installer location for an app
        // that ships Store-only, so detection could never fire.
        assert!(
            !paths
                .iter()
                .any(|p| p.ends_with(Path::new("Programs").join("ChatGPT").join("ChatGPT.exe")))
        );
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn macos_delegates_to_the_bundle_list() {
        assert!(
            default_app_paths()
                .iter()
                .any(|p| p.starts_with("/Applications"))
        );
    }

    #[test]
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    fn linux_probes_nothing_so_chatgpt_is_never_reported() {
        // No official Linux desktop app, so any hit is a permanent warning
        // about something the user cannot have installed.
        assert!(default_app_paths().is_empty());
        assert!(!ChatGpt::discover().unwrap().is_installed());
    }
}
