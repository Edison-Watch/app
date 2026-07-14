//! Cursor [`Agent`]. Scans:
//!
//! 1. **User config** — `~/.cursor/mcp.json` (JSONC), key `mcpServers`.
//! 2. **Project configs** — `<workspaceRoot>/.cursor/mcp.json` (JSONC), for each
//!    workspace enumerated from Cursor's `workspaceStorage/<hash>/workspace.json`
//!    (`folder` field, `file://` URIs only).
//! 3. **Marketplace OAuth servers** — Cursor's `state.vscdb` (SQLite), key
//!    `anysphere.cursor-mcp`; each `"[user-<name>] mcp_server_url"` entry is an
//!    HTTP server.
//! 4. **Plugin-cache servers** — `~/.cursor/plugins/cache/<marketplace>/<plugin>/
//!    <sha>/mcp.json` (most-recent sha per plugin), matching the client.
//! 5. **Plugin metadata dirs** — `~/.cursor/projects/<proj>/mcps/<plugin>/` via
//!    `SERVER_METADATA` (opaque, removable by renaming the dir).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::agent::Agent;
use crate::clients::common::{file_uri_to_path, read_strict_json, servers_from_map};
use crate::clients::statedb::read_state_db_value;
use crate::error::Result;
use crate::types::{
    ConfigLocation, DiscoveredServer, EdisonInstall, EdisonStyle, HookBinding, HookInstall,
    HookScriptKind, HookStyle, HttpKind, LocationExtra, OpaqueReason, Scope, ServerConfig,
    SourceKind, StateShape, Transport,
};
use crate::watch::{WatchDir, WatchTargets};

const CLIENT_NAME: &str = "cursor";
const MARKETPLACE_KEY: &str = "anysphere.cursor-mcp";

pub struct Cursor {
    /// `~/.cursor/mcp.json`.
    user_config: Option<PathBuf>,
    /// `<Cursor>/User/globalStorage/state.vscdb`.
    state_db: Option<PathBuf>,
    /// `<Cursor>/User/workspaceStorage` — scanned to enumerate projects.
    workspace_storage: Option<PathBuf>,
    /// `~/.cursor/plugins/cache` — plugin-bundled MCP servers.
    plugins_cache: Option<PathBuf>,
    /// `~/.cursor/projects` — per-project marketplace plugin metadata.
    projects_dir: Option<PathBuf>,
    /// (workspace root, `<root>/.cursor/mcp.json`).
    project_configs: Vec<(PathBuf, PathBuf)>,
}

impl Cursor {
    pub fn discover() -> Result<Self> {
        let home = dirs::home_dir();
        let user_config = home.as_ref().map(|h| h.join(".cursor/mcp.json"));
        let plugins_cache = home.as_ref().map(|h| h.join(".cursor/plugins/cache"));
        let projects_dir = home.as_ref().map(|h| h.join(".cursor/projects"));
        let user_dir = cursor_user_dir();
        let state_db = user_dir
            .as_ref()
            .map(|d| d.join("globalStorage/state.vscdb"));
        let workspace_storage = user_dir.as_ref().map(|d| d.join("workspaceStorage"));

        let project_configs = workspace_storage
            .as_deref()
            .map(enumerate_projects)
            .unwrap_or_default()
            .into_iter()
            .map(|root| {
                let cfg = root.join(".cursor").join("mcp.json");
                (root, cfg)
            })
            .collect();

        Ok(Self {
            user_config,
            state_db,
            workspace_storage,
            plugins_cache,
            projects_dir,
            project_configs,
        })
    }

    /// Construct from explicit paths (tests / non-standard installs).
    pub fn from_paths(
        user_config: Option<PathBuf>,
        state_db: Option<PathBuf>,
        project_dirs: impl IntoIterator<Item = PathBuf>,
    ) -> Self {
        let project_configs = project_dirs
            .into_iter()
            .map(|root| {
                let cfg = root.join(".cursor").join("mcp.json");
                (root, cfg)
            })
            .collect();
        Self {
            user_config,
            state_db,
            workspace_storage: None,
            plugins_cache: None,
            projects_dir: None,
            project_configs,
        }
    }
}

