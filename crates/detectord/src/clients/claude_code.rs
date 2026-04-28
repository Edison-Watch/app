//! Claude Code [`Client`] implementation. Watches `~/.claude.json` (which
//! contains both the global `mcpServers` map and a `projects` sub-map with
//! per-project servers) plus a `.mcp.json` inside every project listed in
//! that file.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::Deserialize;

use crate::client::Client;
use crate::clients::detect_transport;
use crate::error::{Error, Result};
use crate::types::{McpServer, Scope};

const CLIENT_NAME: &str = "claude_code";

/// Claude Code MCP-config source.
///
/// Construct with [`ClaudeCode::discover`], then hand it to a
/// [`Watcher`](crate::Watcher).
pub struct ClaudeCode {
    /// `~/.claude.json` — single user-level file that holds both global
    /// servers and a `projects` map with per-project servers.
    user_config: Option<PathBuf>,
    /// (project_dir, path to `<project>/.mcp.json`) for each project CC knows
    /// about. `.mcp.json` is the committed, project-scoped servers file.
    project_configs: Vec<(PathBuf, PathBuf)>,
}

impl ClaudeCode {
    /// Locate Claude Code's config files: `~/.claude.json` plus a `.mcp.json`
    /// in every project directory enumerated under that file's `projects`
    /// map.
    ///
    /// Returns `Ok` even if `~/.claude.json` is absent or unreadable — the
    /// resulting `ClaudeCode` simply has no paths to watch.
    pub fn discover() -> Result<Self> {
        let user_config = dirs::home_dir().map(|h| h.join(".claude.json"));
        let mut project_configs: Vec<(PathBuf, PathBuf)> = Vec::new();
        if let Some(uc) = &user_config
            && uc.exists()
        {
            match projects_from_user_config(uc) {
                Ok(projects) => {
                    for p in projects {
                        let cfg = p.join(".mcp.json");
                        project_configs.push((p, cfg));
                    }
                }
                Err(e) => {
                    tracing::warn!(error = %e, "claude_code project enumeration failed");
                }
            }
        }
        Ok(Self {
            user_config,
            project_configs,
        })
    }

    /// Construct a `ClaudeCode` from explicit paths instead of running the
    /// usual user-config discovery.
    ///
    /// Useful in tests, CI, or unusual installs.
    ///
    /// - `user_config` is the path to a `.claude.json`-shaped file (or
    ///   `None` to skip).
    /// - `project_dirs` is an iterator of project root directories; for each
    ///   one, `<dir>/.mcp.json` is added to the watch set.
    pub fn from_paths(
        user_config: Option<PathBuf>,
        project_dirs: impl IntoIterator<Item = PathBuf>,
    ) -> Self {
        let project_configs = project_dirs
            .into_iter()
            .map(|p| {
                let cfg = p.join(".mcp.json");
                (p, cfg)
            })
            .collect();
        Self {
            user_config,
            project_configs,
        }
    }
}

impl Client for ClaudeCode {
    fn name(&self) -> &'static str {
        CLIENT_NAME
    }

    fn watch_paths(&self) -> Vec<PathBuf> {
        let mut v = Vec::new();
        if let Some(p) = &self.user_config {
            v.push(p.clone());
        }
        for (_, cfg) in &self.project_configs {
            v.push(cfg.clone());
        }
        v
    }

    fn parse_all(&self) -> Result<Vec<McpServer>> {
        let mut out = Vec::new();
        if let Some(uc) = &self.user_config
            && uc.exists()
        {
            out.extend(parse_user_config(uc));
        }
        for (project, cfg) in &self.project_configs {
            if cfg.exists() {
                out.extend(parse_project_mcp(cfg, project.clone()));
            }
        }
        Ok(out)
    }
}

#[derive(Debug, Deserialize)]
struct UserConfig {
    #[serde(default, rename = "mcpServers")]
    mcp_servers: BTreeMap<String, serde_json::Value>,
    #[serde(default)]
    projects: BTreeMap<String, ProjectEntry>,
}

#[derive(Debug, Deserialize)]
struct ProjectEntry {
    #[serde(default, rename = "mcpServers")]
    mcp_servers: BTreeMap<String, serde_json::Value>,
}

fn projects_from_user_config(path: &Path) -> Result<Vec<PathBuf>> {
    let text = std::fs::read_to_string(path).map_err(|source| Error::Io {
        path: path.to_path_buf(),
        source,
    })?;
    if text.trim().is_empty() {
        return Ok(Vec::new());
    }
    let cfg: UserConfig = serde_json::from_str(&text).map_err(|source| Error::Json {
        path: path.to_path_buf(),
        source,
    })?;
    Ok(cfg.projects.keys().map(PathBuf::from).collect())
}

fn parse_user_config(path: &Path) -> Vec<McpServer> {
    let text = match std::fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) => {
            tracing::debug!(file = %path.display(), error = %e, "read failed");
            return Vec::new();
        }
    };
    if text.trim().is_empty() {
        return Vec::new();
    }
    let cfg: UserConfig = match serde_json::from_str(&text) {
        Ok(c) => c,
        Err(e) => {
            tracing::debug!(file = %path.display(), error = %e, "parse failed");
            return Vec::new();
        }
    };

    let mut out = Vec::new();
    for (name, val) in cfg.mcp_servers {
        out.push(McpServer {
            client: CLIENT_NAME,
            name,
            transport: detect_transport(&val),
            scope: Scope::Global,
            source: path.to_path_buf(),
        });
    }
    for (project_path_str, entry) in cfg.projects {
        let project_path = PathBuf::from(project_path_str);
        for (name, val) in entry.mcp_servers {
            out.push(McpServer {
                client: CLIENT_NAME,
                name,
                transport: detect_transport(&val),
                scope: Scope::Project(project_path.clone()),
                source: path.to_path_buf(),
            });
        }
    }
    out
}

