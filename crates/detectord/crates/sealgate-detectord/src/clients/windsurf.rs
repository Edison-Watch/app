//! Windsurf [`Agent`] — a single user-level JSON config,
//! `~/.codeium/windsurf/mcp_config.json` (same on all platforms), key
//! `mcpServers`.

use std::path::PathBuf;

use crate::agent::Agent;
use crate::clients::common::parse_json_servers_map;
use crate::error::Result;
use crate::types::{DiscoveredServer, SealGateInstall, SealGateStyle, Scope, SourceKind};
use crate::watch::WatchTargets;

const CLIENT_NAME: &str = "windsurf";

pub struct Windsurf {
    config: Option<PathBuf>,
}

impl Windsurf {
    pub fn discover() -> Result<Self> {
        Ok(Self {
            config: dirs::home_dir().map(|h| h.join(".codeium/windsurf/mcp_config.json")),
        })
    }

    pub fn from_path(config: Option<PathBuf>) -> Self {
        Self { config }
    }
}

impl Agent for Windsurf {
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

    fn sealgate_installs(&self, home: &std::path::Path) -> Vec<SealGateInstall> {
        vec![SealGateInstall {
            path: home.join(".codeium/windsurf/mcp_config.json"),
            key_path: vec!["mcpServers".into()],
            style: SealGateStyle::Http,
            client_id: "windsurf".into(),
            prefer_cli: false,
        }]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn parses_servers() {
        let dir = tempdir().unwrap();
        let cfg = dir.path().join("mcp_config.json");
        std::fs::write(&cfg, r#"{"mcpServers":{"a":{"command":"x"}}}"#).unwrap();
        let servers = Windsurf::from_path(Some(cfg)).discover().unwrap();
        assert_eq!(servers.len(), 1);
        assert_eq!(servers[0].name, "a");
        assert_eq!(servers[0].client, CLIENT_NAME);
    }
}
