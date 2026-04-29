//! VSCode [`Client`] implementation. Watches the user-level
//! `Code/User/mcp.json` plus a `.vscode/mcp.json` inside every workspace
//! VSCode currently knows about.
//!
//! Workspace discovery goes through `Code/User/globalStorage/state.vscdb`
//! (an SQLite database VSCode uses for application state) - specifically
//! the `history.recentlyOpenedPathsList` row. The DB is opened with
//! `?mode=ro&immutable=1` so reads are safe even while VSCode is running.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use rusqlite::OptionalExtension;
use serde::Deserialize;

use crate::client::Client;
use crate::clients::detect_transport;
use crate::error::{Error, Result};
use crate::types::{McpServer, Scope};

const CLIENT_NAME: &str = "vscode";

/// VSCode MCP-config source.
///
/// Construct with [`VsCode::discover`], then hand it to a
/// [`Watcher`](crate::Watcher).
pub struct VsCode {
    global_config: Option<PathBuf>,
    /// (project_dir, path to `<project>/.vscode/mcp.json`)
    project_configs: Vec<(PathBuf, PathBuf)>,
}

impl VsCode {
    /// Locate VSCode's config files: the global `mcp.json` in the user-level
    /// `Code/User/` directory, plus a `.vscode/mcp.json` inside every
    /// workspace listed in `state.vscdb`.
    ///
    /// Returns `Ok` even if nothing is found - a `VsCode` with no paths is
    /// harmless and simply produces no events. SQLite or JSON failures during
    /// workspace discovery are logged at `warn` and treated as "no
    /// workspaces", so a corrupt `state.vscdb` won't prevent the global
    /// config from being watched.
    pub fn discover() -> Result<Self> {
        let global_config = global_mcp_path();
        let projects = discover_workspaces().unwrap_or_else(|e| {
            tracing::warn!(error = %e, "vscode workspace discovery failed");
            Vec::new()
        });
        let project_configs = projects
            .into_iter()
            .map(|p| {
                let cfg = p.join(".vscode").join("mcp.json");
                (p, cfg)
            })
            .collect();
        Ok(Self {
            global_config,
            project_configs,
        })
    }

    /// Construct a `VsCode` from explicit paths instead of platform discovery.
    ///
    /// Useful in tests, CI, or non-standard installs where
    /// [`VsCode::discover`] either points at the wrong locations or finds
    /// nothing because VSCode hasn't been opened on this machine.
    ///
    /// - `global_mcp_json` is the user-level `mcp.json` to watch (or `None`
    ///   to skip the global config entirely).
    /// - `project_dirs` is an iterator of workspace root directories; for
    ///   each one, `<dir>/.vscode/mcp.json` is added to the watch set.
    pub fn from_paths(
        global_mcp_json: Option<PathBuf>,
        project_dirs: impl IntoIterator<Item = PathBuf>,
    ) -> Self {
        let project_configs = project_dirs
            .into_iter()
            .map(|p| {
                let cfg = p.join(".vscode").join("mcp.json");
                (p, cfg)
            })
            .collect();
        Self {
            global_config: global_mcp_json,
            project_configs,
        }
    }
}

impl Client for VsCode {
    fn name(&self) -> &'static str {
        CLIENT_NAME
    }

    fn watch_paths(&self) -> Vec<PathBuf> {
        let mut v = Vec::new();
        if let Some(p) = &self.global_config {
            v.push(p.clone());
        }
        for (_, cfg) in &self.project_configs {
            v.push(cfg.clone());
        }
        v
    }

    fn parse_all(&self) -> Result<Vec<McpServer>> {
        let mut out = Vec::new();
        if let Some(p) = &self.global_config
            && p.exists()
        {
            out.extend(parse_file(p, Scope::Global));
        }
        for (project, cfg) in &self.project_configs {
            if cfg.exists() {
                out.extend(parse_file(cfg, Scope::Project(project.clone())));
            }
        }
        Ok(out)
    }
}

#[derive(Debug, Deserialize)]
struct McpFile {
    #[serde(default)]
    servers: BTreeMap<String, serde_json::Value>,
}

fn parse_file(path: &Path, scope: Scope) -> Vec<McpServer> {
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
    let parsed: McpFile = match serde_json::from_str(&text) {
        Ok(p) => p,
        Err(e) => {
            tracing::debug!(file = %path.display(), error = %e, "parse failed");
            return Vec::new();
        }
    };
    parsed
        .servers
        .into_iter()
        .map(|(name, val)| McpServer {
            client: CLIENT_NAME,
            name,
            transport: detect_transport(&val),
            scope: scope.clone(),
            source: path.to_path_buf(),
        })
        .collect()
}

fn global_mcp_path() -> Option<PathBuf> {
    Some(vscode_user_dir()?.join("mcp.json"))
}

fn vscode_user_dir() -> Option<PathBuf> {
    if cfg!(target_os = "macos") {
        Some(dirs::home_dir()?.join("Library/Application Support/Code/User"))
    } else {
        // Linux: ~/.config/Code/User, Windows: %APPDATA%/Code/User.
        Some(dirs::config_dir()?.join("Code").join("User"))
    }
}

fn state_vscdb_path() -> Option<PathBuf> {
    Some(vscode_user_dir()?.join("globalStorage").join("state.vscdb"))
}