impl Agent for Cursor {
    fn name(&self) -> &'static str {
        CLIENT_NAME
    }

    fn is_installed(&self) -> bool {
        self.user_config.as_ref().is_some_and(|p| p.exists())
            || self.state_db.as_ref().is_some_and(|p| p.exists())
    }

    fn watch_targets(&self) -> WatchTargets {
        let mut files = Vec::new();
        if let Some(p) = &self.user_config {
            files.push(p.clone());
        }
        if let Some(p) = &self.state_db {
            files.push(p.clone());
        }
        for (_, cfg) in &self.project_configs {
            files.push(cfg.clone());
        }
        let mut dirs: Vec<WatchDir> = Vec::new();
        if let Some(path) = self.workspace_storage.clone() {
            dirs.push(WatchDir { path, depth: 1 });
        }
        if let Some(path) = self.plugins_cache.clone() {
            dirs.push(WatchDir { path, depth: 3 });
        }
        WatchTargets {
            files,
            dirs,
            // state.vscdb (marketplace OAuth) mutates without fs events.
            needs_periodic_rescan: true,
        }
    }

    fn discover(&self) -> Result<Vec<DiscoveredServer>> {
        let mut out = Vec::new();
        if let Some(p) = &self.user_config
            && p.exists()
        {
            out.extend(parse_jsonc_servers(p, Scope::Global));
        }
        for (root, cfg) in &self.project_configs {
            if cfg.exists() {
                out.extend(parse_jsonc_servers(cfg, Scope::Project(root.clone())));
            }
        }
        if let Some(db) = &self.state_db
            && db.exists()
        {
            out.extend(parse_marketplace(db));
        }
        if let Some(cache) = &self.plugins_cache
            && cache.exists()
        {
            out.extend(scan_plugin_cache(cache));
        }
        if let Some(projects) = &self.projects_dir
            && projects.exists()
        {
            out.extend(scan_server_metadata(projects));
        }
        Ok(out)
    }

    fn edison_installs(&self, home: &std::path::Path) -> Vec<EdisonInstall> {
        vec![EdisonInstall {
            path: home.join(".cursor/mcp.json"),
            key_path: vec!["mcpServers".into()],
            style: EdisonStyle::Http,
            client_id: "cursor".into(),
            prefer_cli: false,
        }]
    }

    fn hook_install(&self, home: &std::path::Path) -> Option<HookInstall> {
        Some(HookInstall {
            path: home.join(".cursor/hooks.json"),
            style: HookStyle::CursorHooks,
            client_id: "cursor".into(),
            events: vec![
                HookBinding::new("sessionStart", None, HookScriptKind::Registration, true),
                HookBinding::new(
                    "beforeMCPExecution",
                    None,
                    HookScriptKind::SessionHook,
                    false,
                ),
                HookBinding::new("sessionEnd", None, HookScriptKind::SessionEnd, false),
            ],
        })
    }
}

/// Parse a Cursor `mcp.json` (JSONC) into servers under `mcpServers`.
fn parse_jsonc_servers(path: &Path, scope: Scope) -> Vec<DiscoveredServer> {
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
    let root: Value = match serde_json_lenient::from_str(&text) {
        Ok(v) => v,
        Err(e) => {
            tracing::debug!(file = %path.display(), error = %e, "parse failed");
            return Vec::new();
        }
    };
    servers_from_map(
        &root,
        "mcpServers",
        CLIENT_NAME,
        scope,
        SourceKind::Jsonc,
        path,
    )
}

/// Read Cursor's marketplace OAuth MCP servers from `state.vscdb`.
fn parse_marketplace(state_db: &Path) -> Vec<DiscoveredServer> {
    let raw = match read_state_db_value(state_db, MARKETPLACE_KEY) {
        Ok(Some(s)) => s,
        Ok(None) => return Vec::new(),
        Err(e) => {
            tracing::debug!(path = %state_db.display(), error = %e, "cursor-mcp read failed");
            return Vec::new();
        }
    };
    let Ok(Value::Object(obj)) = serde_json_lenient::from_str::<Value>(&raw) else {
        return Vec::new();
    };

    obj.iter()
        .filter_map(|(k, v)| {
            let name = k.strip_prefix("[user-")?.strip_suffix("] mcp_server_url")?;
            let url = v.as_str()?.to_string();
            Some(DiscoveredServer {
                client: CLIENT_NAME,
                name: name.to_string(),
                transport: Transport::Remote,
                scope: Scope::Global,
                config: ServerConfig::Http {
                    url,
                    headers: BTreeMap::new(),
                    kind: HttpKind::Http,
                },
                location: ConfigLocation {
                    kind: SourceKind::SqliteState,
                    path: state_db.to_path_buf(),
                    key_path: Vec::new(),
                    server_key: k.clone(),
                    extra: LocationExtra::StateDb {
                        item_key: MARKETPLACE_KEY.to_string(),
                        shape: StateShape::ObjectKey,
                    },
                },
            })
        })
        .collect()
}

