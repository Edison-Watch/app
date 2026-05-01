//! VSCode [`Client`] implementation. Watches four sources:
//!
//! 1. **User-level `Code/User/mcp.json`** — the file users edit by hand.
//! 2. **Per-workspace `<workspace>/.vscode/mcp.json`** for every workspace
//!    listed in `state.vscdb` under `history.recentlyOpenedPathsList`.
//! 3. **`state.vscdb` itself, key `mcpToolCache`** — older static-contribution
//!    extension servers (the row's `extensionServers` array). Modern VSCode
//!    versions tend to leave this empty.
//! 4. **`~/.vscode/extensions/extensions.json` plus each extension's
//!    `package.json`** — extensions that contribute the
//!    `mcpServerDefinitionProviders` contribution point. This is the
//!    *modern* way extensions register MCP servers (via
//!    `vscode.lm.registerMcpServerDefinitionProvider`); the runtime
//!    registration is in-memory only and never reaches `state.vscdb`,
//!    so a static scan of installed extensions is the only way to see
//!    them on disk.
//!
//! `state.vscdb` is opened with `?mode=ro&immutable=1` so reads are safe
//! even while VSCode is running.

use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};

use rusqlite::OptionalExtension;
use serde::Deserialize;

use crate::client::Client;
use crate::clients::detect_transport;
use crate::error::{Error, Result};
use crate::types::{McpServer, Scope, Transport};

const CLIENT_NAME: &str = "vscode";

/// VSCode MCP-config source.
///
/// Construct with [`VsCode::discover`], then hand it to a
/// [`Watcher`](crate::Watcher).
pub struct VsCode {
    global_config: Option<PathBuf>,
    /// Path to `Code/User/globalStorage/state.vscdb`. Used both for one-shot
    /// workspace enumeration at `discover()` and for ongoing reads of the
    /// `mcpToolCache` row on every `parse_all`.
    state_db: Option<PathBuf>,
    /// `~/.vscode/extensions/` — root for the `extensions.json` index and
    /// each extension's `package.json`, scanned for the
    /// `mcpServerDefinitionProviders` contribution point.
    extensions_dir: Option<PathBuf>,
    /// (project_dir, path to `<project>/.vscode/mcp.json`)
    project_configs: Vec<(PathBuf, PathBuf)>,
}

impl VsCode {
    /// Locate VSCode's config sources: the global `mcp.json`, the workspace
    /// `.vscode/mcp.json` files for every workspace listed in `state.vscdb`,
    /// and the `state.vscdb` file itself (for reading extension-registered
    /// servers from the `mcpToolCache` row).
    ///
    /// Returns `Ok` even if nothing is found — a `VsCode` with no paths is
    /// harmless and simply produces no events. SQLite or JSON failures during
    /// workspace discovery are logged at `warn` and treated as "no
    /// workspaces", so a corrupt `state.vscdb` won't prevent the global
    /// config from being watched.
    pub fn discover() -> Result<Self> {
        let global_config = global_mcp_path();
        let state_db = state_vscdb_path();
        let extensions_dir = vscode_extensions_dir();
        let projects = state_db
            .as_deref()
            .map(discover_workspaces)
            .transpose()
            .unwrap_or_else(|e| {
                tracing::warn!(error = %e, "vscode workspace discovery failed");
                None
            })
            .unwrap_or_default();
        let project_configs = projects
            .into_iter()
            .map(|p| {
                let cfg = p.join(".vscode").join("mcp.json");
                (p, cfg)
            })
            .collect();
        Ok(Self {
            global_config,
            state_db,
            extensions_dir,
            project_configs,
        })
    }

