//! ChatGPT desktop app [`Agent`] — presence detection only.
//!
//! ChatGPT's MCP servers are **Connectors**: they are configured in the OpenAI
//! account and run server-side, so unlike every other agent here there is no
//! local config file. Nothing to watch, nothing to discover, and nowhere to
//! install the `edison-watch` entry.
//!
//! It is still worth reporting, because the app uses "is it installed?" to warn
//! the user that their ChatGPT connectors are outside Edison's reach — the same
//! bucket as the Claude hosts' connectors, minus even the local file those have
//! to fall back on. Detection therefore keys off *where the install itself puts
//! things*: an app bundle on macOS, a per-package data directory on Windows.
//!
//! Getting those paths wrong fails silently. There is no second signal to fall
//! back on, so a bad path just means the app never appears and the user never
//! learns their connectors are unprotected — and they cannot report a warning
//! they never saw. Every path here should carry its evidence.

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
        // No local config exists, so there is no file whose change could mean
        // "a connector was added". Watching the app bundle would only report
        // updates to ChatGPT itself.
        WatchTargets {
            files: Vec::new(),
            dirs: Vec::new(),
            needs_periodic_rescan: false,
        }
    }

    fn discover(&self) -> Result<Vec<DiscoveredServer>> {
        // Connectors live in the OpenAI account; the daemon cannot enumerate
        // them and must not imply "ChatGPT has no MCP servers" — the app says
        // so explicitly in the wizard's partially-supported section instead.
        Ok(Vec::new())
    }

    // `edison_installs` / `hook_install` stay at their empty defaults: there is
    // no local surface to install into, so ChatGPT is never an install target.
}

/// The prefix every OpenAI desktop build's bundle id starts with:
/// `com.openai.codex` for the merged app, `com.openai.chat` for the older one.
const OPENAI_BUNDLE_PREFIX: &[u8] = b"com.openai.";

/// Whether a candidate that exists really belongs to OpenAI.
///
/// Only `.app` bundles are checked. `Codex.app` is a name anyone can ship, and
/// matching on it alone is not a harmless over-detection: it puts a permanent
/// "your connectors are unprotected" row in front of someone who does not have
/// ChatGPT at all, about an app that has nothing to do with OpenAI. OpenAI's
/// own detection disambiguates by bundle id for the same reason. The Windows
/// package directories need no such check - their names carry the publisher
/// hash, so only the real package can create them.
///
/// A substring search over the raw `Info.plist` rather than a plist parser: the
/// id is stored as ASCII in both the XML and binary formats, and the `chatgpt`
/// feature is deliberately dependency-free (see Cargo.toml). The trade is that
/// a bundle merely *mentioning* an OpenAI id somewhere would pass, which lands
/// on the over-detect side, exactly where this started.
///
/// An unreadable or absent `Info.plist` also counts as a match. Losing
/// detection is the expensive direction - nobody reports a warning they never
/// saw - and a bundle without a readable `Info.plist` is odd enough that
/// trusting the name is the better guess.
fn is_openai_owned(path: &Path) -> bool {
    if path.extension().is_none_or(|e| e != "app") {
        return true;
    }
    match std::fs::read(path.join("Contents").join("Info.plist")) {
        Ok(bytes) => bytes
            .windows(OPENAI_BUNDLE_PREFIX.len())
            .any(|w| w == OPENAI_BUNDLE_PREFIX),
        Err(_) => true,
    }
}

/// Every bundle name OpenAI has shipped the macOS desktop app under.
///
/// `Codex.app` is here because the July 2026 merge folded Codex and ChatGPT
/// into one app *without* renaming an existing install: anyone who had Codex
/// and updated in place still has that bundle. OpenAI's own detection probes
/// the same two names (`codex-rs/cli/src/desktop_app/mac.rs`) and tells them
/// apart by bundle id.
///
/// `ChatGPT Classic.app` is a guess at what the pre-merge app is called now.
/// OpenAI's code never refers to it, so treat it as unconfirmed - kept because
/// a wrong extra name costs one `stat` while a missing one costs detection.
/// (The Codex *CLI* is a separate, fully supported agent - `clients/codex.rs`.)
const MACOS_BUNDLES: [&str; 3] = ["ChatGPT.app", "Codex.app", "ChatGPT Classic.app"];

