//! Claude Desktop [`Agent`](crate::Agent) — a single user-level JSON config,
//! `claude_desktop_config.json`, key `mcpServers`.

use std::path::PathBuf;

use crate::agent::Agent;
use crate::clients::common::parse_json_servers_map;
use crate::error::Result;
use crate::types::{DiscoveredServer, EdisonInstall, EdisonStyle, Scope, SourceKind};
use crate::watch::WatchTargets;

const CLIENT_NAME: &str = "claude_desktop";

pub struct ClaudeDesktop {
    config: Option<PathBuf>,
}

impl ClaudeDesktop {
    pub fn discover() -> Result<Self> {
        Ok(Self {
            config: default_config_path(),
        })
    }

    /// Construct from an explicit config path (tests / non-standard installs).
    pub fn from_path(config: Option<PathBuf>) -> Self {
        Self { config }
    }
}

impl Agent for ClaudeDesktop {
    fn name(&self) -> &'static str {
        CLIENT_NAME
    }

    fn is_installed(&self) -> bool {
        self.config.as_ref().is_some_and(|p| p.exists())
    }

    fn watch_targets(&self) -> WatchTargets {
        WatchTargets {
            files: self.config.clone().into_iter().collect(),
            dirs: Vec::new(),
            needs_periodic_rescan: false,
        }
    }

    fn discover(&self) -> Result<Vec<DiscoveredServer>> {
        Ok(match self.config.as_ref().filter(|p| p.exists()) {
            Some(p) => {
                parse_json_servers_map(p, "mcpServers", CLIENT_NAME, Scope::Global, SourceKind::Json)
            }
            None => Vec::new(),
        })
    }

    fn edison_installs(&self, home: &std::path::Path) -> Vec<EdisonInstall> {
        // Desktop is stdio-only → mcp-remote shim.
        config_path_in(home)
            .map(|path| EdisonInstall {
                path,
                key_path: vec!["mcpServers".into()],
                style: EdisonStyle::StdioShim,
                client_id: "claude-desktop".into(),
                prefer_cli: false,
            })
            .into_iter()
            .collect()
    }
}

fn default_config_path() -> Option<PathBuf> {
    config_path_in(&dirs::home_dir()?)
}

/// The `claude_desktop_config.json` path under `home` (platform-specific).
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
    use crate::types::Transport;
    use tempfile::tempdir;

    #[test]
    fn parses_servers() {
        let dir = tempdir().unwrap();
        let cfg = dir.path().join("claude_desktop_config.json");
        std::fs::write(
            &cfg,
            r#"{"mcpServers":{"fs":{"command":"npx","args":["srv"]},"remote":{"url":"https://x"}}}"#,
        )
        .unwrap();

        let servers = ClaudeDesktop::from_path(Some(cfg)).discover().unwrap();
        assert_eq!(servers.len(), 2);
        let by: std::collections::BTreeMap<_, _> =
            servers.iter().map(|s| (s.name.clone(), s)).collect();
        assert_eq!(by["fs"].transport, Transport::Stdio);
        assert_eq!(by["remote"].transport, Transport::Remote);
        assert_eq!(by["fs"].client, CLIENT_NAME);
    }

    #[test]
    fn tolerates_missing() {
        assert!(
            ClaudeDesktop::from_path(Some(PathBuf::from("/nope/x.json")))
                .discover()
                .unwrap()
                .is_empty()
        );
    }
}