#[derive(Debug, Deserialize)]
struct ProjectMcpFile {
    #[serde(default, rename = "mcpServers")]
    mcp_servers: BTreeMap<String, serde_json::Value>,
}

fn parse_project_mcp(path: &Path, project: PathBuf) -> Vec<McpServer> {
    let text = match std::fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) => {
            tracing::debug!(file = %path.display(), error = %e, "read failed");
            return Vec::new();
        }
    };
    if text.trim().is_empty() {
        return Vec::new();
    }
    let cfg: ProjectMcpFile = match serde_json::from_str(&text) {
        Ok(c) => c,
        Err(e) => {
            tracing::debug!(file = %path.display(), error = %e, "parse failed");
            return Vec::new();
        }
    };
    cfg.mcp_servers
        .into_iter()
        .map(|(name, val)| McpServer {
            client: CLIENT_NAME,
            name,
            transport: detect_transport(&val),
            scope: Scope::Project(project.clone()),
            source: path.to_path_buf(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::Transport;
    use tempfile::tempdir;

    #[test]
    fn user_config_yields_global_and_project_servers() {
        let dir = tempdir().unwrap();
        let path = dir.path().join(".claude.json");
        std::fs::write(
            &path,
            r#"{
                "mcpServers": {
                    "global-tool": { "command": "node", "args": ["server.js"] }
                },
                "projects": {
                    "/home/u/proj-a": {
                        "mcpServers": {
                            "proj-tool": { "type": "http", "url": "https://x" }
                        }
                    },
                    "/home/u/proj-b": {}
                }
            }"#,
        )
        .unwrap();

        let servers = parse_user_config(&path);
        assert_eq!(servers.len(), 2);

        let by_name: BTreeMap<_, _> = servers.iter().map(|s| (s.name.clone(), s)).collect();
        assert_eq!(by_name["global-tool"].scope, Scope::Global);
        assert_eq!(by_name["global-tool"].transport, Transport::Stdio);
        assert_eq!(
            by_name["proj-tool"].scope,
            Scope::Project(PathBuf::from("/home/u/proj-a"))
        );
        assert_eq!(by_name["proj-tool"].transport, Transport::Remote);
    }

    #[test]
    fn project_mcp_json_parses() {
        let dir = tempdir().unwrap();
        let path = dir.path().join(".mcp.json");
        std::fs::write(
            &path,
            r#"{ "mcpServers": { "local": { "command": "bin" } } }"#,
        )
        .unwrap();

        let servers = parse_project_mcp(&path, PathBuf::from("/proj"));
        assert_eq!(servers.len(), 1);
        assert_eq!(servers[0].name, "local");
        assert_eq!(servers[0].scope, Scope::Project(PathBuf::from("/proj")));
    }

    #[test]
    fn projects_from_user_config_returns_keys() {
        let dir = tempdir().unwrap();
        let path = dir.path().join(".claude.json");
        std::fs::write(
            &path,
            r#"{ "projects": { "/a": {}, "/b": { "mcpServers": {} } } }"#,
        )
        .unwrap();

        let mut projects = projects_from_user_config(&path).unwrap();
        projects.sort();
        assert_eq!(projects, vec![PathBuf::from("/a"), PathBuf::from("/b")]);
    }

    #[test]
    fn malformed_user_config_is_tolerated_by_parse() {
        let dir = tempdir().unwrap();
        let path = dir.path().join(".claude.json");
        std::fs::write(&path, "not json").unwrap();
        assert!(parse_user_config(&path).is_empty());
    }

    #[test]
    fn from_paths_watches_user_and_project_configs() {
        let dir = tempdir().unwrap();
        let user = dir.path().join(".claude.json");
        let proj = dir.path().join("proj");
        let cc = ClaudeCode::from_paths(Some(user.clone()), [proj.clone()]);
        let watched = cc.watch_paths();
        assert!(watched.contains(&user));
        assert!(watched.contains(&proj.join(".mcp.json")));
    }

    #[test]
    fn from_paths_parse_all_combines_user_and_project_configs() {
        let dir = tempdir().unwrap();
        let user = dir.path().join(".claude.json");
        std::fs::write(
            &user,
            r#"{"mcpServers":{"u":{"command":"node"}}}"#,
        )
        .unwrap();
        let proj = dir.path().join("p");
        std::fs::create_dir_all(&proj).unwrap();
        std::fs::write(
            proj.join(".mcp.json"),
            r#"{"mcpServers":{"p":{"type":"http","url":"https://x"}}}"#,
        )
        .unwrap();

        let cc = ClaudeCode::from_paths(Some(user.clone()), [proj.clone()]);
        let servers = cc.parse_all().unwrap();

        assert_eq!(servers.len(), 2);
        let by_name: BTreeMap<_, _> = servers.iter().map(|s| (s.name.clone(), s)).collect();
        assert_eq!(by_name["u"].scope, Scope::Global);
        assert_eq!(by_name["u"].transport, Transport::Stdio);
        assert_eq!(by_name["p"].scope, Scope::Project(proj));
        assert_eq!(by_name["p"].transport, Transport::Remote);
    }
}