/// Package family names for the two Store apps, under `%LOCALAPPDATA%\Packages`.
///
/// The merged app kept the **Codex** package identity while being branded
/// ChatGPT, which is why the first of these does not say "ChatGPT" anywhere.
/// Both carry the same publisher hash.
const WINDOWS_PACKAGE_FAMILIES: [&str; 2] = [
    "OpenAI.Codex_2p2nqsd0c76g0",
    "OpenAI.ChatGPT-Desktop_2p2nqsd0c76g0",
];

fn default_app_paths() -> Vec<PathBuf> {
    if cfg!(target_os = "macos") {
        let mut out: Vec<PathBuf> = MACOS_BUNDLES
            .iter()
            .map(|n| PathBuf::from("/Applications").join(n))
            .collect();
        if let Some(home) = dirs::home_dir() {
            out.extend(
                MACOS_BUNDLES
                    .iter()
                    .map(|n| home.join("Applications").join(n)),
            );
        }
        out
    } else if cfg!(target_os = "windows") {
        // Windows ships Store/MSIX only - there is no direct installer, so
        // nothing ever lands in `%LOCALAPPDATA%\Programs`. The per-package data
        // directory is the one place an MSIX install leaves something readable
        // without elevation.
        //
        // Deliberately NOT the executable. It lives at
        // `C:\Program Files\WindowsApps\<pkg>\app\ChatGPT.exe`, whose name
        // embeds a version and whose ACLs deny ordinary reads - and a denied
        // read surfaces as `Path::exists() == false`, which is the same silent
        // non-detection this is meant to fix.
        //
        // `%LOCALAPPDATA%\Microsoft\WindowsApps\ChatGPT.exe` stays as a third
        // probe, but it is not expected to hit: `ChatGPT.exe` is the manifest's
        // package-relative `Executable`, not a declared `AppExecutionAlias`, and
        // OpenAI's own check goes through the package identity rather than any
        // path (`codex-rs/cli/src/desktop_app/windows.rs`). Costs one `stat`.
        match dirs::data_local_dir() {
            Some(local) => {
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
            None => Vec::new(),
        }
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
        // `Codex.app` is a name anyone can ship. Matching it by name alone
        // would tell a user their ChatGPT connectors are unprotected when they
        // do not have ChatGPT, about an app unrelated to OpenAI.
        let dir = tempdir().unwrap();
        let theirs = bundle_with_id(dir.path(), "Codex.app", "com.example.codex");
        assert!(!ChatGpt::from_paths(vec![theirs]).is_installed());

        let dir = tempdir().unwrap();
        let openai = bundle_with_id(dir.path(), "Codex.app", "com.openai.codex");
        assert!(ChatGpt::from_paths(vec![openai]).is_installed());
    }

    #[test]
    fn a_bundle_with_no_readable_plist_is_still_reported() {
        // Fail open. Losing detection is the expensive direction here, because
        // the user only ever sees the absence of a warning and so never
        // reports it.
        let dir = tempdir().unwrap();
        let app = dir.path().join("ChatGPT.app");
        std::fs::create_dir(&app).unwrap();
        assert!(ChatGpt::from_paths(vec![app]).is_installed());
    }

    #[test]
    fn a_windows_package_dir_needs_no_bundle_id() {
        // Only `.app` bundles are vetted; the package family names carry the
        // publisher hash, so only the real package can create those.
        let dir = tempdir().unwrap();
        let pkg = dir.path().join("OpenAI.Codex_2p2nqsd0c76g0");
        std::fs::create_dir(&pkg).unwrap();
        assert!(ChatGpt::from_paths(vec![pkg]).is_installed());
    }

    #[test]
    fn discovers_nothing_and_is_not_an_install_target() {
        // The null-object contract the whole app-side design rests on: ChatGPT
        // is reported as present and nothing else. If any of these ever returns
        // something, the app has to stop calling it unmanageable.
        let dir = tempdir().unwrap();
        let app = dir.path().join("ChatGPT.app");
        std::fs::create_dir(&app).unwrap();
        let agent = ChatGpt::from_paths(vec![app]);

        assert!(agent.is_installed());
        assert!(!agent.is_manageable());
        assert!(agent.discover().unwrap().is_empty());
        assert!(agent.edison_installs(dir.path()).is_empty());
        assert!(agent.hook_install(dir.path()).is_none());
        assert!(agent.watch_targets().files.is_empty());
    }

    // `default_app_paths` is the only part of this file with real logic, and
    // the only way it can fail is silently: probe the wrong place and ChatGPT
    // is simply never detected, which no user reports because all they see is
    // the absence of a warning. The platform it runs on is the platform under
    // test - these run in CI on all three.

    #[test]
    #[cfg(target_os = "macos")]
    fn macos_probes_every_bundle_name_in_both_application_dirs() {
        let paths = default_app_paths();
        let ends_with = |name: &str| {
            paths
                .iter()
                .filter(|p| p.file_name().is_some_and(|f| f == name))
                .count()
        };
        // `/Applications` is unconditional; `~/Applications` needs a home dir,
        // which the code treats as optional - so the test does too. Asserting
        // more than the code promises fails on the code's own valid states.
        assert!(paths.iter().any(|p| p.starts_with("/Applications")));
        let per_dir = if dirs::home_dir().is_some() { 2 } else { 1 };
        for name in MACOS_BUNDLES {
            assert_eq!(ends_with(name), per_dir, "{name} not probed in every dir");
        }
        // Named explicitly rather than looping alone: an in-place Codex update
        // keeps this bundle name, and dropping it from the list would silently
        // stop detecting those users - exactly the failure this file exists to
        // avoid, and one nobody reports because they only see no warning.
        assert!(paths.iter().any(|p| p.ends_with("Codex.app")));
        if let Some(home) = dirs::home_dir() {
            assert!(
                paths
                    .iter()
                    .any(|p| p.starts_with(home.join("Applications")))
            );
        }
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn windows_probes_both_store_package_dirs() {
        let paths = default_app_paths();
        for fam in WINDOWS_PACKAGE_FAMILIES {
            assert!(
                paths.iter().any(|p| p.ends_with(fam)),
                "package family {fam} not probed"
            );
        }
        // The alias fallback is not expected to hit, but it is still a probe,
        // and dropping it silently is the same class of regression as the one
        // this file is about. Cover it so its removal has to be deliberate.
        assert!(
            paths
                .iter()
                .any(|p| p.ends_with("Microsoft\\WindowsApps\\ChatGPT.exe"))
        );
        // A regression guard, not decoration. The first version of this probed
        // `Programs\ChatGPT\ChatGPT.exe` for a direct installer that does not
        // exist - the app is Store-only - and asserted merely that the path was
        // *present* in the list, so the test passed while detection could never
        // fire. Assert the dead path stays gone.
        assert!(
            !paths
                .iter()
                .any(|p| p.ends_with("Programs\\ChatGPT\\ChatGPT.exe"))
        );
    }

    #[test]
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    fn linux_probes_nothing_so_chatgpt_is_never_reported() {
        // There is no official Linux desktop app. Detecting one would put an
        // unremovable "partially supported" warning in front of a user who
        // cannot possibly have it installed.
        assert!(default_app_paths().is_empty());
        assert!(!ChatGpt::discover().unwrap().is_installed());
    }
}