/// Scan plugin-bundled MCP servers: `<cache>/<marketplace>/<plugin>/<sha>/mcp.json`
/// (JSONC, key `mcpServers`), taking the most-recent `<sha>` per plugin and
/// skipping quarantined `ew-disabled-*` plugin dirs.
fn scan_plugin_cache(cache_dir: &Path) -> Vec<DiscoveredServer> {
    let mut out = Vec::new();
    for market in subdirs(cache_dir) {
        for plugin in subdirs(&market) {
            let pname = plugin.file_name().unwrap_or_default().to_string_lossy();
            if pname.starts_with("ew-disabled-") {
                continue;
            }
            if let Some(sha) = most_recent_subdir(&plugin) {
                let mcp = sha.join("mcp.json");
                if mcp.exists() {
                    out.extend(parse_jsonc_servers(&mcp, Scope::Global));
                }
            }
        }
    }
    out
}

/// Scan per-project marketplace plugin metadata:
/// `<projects>/*/mcps/plugin-*/SERVER_METADATA.json`. No launch config, so they
/// can't be fingerprinted/sent to EW — but they are **removable** by renaming
/// the plugin directory ([`SourceKind::CursorPluginDir`]).
fn scan_server_metadata(projects_dir: &Path) -> Vec<DiscoveredServer> {
    let mut out = Vec::new();
    for project in subdirs(projects_dir) {
        for plugin in subdirs(&project.join("mcps")) {
            let dir_name = plugin
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned();
            if !dir_name.starts_with("plugin-") {
                continue;
            }
            let meta = plugin.join("SERVER_METADATA.json");
            let Some(v) = read_strict_json(&meta) else {
                continue;
            };
            let server_name = v
                .get("serverName")
                .or_else(|| v.get("serverIdentifier"))
                .and_then(|x| x.as_str());
            if let Some(sname) = server_name {
                out.push(DiscoveredServer {
                    client: CLIENT_NAME,
                    name: sname.to_string(),
                    transport: Transport::Stdio,
                    scope: Scope::Global,
                    config: ServerConfig::Opaque {
                        removable: true,
                        reason: OpaqueReason::CursorPlugin,
                    },
                    // Removed by renaming the plugin dir, so the location points
                    // at the directory, not the metadata file.
                    location: ConfigLocation {
                        kind: SourceKind::CursorPluginDir,
                        path: plugin.clone(),
                        key_path: Vec::new(),
                        server_key: dir_name,
                        extra: LocationExtra::None,
                    },
                });
            }
        }
    }
    out
}

/// Immediate subdirectories of `dir` (empty if unreadable).
fn subdirs(dir: &Path) -> Vec<PathBuf> {
    std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect()
}

/// The most-recently-modified subdirectory of `dir`.
fn most_recent_subdir(dir: &Path) -> Option<PathBuf> {
    subdirs(dir)
        .into_iter()
        .filter_map(|p| {
            let mtime = std::fs::metadata(&p).ok()?.modified().ok()?;
            Some((mtime, p))
        })
        .max_by_key(|(mtime, _)| *mtime)
        .map(|(_, p)| p)
}

/// Enumerate workspace roots from `workspaceStorage/<hash>/workspace.json`.
fn enumerate_projects(workspace_storage: &Path) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(workspace_storage) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter_map(|e| {
            let wj = e.path().join("workspace.json");
            let folder = read_strict_json(&wj)?.get("folder")?.as_str()?.to_string();
            file_uri_to_path(&folder)
        })
        .collect()
}

