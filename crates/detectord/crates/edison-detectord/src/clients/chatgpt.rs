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
        // Post-2026 Codex↔ChatGPT merger: the unified Chat + Work + Codex app
        // ships as `ChatGPT.app`; the older standalone chat app is
        // `ChatGPT Classic.app`. (The Codex *CLI* is a separate, fully
        // supported agent — see `clients/codex.rs`.)
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
        // Shipped through the Microsoft Store (product id 9NT1R1C2HH7J), which
        // registers a `ChatGPT.exe` app-execution alias under
        // `%LOCALAPPDATA%\Microsoft\WindowsApps`. The `Programs` path covers a
        // direct (non-Store) install.
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
    fn is_usable_as_a_shared_trait_object() {
        // How the daemon holds it: `Vec<Arc<dyn Agent>>`, shared across the
        // watcher's threads. Compile-time check that nothing here broke `Send`.
        let agent: std::sync::Arc<dyn Agent> =
            std::sync::Arc::new(ChatGpt::discover().expect("infallible"));
        assert_eq!(agent.name(), CLIENT_NAME);
    }

    #[test]
    fn never_installed_without_candidates() {
        // The Linux case: no official desktop app, so no paths to probe.
        assert!(!ChatGpt::from_paths(Vec::new()).is_installed());
    }

    #[test]
    fn discovers_nothing_and_is_not_an_install_target() {
        let dir = tempdir().unwrap();
        let app = dir.path().join("ChatGPT.app");
        std::fs::create_dir(&app).unwrap();
        let agent = ChatGpt::from_paths(vec![app]);

        assert!(agent.is_installed());
        assert!(agent.discover().unwrap().is_empty());
        assert!(agent.edison_installs(dir.path()).is_empty());
        assert!(agent.hook_install(dir.path()).is_none());
        assert!(agent.watch_targets().files.is_empty());
    }
}
