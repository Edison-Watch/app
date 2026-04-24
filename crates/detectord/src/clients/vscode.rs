use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use rusqlite::OptionalExtension;
use serde::Deserialize;

use crate::client::Client;
use crate::clients::detect_transport;
use crate::types::{McpServer, Scope};

const CLIENT_NAME: &str = "vscode";

pub struct VsCode {
    global_config: Option<PathBuf>,
    /// (project_dir, path to `<project>/.vscode/mcp.json`)
    project_configs: Vec<(PathBuf, PathBuf)>,
}

impl VsCode {
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
        Some(
            dirs::home_dir()?
                .join("Library/Application Support/Code/User"),
        )
    } else {
        // Linux: ~/.config/Code/User, Windows: %APPDATA%/Code/User.
        Some(dirs::config_dir()?.join("Code").join("User"))
    }
}

fn state_vscdb_path() -> Option<PathBuf> {
    Some(vscode_user_dir()?.join("globalStorage").join("state.vscdb"))
}

fn discover_workspaces() -> Result<Vec<PathBuf>> {
    let db_path = state_vscdb_path().context("no state.vscdb path")?;
    if !db_path.exists() {
        tracing::debug!(path = %db_path.display(), "state.vscdb not present");
        return Ok(Vec::new());
    }

    // `immutable=1` tells SQLite the file won't change on disk so it can skip
    // the WAL and locking; this lets us read safely while VSCode is running.
    let uri = format!(
        "file:{}?mode=ro&immutable=1",
        db_path.to_string_lossy()
    );
    let conn = rusqlite::Connection::open_with_flags(
        &uri,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_URI,
    )
    .with_context(|| format!("open {}", db_path.display()))?;

    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM ItemTable WHERE key = 'history.recentlyOpenedPathsList'",
            [],
            |r| r.get(0),
        )
        .optional()?;
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

    let recent: Recent = serde_json::from_str(&raw).context("parse recentlyOpenedPathsList")?;
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
}