fn cursor_user_dir() -> Option<PathBuf> {
    if cfg!(target_os = "macos") {
        Some(dirs::home_dir()?.join("Library/Application Support/Cursor/User"))
    } else {
        Some(dirs::config_dir()?.join("Cursor").join("User"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn make_state_db(path: &Path, rows: &[(&str, &str)]) {
        let conn = rusqlite::Connection::open(path).unwrap();
        conn.execute(
            "CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value BLOB)",
            [],
        )
        .unwrap();
        for (k, v) in rows {
            conn.execute(
                "INSERT INTO ItemTable (key, value) VALUES (?1, ?2)",
                rusqlite::params![k, v],
            )
            .unwrap();
        }
    }

    #[test]
    fn parses_user_jsonc_config() {
        let dir = tempdir().unwrap();
        let cfg = dir.path().join("mcp.json");
        std::fs::write(
            &cfg,
            r#"{
                // my cursor servers
                "mcpServers": {
                    "local": { "command": "npx", "args": ["srv",] },
                    "remote": { "type": "http", "url": "https://x" },
                },
            }"#,
        )
        .unwrap();

        let servers = Cursor::from_paths(Some(cfg), None, std::iter::empty::<PathBuf>())
            .discover()
            .unwrap();
        assert_eq!(servers.len(), 2);
        let by: std::collections::BTreeMap<_, _> =
            servers.iter().map(|s| (s.name.clone(), s)).collect();
        assert_eq!(by["local"].transport, Transport::Stdio);
        assert_eq!(by["remote"].transport, Transport::Remote);
    }

    #[test]
    fn parses_project_config() {
        let dir = tempdir().unwrap();
        let proj = dir.path().join("proj");
        std::fs::create_dir_all(proj.join(".cursor")).unwrap();
        std::fs::write(
            proj.join(".cursor").join("mcp.json"),
            r#"{"mcpServers":{"p":{"command":"x"}}}"#,
        )
        .unwrap();

        let servers = Cursor::from_paths(None, None, [proj.clone()])
            .discover()
            .unwrap();
        assert_eq!(servers.len(), 1);
        assert_eq!(servers[0].scope, Scope::Project(proj));
    }

    #[test]
    fn parses_marketplace_oauth_servers() {
        let dir = tempdir().unwrap();
        let db = dir.path().join("state.vscdb");
        let value = serde_json::json!({
            "[user-notion] mcp_server_url": "https://mcp.notion.com/mcp",
            "[user-linear] mcp_server_url": "https://mcp.linear.app/sse",
            "some other key": "ignored"
        })
        .to_string();
        make_state_db(&db, &[(MARKETPLACE_KEY, &value)]);

        let servers = parse_marketplace(&db);
        assert_eq!(servers.len(), 2);
        let by: std::collections::BTreeMap<_, _> =
            servers.iter().map(|s| (s.name.clone(), s)).collect();
        assert!(by.contains_key("notion"));
        assert!(by.contains_key("linear"));
        assert_eq!(by["notion"].transport, Transport::Remote);
    }

    #[test]
    fn scans_plugin_cache_mcp_json() {
        let dir = tempdir().unwrap();
        let cache = dir.path().join("cache");
        let sha = cache.join("acme-market").join("my-plugin").join("abc123");
        std::fs::create_dir_all(&sha).unwrap();
        std::fs::write(
            sha.join("mcp.json"),
            r#"{"mcpServers":{"bundled":{"command":"run"}}}"#,
        )
        .unwrap();
        // A quarantined plugin dir must be skipped.
        let disabled = cache.join("acme-market").join("ew-disabled-old");
        std::fs::create_dir_all(disabled.join("sha")).unwrap();
        std::fs::write(
            disabled.join("sha").join("mcp.json"),
            r#"{"mcpServers":{"nope":{"command":"x"}}}"#,
        )
        .unwrap();

        let servers = scan_plugin_cache(&cache);
        assert_eq!(servers.len(), 1);
        assert_eq!(servers[0].name, "bundled");
    }

    #[test]
    fn scans_server_metadata_as_report_only() {
        let dir = tempdir().unwrap();
        let projects = dir.path().join("projects");
        let plugin = projects.join("proj1").join("mcps").join("plugin-notion");
        std::fs::create_dir_all(&plugin).unwrap();
        std::fs::write(
            plugin.join("SERVER_METADATA.json"),
            r#"{"serverName":"notion","serverIdentifier":"notion@acme"}"#,
        )
        .unwrap();

        let servers = scan_server_metadata(&projects);
        assert_eq!(servers.len(), 1);
        assert_eq!(servers[0].name, "notion");
        assert!(matches!(
            servers[0].config,
            ServerConfig::Opaque {
                removable: true,
                ..
            }
        ));
    }

    #[test]
    fn tolerates_missing_everything() {
        let servers = Cursor::from_paths(
            Some(PathBuf::from("/nope/mcp.json")),
            Some(PathBuf::from("/nope/state.vscdb")),
            std::iter::empty::<PathBuf>(),
        )
        .discover()
        .unwrap();
        assert!(servers.is_empty());
    }
}
