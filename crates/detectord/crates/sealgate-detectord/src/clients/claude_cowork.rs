//! Claude Cowork [`Agent`]. Uses the same on-disk config as Claude
//! Desktop (`claude_desktop_config.json`, key `mcpServers`) but is only active
//! when a sibling `vm_bundles/` directory exists (Cowork's distinguishing
//! marker vs. plain Desktop).
//!
//! Sharing that file means sharing its limits: stdio entries only, so SealGate
//! installs nothing here either. See `claude_desktop.rs` for why the
//! `npx -y mcp-remote` bridge that used to paper over this is gone.

use std::path::PathBuf;

use crate::agent::Agent;
use crate::clients::common::parse_json_servers_map;
use crate::error::Result;
use crate::types::{DiscoveredServer, Scope, SourceKind};
use crate::watch::WatchTargets;

const CLIENT_NAME: &str = "claude_cowork";

pub struct ClaudeCowork {
    config: Option<PathBuf>,
}

impl ClaudeCowork {
    pub fn discover() -> Result<Self> {
        Ok(Self {
            config: default_config_path(),
        })
    }

    pub fn from_path(config: Option<PathBuf>) -> Self {
        Self { config }
    }

    /// Cowork is present only when a `vm_bundles/` dir sits beside the config.
    fn is_cowork(&self) -> bool {
        self.config
            .as_ref()
            .and_then(|p| p.parent())
            .map(|dir| dir.join("vm_bundles").is_dir())
            .unwrap_or(false)
    }
}

impl Agent for ClaudeCowork {
    fn name(&self) -> &'static str {
        CLIENT_NAME
    }

    fn is_installed(&self) -> bool {
        self.is_cowork() && self.config.as_ref().is_some_and(|p| p.exists())
    }

    fn watch_targets(&self) -> WatchTargets {
        WatchTargets {
            files: self.config.clone().into_iter().collect(),
            dirs: Vec::new(),
            needs_periodic_rescan: false,
        }
    }

    fn discover(&self) -> Result<Vec<DiscoveredServer>> {
        if !self.is_cowork() {
            return Ok(Vec::new());
        }
        Ok(match self.config.as_ref().filter(|p| p.exists()) {
            Some(p) => parse_json_servers_map(
                p,
                "mcpServers",
                CLIENT_NAME,
                Scope::Global,
                SourceKind::Json,
            ),
            None => Vec::new(),
        })
    }

    fn is_manageable(&self) -> bool {
        false
    }

    /// Only once Cowork is actually present. The file is Desktop's too, and
    /// claiming it while inert would show Desktop's servers under Cowork's name.
    fn config_path(&self, home: &std::path::Path) -> Option<PathBuf> {
        self.is_cowork().then(|| config_path_in(home)).flatten()
    }
}

fn default_config_path() -> Option<PathBuf> {
    config_path_in(&dirs::home_dir()?)
}

fn config_path_in(home: &std::path::Path) -> Option<PathBuf> {
    if cfg!(target_os = "macos") {
        Some(home.join("Library/Application Support/Claude/claude_desktop_config.json"))
    } else if cfg!(target_os = "windows") {
        dirs::config_dir().map(|c| c.join("Claude").join("claude_desktop_config.json"))
    } else {
        Some(home.join(".config/Claude/claude_desktop_config.json"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn active_only_with_vm_bundles_sibling() {
        let dir = tempdir().unwrap();
        let cfg = dir.path().join("claude_desktop_config.json");
        std::fs::write(&cfg, r#"{"mcpServers":{"c":{"command":"x"}}}"#).unwrap();

        // No vm_bundles/ → inert.
        assert!(
            ClaudeCowork::from_path(Some(cfg.clone()))
                .discover()
                .unwrap()
                .is_empty()
        );

        // With vm_bundles/ → discovers.
        std::fs::create_dir(dir.path().join("vm_bundles")).unwrap();
        let servers = ClaudeCowork::from_path(Some(cfg)).discover().unwrap();
        assert_eq!(servers.len(), 1);
        assert_eq!(servers[0].client, CLIENT_NAME);
    }

    #[test]
    fn reads_the_config_but_never_writes_to_it() {
        // Cowork shares Desktop's file, so it inherits the same limit. Being
        // active (vm_bundles/ present) is the case that used to install.
        let dir = tempdir().unwrap();
        let cfg = dir.path().join("claude_desktop_config.json");
        std::fs::write(&cfg, r#"{"mcpServers":{"c":{"command":"x"}}}"#).unwrap();
        std::fs::create_dir(dir.path().join("vm_bundles")).unwrap();
        let agent = ClaudeCowork::from_path(Some(cfg));

        assert!(!agent.discover().unwrap().is_empty());
        assert!(!agent.is_manageable());
        assert!(agent.sealgate_installs(dir.path()).is_empty());
    }
}
