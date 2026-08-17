//! Zed [`Agent`] — a single JSON settings file whose MCP servers
//! live under the top-level `context_servers` key.

use std::path::{Path, PathBuf};

use crate::agent::Agent;
use crate::clients::common::parse_json_servers_map;
use crate::error::Result;
use crate::types::{DiscoveredServer, SealGateInstall, SealGateStyle, Scope, SourceKind};
use crate::watch::WatchTargets;

const CLIENT_NAME: &str = "zed";
const SERVERS_KEY: &str = "context_servers";

pub struct Zed {
    config: Option<PathBuf>,
}

impl Zed {
    pub fn discover() -> Result<Self> {
        Ok(Self {
            config: default_config_path(),
        })
    }

    pub fn from_path(config: Option<PathBuf>) -> Self {
        Self { config }
    }
}

impl Agent for Zed {
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
                parse_json_servers_map(p, SERVERS_KEY, CLIENT_NAME, Scope::Global, SourceKind::Json)
            }
            None => Vec::new(),
        })
    }

    fn sealgate_installs(&self, home: &Path) -> Vec<SealGateInstall> {
        // Note: install writes the nested `assistant.mcp_servers` (matching the
        // app), even though discovery reads the top-level `context_servers`.
        vec![SealGateInstall {
            path: home.join(".config/zed/settings.json"),
            key_path: vec!["assistant".into(), "mcp_servers".into()],
            style: SealGateStyle::Http,
            client_id: "zed".into(),
            prefer_cli: false,
        }]
    }
}

fn default_config_path() -> Option<PathBuf> {
    if cfg!(target_os = "windows") {
        dirs::config_dir().map(|c| c.join("Zed").join("settings.json"))
    } else {
        // macOS + Linux both use ~/.config/zed/settings.json.
        dirs::home_dir().map(|h| h.join(".config/zed/settings.json"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn parses_context_servers() {
        let dir = tempdir().unwrap();
        let cfg = dir.path().join("settings.json");
        std::fs::write(
            &cfg,
            r#"{"context_servers":{"z":{"command":"zsrv"}},"other":1}"#,
        )
        .unwrap();
        let servers = Zed::from_path(Some(cfg)).discover().unwrap();
        assert_eq!(servers.len(), 1);
        assert_eq!(servers[0].name, "z");
    }
}
