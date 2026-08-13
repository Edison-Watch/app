//! Claude Desktop [`Agent`] — a single user-level JSON config,
//! `claude_desktop_config.json`, key `mcpServers`.
//!
//! Discovery only: the servers in that file are read, but Edison installs
//! nothing into it. The file accepts stdio entries alone — a remote MCP server
//! reaches Claude Desktop through Settings → Connectors, which is a hand-driven
//! flow with no config-file equivalent. Edison used to bridge the gap by
//! writing `npx -y mcp-remote <url>`, which made every launch of Claude Desktop
//! fetch an unpinned package from npm and pass the secret key in `argv`.
//!
//! So this host is [`Agent::is_manageable`] `false`, like ChatGPT: present,
//! read, and reported as something the user has to connect themselves.

use std::path::PathBuf;

use crate::agent::Agent;
use crate::clients::common::parse_json_servers_map;
use crate::error::Result;
use crate::types::{DiscoveredServer, Scope, SourceKind};
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

    /// Overridden because the default derives it from `edison_installs`, which
    /// is empty here — and this file is read on every scan.
    fn config_path(&self, home: &std::path::Path) -> Option<PathBuf> {
        config_path_in(home)
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
    fn reads_the_config_but_never_writes_to_it() {
        // Discovery and installation are separate capabilities, and this host
        // has only the first. Returning an install target would put back the
        // `npx -y mcp-remote` entry the daemon's purge exists to take out - the
        // two would fight on every app start.
        let dir = tempdir().unwrap();
        let cfg = dir.path().join("claude_desktop_config.json");
        std::fs::write(&cfg, r#"{"mcpServers":{"fs":{"command":"npx"}}}"#).unwrap();
        let agent = ClaudeDesktop::from_path(Some(cfg));

        assert!(!agent.discover().unwrap().is_empty());
        assert!(!agent.is_manageable());
        assert!(agent.edison_installs(dir.path()).is_empty());
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