    /// Construct a `VsCode` from explicit paths instead of platform discovery.
    ///
    /// Useful in tests, CI, or non-standard installs where
    /// [`VsCode::discover`] either points at the wrong locations or finds
    /// nothing because VSCode hasn't been opened on this machine.
    ///
    /// - `global_mcp_json` — user-level `mcp.json` to watch (or `None` to skip).
    /// - `state_vscdb` — VSCode's `state.vscdb` SQLite file, used to read the
    ///   `mcpToolCache` row for extension-registered MCP servers (or `None`
    ///   to skip extension-server discovery entirely).
    /// - `project_dirs` — workspace root directories; for each one,
    ///   `<dir>/.vscode/mcp.json` is added to the watch set.
    pub fn from_paths(
        global_mcp_json: Option<PathBuf>,
        state_vscdb: Option<PathBuf>,
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
            state_db: state_vscdb,
            extensions_dir: None,
            project_configs,
        }
    }

    /// Builder-style setter for the extensions directory (typically
    /// `~/.vscode/extensions`). Used to enable scanning of extensions that
    /// contribute the `mcpServerDefinitionProviders` contribution point —
    /// i.e. extensions like `upstash.context7-mcp` that register MCP
    /// servers programmatically via `vscode.lm.registerMcpServerDefinitionProvider`.
    pub fn with_extensions_dir(mut self, extensions_dir: Option<PathBuf>) -> Self {
        self.extensions_dir = extensions_dir;
        self
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
        if let Some(p) = &self.state_db {
            v.push(p.clone());
        }
        if let Some(d) = &self.extensions_dir {
            // Watch the extensions index file. Its parent dir contains every
            // extension subdir, so install/uninstall events fire there too.
            v.push(d.join("extensions.json"));
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
        if let Some(db) = &self.state_db
            && db.exists()
        {
            out.extend(parse_mcp_tool_cache(db));
        }
        if let Some(d) = &self.extensions_dir
            && d.exists()
        {
            out.extend(parse_extension_providers(d));
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
    // VSCode treats `mcp.json` and `settings.json` as JSONC (JSON with
    // Comments + trailing commas), so we use a lenient parser. edison-watch
    // does the same — see client_2/src/main/runtime/mcpConfigActions.ts:57-59.
    let parsed: McpFile = match serde_json_lenient::from_str(&text) {
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

/// Schema of the JSON value stored in `state.vscdb` under `mcpToolCache`.
#[derive(Debug, Deserialize)]
struct McpToolCache {
    #[serde(default, rename = "extensionServers")]
    extension_servers: Vec<ExtensionServer>,
    /// `serverTools` is an array of `[id, entry]` pairs (Map.entries() shape).
    /// We only need the id to detect which entries are *not* duplicates of
    /// `extension_servers`.
    #[serde(default, rename = "serverTools")]
    server_tools: Vec<(String, serde_json::Value)>,
}

#[derive(Debug, Deserialize)]
struct ExtensionServer {
    id: String,
    #[serde(rename = "serverUrl", default)]
    server_url: Option<String>,
}

/// Read the `mcpToolCache` row out of `state.vscdb` and emit one [`McpServer`]
/// per extension-registered MCP server. Mirrors edison-watch's
/// `client_2/src/main/clients/vscode/discovery.ts:82-142`.
fn parse_mcp_tool_cache(db_path: &Path) -> Vec<McpServer> {
    let raw = match read_state_db_value(db_path, "mcpToolCache") {
        Ok(Some(s)) => s,
        Ok(None) => return Vec::new(),
        Err(e) => {
            tracing::debug!(path = %db_path.display(), error = %e, "mcpToolCache read failed");
            return Vec::new();
        }
    };
    let cache: McpToolCache = match serde_json::from_str(&raw) {
        Ok(c) => c,
        Err(e) => {
            tracing::debug!(path = %db_path.display(), error = %e, "mcpToolCache parse failed");
            return Vec::new();
        }
    };

    let mut out = Vec::new();
    let mut seen_ids: HashSet<String> = HashSet::new();

    for srv in cache.extension_servers {
        let transport = if srv.server_url.is_some() {
            Transport::Remote
        } else {
            Transport::Stdio
        };
        seen_ids.insert(srv.id.clone());
        out.push(McpServer {
            client: CLIENT_NAME,
            name: srv.id,
            transport,
            scope: Scope::Global,
            source: db_path.to_path_buf(),
        });
    }

    // serverTools entries that aren't already in extensionServers and don't
    // start with "mcp.config." (those come from file parsing and we cover
    // them via parse_file).
    for (id, _tool) in cache.server_tools {
        if seen_ids.contains(&id) || id.starts_with("mcp.config.") {
            continue;
        }
        out.push(McpServer {
            client: CLIENT_NAME,
            name: id,
            transport: Transport::Stdio,
            scope: Scope::Global,
            source: db_path.to_path_buf(),
        });
    }

    out
}

/// Open `state.vscdb` read-only and return the value of a single
/// `ItemTable` row, or `None` if the key is absent.
fn read_state_db_value(db_path: &Path, key: &str) -> Result<Option<String>> {
    // `immutable=1` tells SQLite the file won't change on disk so it can skip
    // the WAL and locking; this lets us read safely while VSCode is running.
    let uri = format!("file:{}?mode=ro&immutable=1", db_path.to_string_lossy());
    let conn = rusqlite::Connection::open_with_flags(
        &uri,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_URI,
    )
    .map_err(|source| Error::Sqlite {
        path: db_path.to_path_buf(),
        source,
    })?;

    conn.query_row("SELECT value FROM ItemTable WHERE key = ?1", [key], |r| {
        r.get::<_, String>(0)
    })
    .optional()
    .map_err(|source| Error::Sqlite {
        path: db_path.to_path_buf(),
        source,
    })
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

fn vscode_extensions_dir() -> Option<PathBuf> {
    // Same on every platform — VSCode always uses ~/.vscode/extensions.
    Some(dirs::home_dir()?.join(".vscode").join("extensions"))
}

#[derive(Debug, Deserialize)]
struct ExtensionsIndexEntry {
    location: ExtensionLocation,
}

#[derive(Debug, Deserialize)]
struct ExtensionLocation {
    /// Absolute path to the extension's install directory.
    path: PathBuf,
}

#[derive(Debug, Deserialize)]
struct ExtensionPackageJson {
    contributes: Option<Contributes>,
}

#[derive(Debug, Deserialize)]
struct Contributes {
    #[serde(default, rename = "mcpServerDefinitionProviders")]
    mcp_server_definition_providers: Vec<McpServerProviderContribution>,
}

#[derive(Debug, Deserialize)]
struct McpServerProviderContribution {
    id: String,
}

/// Scan installed VSCode extensions for the `mcpServerDefinitionProviders`
/// contribution point. Each provider declaration becomes one [`McpServer`]
/// with `name = provider.id`.
///
/// This catches extensions like `upstash.context7-mcp` that register MCP
/// servers programmatically via `vscode.lm.registerMcpServerDefinitionProvider`.
/// Those registrations live in VSCode's in-memory runtime and are never
/// persisted to `state.vscdb`, so a static scan of `package.json` files is
/// the only on-disk way to see them.
///
/// Caveats:
/// - Transport is unknown without running the provider; we default to
///   [`Transport::Stdio`] since that's the common case.
/// - We can't tell whether the extension is enabled in any given workspace
///   (per-workspace enable/disable lives in `state.vscdb`); we assume
///   "installed implies in use", same model as how `mcp.json` works.
fn parse_extension_providers(extensions_dir: &Path) -> Vec<McpServer> {
    let index_path = extensions_dir.join("extensions.json");
    if !index_path.exists() {
        return Vec::new();
    }
    let text = match std::fs::read_to_string(&index_path) {
        Ok(t) => t,
        Err(e) => {
            tracing::debug!(file = %index_path.display(), error = %e, "extensions.json read failed");
            return Vec::new();
        }
    };
    let entries: Vec<ExtensionsIndexEntry> = match serde_json::from_str(&text) {
        Ok(e) => e,
        Err(e) => {
            tracing::debug!(file = %index_path.display(), error = %e, "extensions.json parse failed");
            return Vec::new();
        }
    };

    let mut out = Vec::new();
    for ent in entries {
        let pkg_path = ent.location.path.join("package.json");
        if !pkg_path.exists() {
            continue;
        }
        let pkg_text = match std::fs::read_to_string(&pkg_path) {
            Ok(t) => t,
            Err(_) => continue,
        };
        // Extension package.json files are technically JSON but some are
        // shipped as JSONC (comments / trailing commas). Lenient parser
        // matches what VSCode itself does.
        let pkg: ExtensionPackageJson = match serde_json_lenient::from_str(&pkg_text) {
            Ok(p) => p,
            Err(_) => continue,
        };
        let providers = pkg
            .contributes
            .map(|c| c.mcp_server_definition_providers)
            .unwrap_or_default();
        for p in providers {
            out.push(McpServer {
                client: CLIENT_NAME,
                name: p.id,
                transport: Transport::Stdio,
                scope: Scope::Global,
                source: pkg_path.clone(),
            });
        }
    }
    out
}

fn discover_workspaces(db_path: &Path) -> Result<Vec<PathBuf>> {
    if !db_path.exists() {
        tracing::debug!(path = %db_path.display(), "state.vscdb not present");
        return Ok(Vec::new());
    }

    let raw = match read_state_db_value(db_path, "history.recentlyOpenedPathsList")? {
        Some(s) => s,
        None => return Ok(Vec::new()),
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
        path: db_path.to_path_buf(),
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

    /// Build a minimal `state.vscdb` with the canonical `ItemTable` schema
    /// and any number of `(key, value)` rows.
    fn make_test_vscdb(path: &Path, rows: &[(&str, &str)]) {
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
        assert_eq!(by_name["local-tool"].transport, Transport::Stdio);
        assert_eq!(by_name["remote-thing"].transport, Transport::Remote);
    }

    #[test]
    fn parse_file_tolerates_missing_file() {
        assert!(parse_file(Path::new("/definitely/not/here.json"), Scope::Global).is_empty());
    }

    #[test]
    fn parse_file_accepts_line_and_block_comments() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("mcp.json");
        std::fs::write(
            &path,
            r#"// VSCode-style header comment
{
    /* MCP servers I use day-to-day. */
    "servers": {
        // a tool I rely on
        "local-tool": { "command": "npx" /* TODO: pin args */ }
    }
}"#,
        )
        .unwrap();

        let servers = parse_file(&path, Scope::Global);
        assert_eq!(servers.len(), 1);
        assert_eq!(servers[0].name, "local-tool");
        assert_eq!(servers[0].transport, Transport::Stdio);
    }

    #[test]
    fn parse_file_accepts_trailing_commas() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("mcp.json");
        std::fs::write(
            &path,
            r#"{
                "servers": {
                    "a": { "command": "x", "args": ["one", "two",] },
                    "b": { "url": "https://x", },
                },
            }"#,
        )
        .unwrap();

        let servers = parse_file(&path, Scope::Global);
        assert_eq!(servers.len(), 2);
        let by_name: BTreeMap<_, _> = servers.iter().map(|s| (s.name.clone(), s)).collect();
        assert_eq!(by_name["a"].transport, Transport::Stdio);
        assert_eq!(by_name["b"].transport, Transport::Remote);
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
    fn from_paths_watches_global_state_db_and_project_configs() {
        let dir = tempdir().unwrap();
        let global = dir.path().join("user").join("mcp.json");
        let state_db = dir
            .path()
            .join("user")
            .join("globalStorage")
            .join("state.vscdb");
        let proj_a = dir.path().join("proj_a");
        let proj_b = dir.path().join("proj_b");

        let v = VsCode::from_paths(
            Some(global.clone()),
            Some(state_db.clone()),
            [proj_a.clone(), proj_b.clone()],
        );
        let watched = v.watch_paths();
        assert!(watched.contains(&global));
        assert!(watched.contains(&state_db));
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

        let v = VsCode::from_paths(Some(global.clone()), None, [proj.clone()]);
        let servers = v.parse_all().unwrap();

        assert_eq!(servers.len(), 2);
        let by_name: BTreeMap<_, _> = servers.iter().map(|s| (s.name.clone(), s)).collect();
        assert_eq!(by_name["g"].scope, Scope::Global);
        assert_eq!(by_name["g"].transport, Transport::Stdio);
        assert_eq!(by_name["p"].scope, Scope::Project(proj));
        assert_eq!(by_name["p"].transport, Transport::Remote);
    }

    #[test]
    fn parse_mcp_tool_cache_emits_extension_servers_with_correct_transport() {
        let dir = tempdir().unwrap();
        let db = dir.path().join("state.vscdb");
        let value = serde_json::json!({
            "extensionServers": [
                { "id": "ext.foo", "label": "Foo", "serverUrl": "https://foo.example" },
                { "id": "ext.bar", "label": "Bar" }
            ],
            "serverTools": []
        })
        .to_string();
        make_test_vscdb(&db, &[("mcpToolCache", &value)]);

        let servers = parse_mcp_tool_cache(&db);
        assert_eq!(servers.len(), 2);
        let by_name: BTreeMap<_, _> = servers.iter().map(|s| (s.name.clone(), s)).collect();
        assert_eq!(by_name["ext.foo"].transport, Transport::Remote);
        assert_eq!(by_name["ext.bar"].transport, Transport::Stdio);
        for s in &servers {
            assert_eq!(s.scope, Scope::Global);
            assert_eq!(s.source, db);
            assert_eq!(s.client, CLIENT_NAME);
        }
    }

    #[test]
    fn parse_mcp_tool_cache_dedupes_server_tools_against_extension_servers() {
        let dir = tempdir().unwrap();
        let db = dir.path().join("state.vscdb");
        let value = serde_json::json!({
            "extensionServers": [{ "id": "ext.foo" }],
            // ext.foo also appears here — must NOT produce a second entry.
            "serverTools": [["ext.foo", { "tools": [] }]]
        })
        .to_string();
        make_test_vscdb(&db, &[("mcpToolCache", &value)]);

        let servers = parse_mcp_tool_cache(&db);
        assert_eq!(servers.len(), 1);
        assert_eq!(servers[0].name, "ext.foo");
    }

    #[test]
    fn parse_mcp_tool_cache_skips_mcp_config_prefix_in_server_tools() {
        let dir = tempdir().unwrap();
        let db = dir.path().join("state.vscdb");
        let value = serde_json::json!({
            "extensionServers": [],
            "serverTools": [
                ["mcp.config.local-thing", { "tools": [] }],
                ["genuine-extension-id", { "tools": [] }]
            ]
        })
        .to_string();
        make_test_vscdb(&db, &[("mcpToolCache", &value)]);

        let servers = parse_mcp_tool_cache(&db);
        assert_eq!(servers.len(), 1);
        assert_eq!(servers[0].name, "genuine-extension-id");
        assert_eq!(servers[0].transport, Transport::Stdio);
    }

    #[test]
    fn parse_mcp_tool_cache_tolerates_missing_key() {
        let dir = tempdir().unwrap();
        let db = dir.path().join("state.vscdb");
        // DB exists but has no mcpToolCache row.
        make_test_vscdb(&db, &[]);
        assert!(parse_mcp_tool_cache(&db).is_empty());
    }

    #[test]
    fn parse_mcp_tool_cache_tolerates_garbage_value() {
        let dir = tempdir().unwrap();
        let db = dir.path().join("state.vscdb");
        make_test_vscdb(&db, &[("mcpToolCache", "not json")]);
        assert!(parse_mcp_tool_cache(&db).is_empty());
    }

    /// Build a fake `~/.vscode/extensions/` layout: an extensions.json
    /// pointing at one or more extension dirs, each with a package.json.
    fn make_extensions_dir(root: &Path, extensions: &[(&str, /* package_json */ &str)]) -> PathBuf {
        let ext_root = root.join("extensions");
        std::fs::create_dir_all(&ext_root).unwrap();
        let mut index = Vec::new();
        for (id, pkg_json) in extensions {
            let dir = ext_root.join(id);
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(dir.join("package.json"), pkg_json).unwrap();
            index.push(serde_json::json!({
                "identifier": { "id": id },
                "location": { "path": dir.to_string_lossy() }
            }));
        }
        std::fs::write(
            ext_root.join("extensions.json"),
            serde_json::Value::Array(index).to_string(),
        )
        .unwrap();
        ext_root
    }

    #[test]
    fn parse_extension_providers_finds_mcp_server_definition_contributors() {
        let dir = tempdir().unwrap();
        let ext_root = make_extensions_dir(
            dir.path(),
            &[
                (
                    "upstash.context7-mcp-1.0.1",
                    r#"{ "name": "context7-mcp", "publisher": "Upstash",
                         "contributes": { "mcpServerDefinitionProviders": [
                             { "id": "context7", "label": "Context7" }
                         ]} }"#,
                ),
                (
                    "some.other-extension-2.3",
                    r#"{ "name": "other", "publisher": "x",
                         "contributes": { "commands": [] } }"#,
                ),
            ],
        );

        let servers = parse_extension_providers(&ext_root);
        assert_eq!(servers.len(), 1);
        assert_eq!(servers[0].name, "context7");
        assert_eq!(servers[0].transport, Transport::Stdio);
        assert_eq!(servers[0].scope, Scope::Global);
        assert!(servers[0].source.ends_with("package.json"));
    }

    #[test]
    fn parse_extension_providers_supports_multiple_providers_per_extension() {
        let dir = tempdir().unwrap();
        let ext_root = make_extensions_dir(
            dir.path(),
            &[(
                "vendor.multi-1.0",
                r#"{ "name": "multi",
                     "contributes": { "mcpServerDefinitionProviders": [
                         { "id": "alpha", "label": "Alpha" },
                         { "id": "beta",  "label": "Beta"  }
                     ]} }"#,
            )],
        );
        let names: HashSet<String> = parse_extension_providers(&ext_root)
            .into_iter()
            .map(|s| s.name)
            .collect();
        assert!(names.contains("alpha"));
        assert!(names.contains("beta"));
    }

    #[test]
    fn parse_extension_providers_tolerates_missing_index() {
        let dir = tempdir().unwrap();
        // No extensions.json, no extension dirs.
        assert!(parse_extension_providers(dir.path()).is_empty());
    }

    #[test]
    fn parse_extension_providers_tolerates_jsonc_in_package_json() {
        let dir = tempdir().unwrap();
        let ext_root = make_extensions_dir(
            dir.path(),
            &[(
                "vendor.commented-1.0",
                r#"{
                    // VSCode extension manifests sometimes ship with comments.
                    "name": "commented",
                    "contributes": {
                        "mcpServerDefinitionProviders": [
                            { "id": "with-comment" },
                        ],
                    },
                }"#,
            )],
        );
        let servers = parse_extension_providers(&ext_root);
        assert_eq!(servers.len(), 1);
        assert_eq!(servers[0].name, "with-comment");
    }

    #[test]
    fn from_paths_with_extensions_dir_includes_it_in_watch_paths() {
        let dir = tempdir().unwrap();
        let ext_dir = dir.path().join("extensions");
        std::fs::create_dir_all(&ext_dir).unwrap();
        let v = VsCode::from_paths(None, None, std::iter::empty::<PathBuf>())
            .with_extensions_dir(Some(ext_dir.clone()));
        assert!(v.watch_paths().contains(&ext_dir.join("extensions.json")));
    }

    #[test]
    fn parse_all_combines_file_and_state_db_sources() {
        let dir = tempdir().unwrap();
        let global = dir.path().join("mcp.json");
        std::fs::write(&global, r#"{"servers":{"file-srv":{"command":"a"}}}"#).unwrap();

        let db = dir.path().join("state.vscdb");
        let value = serde_json::json!({
            "extensionServers": [{ "id": "ext-srv" }],
            "serverTools": []
        })
        .to_string();
        make_test_vscdb(&db, &[("mcpToolCache", &value)]);

        let v = VsCode::from_paths(Some(global), Some(db), std::iter::empty::<PathBuf>());
        let names: HashSet<String> = v.parse_all().unwrap().into_iter().map(|s| s.name).collect();
        assert!(names.contains("file-srv"));
        assert!(names.contains("ext-srv"));
    }
}