fn discover_workspaces() -> Result<Vec<PathBuf>> {
    let Some(db_path) = state_vscdb_path() else {
        tracing::debug!("no vscode user dir on this platform");
        return Ok(Vec::new());
    };
    if !db_path.exists() {
        tracing::debug!(path = %db_path.display(), "state.vscdb not present");
        return Ok(Vec::new());
    }

    // `immutable=1` tells SQLite the file won't change on disk so it can skip
    // the WAL and locking; this lets us read safely while VSCode is running.
    let uri = format!("file:{}?mode=ro&immutable=1", db_path.to_string_lossy());
    let conn = rusqlite::Connection::open_with_flags(
        &uri,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_URI,
    )
    .map_err(|source| Error::Sqlite {
        path: db_path.clone(),
        source,
    })?;

    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM ItemTable WHERE key = 'history.recentlyOpenedPathsList'",
            [],
            |r| r.get(0),
        )
        .optional()
        .map_err(|source| Error::Sqlite {
            path: db_path.clone(),
            source,
        })?;
    let Some(raw) = raw else {
        return Ok(Vec::new());
    };

    #[derive(Deserialize)]
    struct Recent {
        entries: Vec<Entry>,
    }
    #[derive(Deserialize)]
    struct Entry {
        #[serde(rename = "folderUri")]
        folder_uri: Option<String>,
    }

    let recent: Recent = serde_json::from_str(&raw).map_err(|source| Error::Json {
        path: db_path.clone(),
        source,
    })?;
    Ok(recent
        .entries
        .into_iter()
        .filter_map(|e| e.folder_uri)
        .filter_map(|u| file_uri_to_path(&u))
        .collect())
}

fn file_uri_to_path(uri: &str) -> Option<PathBuf> {
    let stripped = uri.strip_prefix("file://")?;
    Some(PathBuf::from(percent_decode(stripped)))
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%'
            && i + 2 < bytes.len()
            && let (Some(h), Some(l)) = (hex(bytes[i + 1]), hex(bytes[i + 2]))
        {
            out.push((h << 4) | l);
            i += 3;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::tempdir;

    #[test]
    fn parse_file_extracts_stdio_and_remote() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("mcp.json");
        let mut f = std::fs::File::create(&path).unwrap();
        write!(
            f,
            r#"{{
                "servers": {{
                    "local-tool": {{ "command": "npx", "args": ["foo"] }},
                    "remote-thing": {{ "type": "http", "url": "https://x.example" }}
                }}
            }}"#
        )
        .unwrap();

        let servers = parse_file(&path, Scope::Global);
        assert_eq!(servers.len(), 2);
        let by_name: BTreeMap<_, _> = servers.iter().map(|s| (s.name.clone(), s)).collect();
        assert_eq!(
            by_name["local-tool"].transport,
            crate::types::Transport::Stdio
        );
        assert_eq!(
            by_name["remote-thing"].transport,
            crate::types::Transport::Remote
        );
    }

    #[test]
    fn parse_file_tolerates_missing_file() {
        assert!(parse_file(Path::new("/definitely/not/here.json"), Scope::Global).is_empty());
    }

    #[test]
    fn parse_file_tolerates_malformed_json() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("mcp.json");
        std::fs::write(&path, "{ this is not json").unwrap();
        assert!(parse_file(&path, Scope::Global).is_empty());
    }

    #[test]
    fn file_uri_decoding() {
        assert_eq!(
            file_uri_to_path("file:///Users/foo/My%20Project").unwrap(),
            PathBuf::from("/Users/foo/My Project")
        );
    }

    #[test]
    fn from_paths_watches_global_and_project_configs() {
        let dir = tempdir().unwrap();
        let global = dir.path().join("user").join("mcp.json");
        let proj_a = dir.path().join("proj_a");
        let proj_b = dir.path().join("proj_b");

        let v = VsCode::from_paths(Some(global.clone()), [proj_a.clone(), proj_b.clone()]);
        let watched = v.watch_paths();
        assert!(watched.contains(&global));
        assert!(watched.contains(&proj_a.join(".vscode").join("mcp.json")));
        assert!(watched.contains(&proj_b.join(".vscode").join("mcp.json")));
    }

    #[test]
    fn from_paths_parse_all_emits_global_and_project_servers() {
        let dir = tempdir().unwrap();
        let global = dir.path().join("mcp.json");
        std::fs::write(&global, r#"{"servers":{"g":{"command":"echo"}}}"#).unwrap();
        let proj = dir.path().join("p");
        std::fs::create_dir_all(proj.join(".vscode")).unwrap();
        std::fs::write(
            proj.join(".vscode").join("mcp.json"),
            r#"{"servers":{"p":{"type":"http","url":"https://x"}}}"#,
        )
        .unwrap();

        let v = VsCode::from_paths(Some(global.clone()), [proj.clone()]);
        let servers = v.parse_all().unwrap();

        assert_eq!(servers.len(), 2);
        let by_name: BTreeMap<_, _> = servers.iter().map(|s| (s.name.clone(), s)).collect();
        assert_eq!(by_name["g"].scope, Scope::Global);
        assert_eq!(by_name["g"].transport, crate::types::Transport::Stdio);
        assert_eq!(by_name["p"].scope, Scope::Project(proj));
        assert_eq!(by_name["p"].transport, crate::types::Transport::Remote);
    }
}
