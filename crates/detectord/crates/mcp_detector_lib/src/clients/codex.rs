//! Codex CLI [`Agent`](crate::Agent) — `~/.codex/config.toml` (TOML), servers
//! under the `[mcp_servers]` table.
//!
//! (client_2 stubs Codex discovery; we actually parse the table.)

use std::path::PathBuf;

use crate::agent::Agent;
use crate::clients::common::servers_from_map;
use crate::error::Result;
use crate::types::{
    DiscoveredServer, EdisonInstall, EdisonStyle, HookBinding, HookInstall, HookScriptKind,
    HookStyle, Scope, SourceKind,
};
use crate::watch::WatchTargets;

const CLIENT_NAME: &str = "codex";
const SERVERS_KEY: &str = "mcp_servers";

pub struct Codex {
    config: Option<PathBuf>,
}

impl Codex {
    pub fn discover() -> Result<Self> {
        Ok(Self {
            config: dirs::home_dir().map(|h| h.join(".codex/config.toml")),
        })
    }

    pub fn from_path(config: Option<PathBuf>) -> Self {
        Self { config }
    }
}

impl Agent for Codex {
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
            Some(p) => parse_codex_toml(p),
            None => Vec::new(),
        })
    }

    fn edison_installs(&self, home: &std::path::Path) -> Vec<EdisonInstall> {
        vec![EdisonInstall {
            path: home.join(".codex/config.toml"),
            key_path: vec![SERVERS_KEY.into()],
            style: EdisonStyle::Toml,
            client_id: "codex".into(),
            prefer_cli: false,
        }]
    }

    fn hook_install(&self, home: &std::path::Path) -> Option<HookInstall> {
        // Codex has no PreToolUse surface — registration + session-end only.
        Some(HookInstall {
            path: home.join(".codex/config.toml"),
            style: HookStyle::CodexToml,
            client_id: "codex".into(),
            events: vec![
                HookBinding::new("SessionStart", None, HookScriptKind::Registration, true),
                HookBinding::new("Stop", None, HookScriptKind::SessionEnd, false),
            ],
        })
    }
}

/// Parse `config.toml` and map the `[mcp_servers]` table. The TOML is converted
/// to a JSON value so the shared [`servers_from_map`] logic applies.
fn parse_codex_toml(path: &std::path::Path) -> Vec<DiscoveredServer> {
    let text = match std::fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) => {
            tracing::debug!(file = %path.display(), error = %e, "read failed");
            return Vec::new();
        }
    };
    let toml_val: toml::Value = match toml::from_str(&text) {
        Ok(v) => v,
        Err(e) => {
            tracing::debug!(file = %path.display(), error = %e, "toml parse failed");
            return Vec::new();
        }
    };
    let json = match serde_json::to_value(&toml_val) {
        Ok(j) => j,
        Err(e) => {
            tracing::debug!(file = %path.display(), error = %e, "toml->json failed");
            return Vec::new();
        }
    };
    servers_from_map(
        &json,
        SERVERS_KEY,
        CLIENT_NAME,
        Scope::Global,
        SourceKind::Toml,
        path,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn parses_mcp_servers_table() {
        let dir = tempdir().unwrap();
        let cfg = dir.path().join("config.toml");
        std::fs::write(
            &cfg,
            r#"
model = "gpt-5"

[mcp_servers.docs]
command = "npx"
args = ["-y", "docs-mcp"]

[mcp_servers.docs.env]
TOKEN = "x"

[mcp_servers.remote]
url = "https://mcp.example/sse"
"#,
        )
        .unwrap();

        let servers = Codex::from_path(Some(cfg)).discover().unwrap();
        assert_eq!(servers.len(), 2);
        let by: std::collections::BTreeMap<_, _> =
            servers.iter().map(|s| (s.name.clone(), s)).collect();
        assert!(by.contains_key("docs"));
        assert!(by.contains_key("remote"));
        assert_eq!(by["docs"].location.kind, SourceKind::Toml);
    }

    #[test]
    fn tolerates_missing_and_no_table() {
        let dir = tempdir().unwrap();
        let cfg = dir.path().join("config.toml");
        std::fs::write(&cfg, "model = \"x\"\n").unwrap();
        assert!(Codex::from_path(Some(cfg)).discover().unwrap().is_empty());
    }
}
