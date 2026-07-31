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
//! to fall back on. Detection therefore keys off the *app bundle / executable*
//! rather than a config path.

use std::path::PathBuf;

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
        self.candidates.iter().any(|p| p.exists())
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

fn default_app_paths() -> Vec<PathBuf> {
    if cfg!(target_os = "macos") {
        // Both bundle names OpenAI has shipped the desktop app under. Probing
        // for both is cheap; picking wrong is not, because the failure is
        // silent - a user with ChatGPT installed just never sees the warning
        // and has nothing to report. (The Codex *CLI* is a separate, fully
        // supported agent - see `clients/codex.rs`.)
        const NAMES: [&str; 2] = ["ChatGPT.app", "ChatGPT Classic.app"];
        let mut out: Vec<PathBuf> = NAMES
            .iter()
            .map(|n| PathBuf::from("/Applications").join(n))
            .collect();
        if let Some(home) = dirs::home_dir() {
            out.extend(NAMES.iter().map(|n| home.join("Applications").join(n)));
        }
        out
    } else if cfg!(target_os = "windows") {
        // A Store install registers an app-execution alias under
        // `%LOCALAPPDATA%\Microsoft\WindowsApps`; `Programs` covers a direct
        // one. The alias is assumed to be named `ChatGPT.exe` (the MSIX
        // convention) - unverified against a real Windows install, and the
        // one line to change if detection turns out never to fire there.
        match dirs::data_local_dir() {
            Some(local) => vec![
                local
                    .join("Microsoft")
                    .join("WindowsApps")
                    .join("ChatGPT.exe"),
                local.join("Programs").join("ChatGPT").join("ChatGPT.exe"),
            ],
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
    fn macos_probes_both_bundles_in_both_application_dirs() {
        let paths = default_app_paths();
        let ends_with = |name: &str| {
            paths
                .iter()
                .filter(|p| p.file_name().is_some_and(|f| f == name))
                .count()
        };
        // Both names, under /Applications and ~/Applications.
        assert_eq!(ends_with("ChatGPT.app"), 2);
        assert_eq!(ends_with("ChatGPT Classic.app"), 2);
        assert!(paths.iter().any(|p| p.starts_with("/Applications")));
        let home = dirs::home_dir().expect("a home dir");
        assert!(
            paths
                .iter()
                .any(|p| p.starts_with(home.join("Applications")))
        );
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn windows_probes_the_store_alias_and_a_direct_install() {
        let paths = default_app_paths();
        assert!(
            paths
                .iter()
                .any(|p| p.ends_with("Microsoft\\WindowsApps\\ChatGPT.exe"))
        );
        assert!(
            paths
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
