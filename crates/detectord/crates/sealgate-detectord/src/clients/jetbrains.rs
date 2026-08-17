//! JetBrains IDEs [`Agent`] — IntelliJ IDEA, PyCharm, WebStorm.
//!
//! Each IDE stores MCP servers in `<JetBrainsBase>/<IDEFolder>/mcp/servers.json`
//! (JSON, key `mcpServers`). The base dir holds version-suffixed folders (e.g.
//! `IntelliJIdea2024.3`); every folder matching the IDE's prefix contributes a
//! config. Linux has no JetBrains base and yields nothing.

use std::path::{Path, PathBuf};

use crate::agent::Agent;
use crate::clients::common::parse_json_servers_map;
use crate::error::Result;
use crate::types::{DiscoveredServer, Scope, SealGateInstall, SealGateStyle, SourceKind};
use crate::watch::WatchTargets;

/// One JetBrains IDE family.
pub struct JetBrains {
    client_name: &'static str,
    folder_prefix: &'static str,
    config_files: Vec<PathBuf>,
}

impl JetBrains {
    pub fn intellij() -> Result<Self> {
        Ok(Self::from_base("intellij", "IntelliJIdea"))
    }

    pub fn pycharm() -> Result<Self> {
        Ok(Self::from_base("pycharm", "PyCharm"))
    }

    pub fn webstorm() -> Result<Self> {
        Ok(Self::from_base("webstorm", "WebStorm"))
    }

    fn from_base(client_name: &'static str, folder_prefix: &'static str) -> Self {
        let config_files = jetbrains_base()
            .map(|base| enumerate(&base, folder_prefix))
            .unwrap_or_default();
        Self {
            client_name,
            folder_prefix,
            config_files,
        }
    }

    /// Construct from explicit `servers.json` paths (tests).
    pub fn from_files(client_name: &'static str, config_files: Vec<PathBuf>) -> Self {
        Self {
            client_name,
            folder_prefix: "",
            config_files,
        }
    }
}

impl Agent for JetBrains {
    fn name(&self) -> &'static str {
        self.client_name
    }

    fn is_installed(&self) -> bool {
        self.config_files.iter().any(|p| p.exists())
    }

    fn watch_targets(&self) -> WatchTargets {
        WatchTargets {
            files: self.config_files.clone(),
            dirs: Vec::new(),
            needs_periodic_rescan: false,
        }
    }

    fn discover(&self) -> Result<Vec<DiscoveredServer>> {
        let mut out = Vec::new();
        for p in &self.config_files {
            if p.exists() {
                out.extend(parse_json_servers_map(
                    p,
                    "mcpServers",
                    self.client_name,
                    Scope::Global,
                    SourceKind::Json,
                ));
            }
        }
        Ok(out)
    }

    fn sealgate_installs(&self, home: &Path) -> Vec<SealGateInstall> {
        // One entry per installed IDE version dir under this user's home.
        jetbrains_base_in(home)
            .map(|base| enumerate(&base, self.folder_prefix))
            .unwrap_or_default()
            .into_iter()
            .map(|path| SealGateInstall {
                path,
                key_path: vec!["mcpServers".into()],
                style: SealGateStyle::Http,
                client_id: self.client_name.to_string(),
                prefer_cli: false,
            })
            .collect()
    }
}

fn jetbrains_base() -> Option<PathBuf> {
    if cfg!(target_os = "macos") {
        jetbrains_base_in(&dirs::home_dir()?)
    } else if cfg!(target_os = "windows") {
        Some(dirs::config_dir()?.join("JetBrains"))
    } else {
        None // Linux: unsupported
    }
}

/// The JetBrains base dir under `home` (macOS). Returns `None` off macOS.
fn jetbrains_base_in(home: &Path) -> Option<PathBuf> {
    if cfg!(target_os = "macos") {
        Some(home.join("Library/Application Support/JetBrains"))
    } else {
        None
    }
}

/// `<base>/<prefix>*/mcp/servers.json` for every version-suffixed IDE folder.
fn enumerate(base: &std::path::Path, folder_prefix: &str) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(base) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter_map(|e| {
            let name = e.file_name();
            if name.to_string_lossy().starts_with(folder_prefix) {
                Some(e.path().join("mcp").join("servers.json"))
            } else {
                None
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn discovers_servers_from_explicit_files() {
        let dir = tempdir().unwrap();
        let cfg = dir.path().join("servers.json");
        std::fs::write(&cfg, r#"{"mcpServers":{"idea":{"command":"x"}}}"#).unwrap();
        let servers = JetBrains::from_files("intellij", vec![cfg])
            .discover()
            .unwrap();
        assert_eq!(servers.len(), 1);
        assert_eq!(servers[0].name, "idea");
        assert_eq!(servers[0].client, "intellij");
    }

    #[test]
    fn enumerates_version_suffixed_folders() {
        let dir = tempdir().unwrap();
        for folder in ["IntelliJIdea2024.3", "IntelliJIdea2025.1", "PyCharm2024.3"] {
            std::fs::create_dir_all(dir.path().join(folder).join("mcp")).unwrap();
            std::fs::write(
                dir.path().join(folder).join("mcp").join("servers.json"),
                r#"{"mcpServers":{}}"#,
            )
            .unwrap();
        }
        let files = enumerate(dir.path(), "IntelliJIdea");
        assert_eq!(files.len(), 2); // two IntelliJIdea folders, not PyCharm
    }
}
