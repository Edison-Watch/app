//! Claude Code [`Agent`] implementation. Watches `~/.claude.json` (which
//! contains both the global `mcpServers` map and a `projects` sub-map with
//! per-project servers) plus a `.mcp.json` inside every project listed in
//! that file.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::Deserialize;

use crate::agent::Agent;
use crate::clients::common::{read_strict_json, servers_from_map};
use crate::clients::{detect_transport, server_config_from_value};
use crate::error::{Error, Result};
use crate::types::{
    ConfigLocation, DiscoveredServer, HookBinding, HookInstall, HookScriptKind, HookStyle,
    LocationExtra, Scope, SealGateInstall, SealGateStyle, SourceKind,
};
use crate::watch::WatchTargets;

const CLIENT_NAME: &str = "claude_code";

/// Claude Code MCP-config source.
///
/// Construct with [`ClaudeCode::discover`], then hand it to a
/// [`Watcher`](crate::Watcher).
pub struct ClaudeCode {
    /// `~/.claude.json` - single user-level file that holds both global
    /// servers and a `projects` map with per-project servers.
    user_config: Option<PathBuf>,
    /// `~/.claude/settings.json` - user settings, `mcpServers` + per-profile
    /// `profiles.<name>.mcpServers`.
    settings: Option<PathBuf>,
    /// `~/.claude/settings.local.json` - local overrides, same shape.
    settings_local: Option<PathBuf>,
    /// `~/.claude/mcp_servers.json` - dedicated file, either `{mcpServers:{...}}`
    /// or a direct name→config map.
    dedicated: Option<PathBuf>,
    /// Enterprise/managed config (`managed-mcp.json`), key `mcpServers`.
    managed: Option<PathBuf>,
    /// (project_dir, path to `<project>/.mcp.json`) for each project CC knows
    /// about. `.mcp.json` is the committed, project-scoped servers file.
    project_configs: Vec<(PathBuf, PathBuf)>,
}

impl ClaudeCode {
    /// Locate Claude Code's config files: `~/.claude.json` plus a `.mcp.json`
    /// in every project directory enumerated under that file's `projects`
    /// map.
    ///
    /// Returns `Ok` even if `~/.claude.json` is absent or unreadable - the
    /// resulting `ClaudeCode` simply has no paths to watch.
    pub fn discover() -> Result<Self> {
        let home = dirs::home_dir();
        let user_config = home.as_ref().map(|h| h.join(".claude.json"));
        let claude_dir = home.as_ref().map(|h| h.join(".claude"));
        let settings = claude_dir.as_ref().map(|d| d.join("settings.json"));
        let settings_local = claude_dir.as_ref().map(|d| d.join("settings.local.json"));
        let dedicated = claude_dir.as_ref().map(|d| d.join("mcp_servers.json"));
        let managed = managed_config_path();

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
            settings,
            settings_local,
            dedicated,
            managed,
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
            settings: None,
            settings_local: None,
            dedicated: None,
            managed: None,
            project_configs,
        }
    }

    /// Construct with every source named explicitly (tests / non-standard
    /// installs). `from_paths` is the shorthand for the common case.
    pub fn from_parts(
        user_config: Option<PathBuf>,
        settings: Option<PathBuf>,
        settings_local: Option<PathBuf>,
        dedicated: Option<PathBuf>,
        managed: Option<PathBuf>,
        project_dirs: impl IntoIterator<Item = PathBuf>,
    ) -> Self {
        Self {
            settings,
            settings_local,
            dedicated,
            managed,
            ..Self::from_paths(user_config, project_dirs)
        }
    }
}

impl Agent for ClaudeCode {
    fn name(&self) -> &'static str {
        CLIENT_NAME
    }

    /// Installed if ANY of the files Claude Code keeps MCP servers in exists.
    ///
    /// `~/.claude.json` is the usual one, but servers live just as legitimately
    /// in `~/.claude/settings.json`, `settings.local.json`, the dedicated
    /// `mcp_servers.json`, or an enterprise-managed file. Keying off
    /// `~/.claude.json` alone made a machine configured through any of the
    /// others look absent - which skipped hook injection for it (see
    /// `apply_hooks`) and, in the app, hid its servers from review.
    fn is_installed(&self) -> bool {
        [
            &self.user_config,
            &self.settings,
            &self.settings_local,
            &self.dedicated,
            &self.managed,
        ]
        .into_iter()
        .flatten()
        .any(|p| p.exists())
    }

    fn watch_targets(&self) -> WatchTargets {
        let mut files = Vec::new();
        for p in [
            &self.user_config,
            &self.settings,
            &self.settings_local,
            &self.dedicated,
            &self.managed,
        ]
        .into_iter()
        .flatten()
        {
            files.push(p.clone());
        }
        for (_, cfg) in &self.project_configs {
            files.push(cfg.clone());
        }
        WatchTargets {
            files,
            dirs: Vec::new(),
            needs_periodic_rescan: false,
        }
    }

    fn discover(&self) -> Result<Vec<DiscoveredServer>> {
        let mut out = Vec::new();
        if let Some(uc) = &self.user_config
            && uc.exists()
        {
            out.extend(parse_user_config(uc));
        }
        // settings.json / settings.local.json: global `mcpServers` + profiles.
        for p in [&self.settings, &self.settings_local].into_iter().flatten() {
            if p.exists() {
                out.extend(parse_settings(p));
            }
        }
        if let Some(p) = &self.dedicated
            && p.exists()
        {
            out.extend(parse_dedicated(p));
        }
        if let Some(p) = &self.managed
            && p.exists()
        {
            out.extend(servers_from_map(
                &read_strict_json(p).unwrap_or_default(),
                "mcpServers",
                CLIENT_NAME,
                Scope::Global,
                SourceKind::Jsonc,
                p,
            ));
        }
        for (project, cfg) in &self.project_configs {
            if cfg.exists() {
                out.extend(parse_project_mcp(cfg, project.clone()));
            }
        }
        Ok(out)
    }

    fn sealgate_installs(&self, home: &std::path::Path) -> Vec<SealGateInstall> {
        // Prefer the `claude mcp add` CLI (Claude Code misbehaves without it);
        // the file target is the fallback.
        vec![SealGateInstall {
            path: home.join(".claude.json"),
            key_path: vec!["mcpServers".into()],
            style: SealGateStyle::Http,
            client_id: "claude-code".into(),
            prefer_cli: true,
        }]
    }

    fn hook_install(&self, home: &std::path::Path) -> Option<HookInstall> {
        // Hooks live in ~/.claude/settings.json (not ~/.claude.json).
        Some(HookInstall {
            path: home.join(".claude/settings.json"),
            style: HookStyle::ClaudeSettings,
            client_id: "claude-code".into(),
            events: vec![
                HookBinding::new(
                    "UserPromptSubmit",
                    Some("*"),
                    HookScriptKind::Registration,
                    true,
                ),
                HookBinding::new(
                    "PreToolUse",
                    Some("mcp__*"),
                    HookScriptKind::SessionHook,
                    false,
                ),
                HookBinding::new(
                    "SessionStart",
                    Some("*"),
                    HookScriptKind::SessionStart,
                    false,
                ),
                HookBinding::new("SessionEnd", Some("*"), HookScriptKind::SessionEnd, false),
            ],
        })
    }
}

/// Enterprise/managed config path (`managed-mcp.json`), per OS.
fn managed_config_path() -> Option<PathBuf> {
    if cfg!(target_os = "macos") {
        Some(PathBuf::from(
            "/Library/Application Support/ClaudeCode/managed-mcp.json",
        ))
    } else if cfg!(target_os = "windows") {
        Some(PathBuf::from(r"C:\ProgramData\ClaudeCode\managed-mcp.json"))
    } else {
        Some(PathBuf::from("/etc/claude-code/managed-mcp.json"))
    }
}

/// Parse `settings.json` / `settings.local.json`: top-level `mcpServers` plus
/// per-profile `profiles.<name>.mcpServers`.
fn parse_settings(path: &Path) -> Vec<DiscoveredServer> {
    let Some(root) = read_strict_json(path) else {
        return Vec::new();
    };
    let mut out = servers_from_map(
        &root,
        "mcpServers",
        CLIENT_NAME,
        Scope::Global,
        SourceKind::Jsonc,
        path,
    );
    if let Some(profiles) = root.get("profiles").and_then(|v| v.as_object()) {
        for (profile, pval) in profiles {
            let Some(map) = pval.get("mcpServers").and_then(|v| v.as_object()) else {
                continue;
            };
            for (name, val) in map {
                let Some(config) = server_config_from_value(val) else {
                    continue;
                };
                out.push(DiscoveredServer {
                    client: CLIENT_NAME,
                    transport: detect_transport(val),
                    scope: Scope::Global,
                    config,
                    location: ConfigLocation {
                        kind: SourceKind::Jsonc,
                        path: path.to_path_buf(),
                        key_path: vec!["profiles".into(), profile.clone(), "mcpServers".into()],
                        server_key: name.clone(),
                        extra: LocationExtra::None,
                    },
                    name: name.clone(),
                });
            }
        }
    }
    out
}

/// Parse `mcp_servers.json`: either `{ "mcpServers": {...} }` or a direct
/// name→config map at the root.
fn parse_dedicated(path: &Path) -> Vec<DiscoveredServer> {
    let Some(root) = read_strict_json(path) else {
        return Vec::new();
    };
    if root.get("mcpServers").is_some() {
        return servers_from_map(
            &root,
            "mcpServers",
            CLIENT_NAME,
            Scope::Global,
            SourceKind::Jsonc,
            path,
        );
    }
    // Direct map: each top-level key is a server (key_path empty).
    let Some(map) = root.as_object() else {
        return Vec::new();
    };
    map.iter()
        .filter_map(|(name, val)| {
            let config = server_config_from_value(val)?;
            Some(DiscoveredServer {
                client: CLIENT_NAME,
                transport: detect_transport(val),
                scope: Scope::Global,
                config,
                location: ConfigLocation {
                    kind: SourceKind::Jsonc,
                    path: path.to_path_buf(),
                    key_path: Vec::new(),
                    server_key: name.clone(),
                    extra: LocationExtra::None,
                },
                name: name.clone(),
            })
        })
        .collect()
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

fn parse_user_config(path: &Path) -> Vec<DiscoveredServer> {
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
        let Some(config) = server_config_from_value(&val) else {
            continue;
        };
        out.push(DiscoveredServer {
            client: CLIENT_NAME,
            transport: detect_transport(&val),
            scope: Scope::Global,
            config,
            location: ConfigLocation {
                kind: SourceKind::Jsonc,
                path: path.to_path_buf(),
                key_path: vec!["mcpServers".into()],
                server_key: name.clone(),
                extra: LocationExtra::None,
            },
            name,
        });
    }
    for (project_path_str, entry) in cfg.projects {
        let project_path = PathBuf::from(&project_path_str);
        for (name, val) in entry.mcp_servers {
            let Some(config) = server_config_from_value(&val) else {
                continue;
            };
            // Project-scoped servers embedded in ~/.claude.json are removed via
            // the `claude mcp remove` CLI, not by editing the file directly.
            out.push(DiscoveredServer {
                client: CLIENT_NAME,
                transport: detect_transport(&val),
                scope: Scope::Project(project_path.clone()),
                config,
                location: ConfigLocation {
                    kind: SourceKind::ClaudeCli,
                    path: path.to_path_buf(),
                    key_path: vec![
                        "projects".into(),
                        project_path_str.clone(),
                        "mcpServers".into(),
                    ],
                    server_key: name.clone(),
                    extra: LocationExtra::ClaudeProjectDir(project_path.clone()),
                },
                name,
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

fn parse_project_mcp(path: &Path, project: PathBuf) -> Vec<DiscoveredServer> {
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
        .filter_map(|(name, val)| {
            let config = server_config_from_value(&val)?;
            Some(DiscoveredServer {
                client: CLIENT_NAME,
                transport: detect_transport(&val),
                scope: Scope::Project(project.clone()),
                config,
                location: ConfigLocation {
                    kind: SourceKind::Jsonc,
                    path: path.to_path_buf(),
                    key_path: vec!["mcpServers".into()],
                    server_key: name.clone(),
                    extra: LocationExtra::None,
                },
                name,
            })
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
    fn settings_parses_global_and_profile_servers() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(
            &path,
            r#"{
                "mcpServers": { "g": { "command": "node" } },
                "profiles": {
                    "work": { "mcpServers": { "p": { "type": "http", "url": "https://x" } } }
                }
            }"#,
        )
        .unwrap();

        let servers = parse_settings(&path);
        assert_eq!(servers.len(), 2);
        let by: BTreeMap<_, _> = servers.iter().map(|s| (s.name.clone(), s)).collect();
        assert_eq!(by["g"].location.key_path, vec!["mcpServers".to_string()]);
        assert_eq!(
            by["p"].location.key_path,
            vec![
                "profiles".to_string(),
                "work".to_string(),
                "mcpServers".to_string()
            ]
        );
    }

    #[test]
    fn dedicated_handles_both_shapes() {
        let dir = tempdir().unwrap();
        let wrapped = dir.path().join("a.json");
        std::fs::write(&wrapped, r#"{"mcpServers":{"a":{"command":"x"}}}"#).unwrap();
        assert_eq!(parse_dedicated(&wrapped).len(), 1);

        let direct = dir.path().join("b.json");
        std::fs::write(&direct, r#"{"b":{"command":"y"},"c":{"url":"https://z"}}"#).unwrap();
        let servers = parse_dedicated(&direct);
        assert_eq!(servers.len(), 2);
        assert!(servers.iter().all(|s| s.location.key_path.is_empty()));
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
        let watched = cc.watch_targets().files;
        assert!(watched.contains(&user));
        assert!(watched.contains(&proj.join(".mcp.json")));
    }

    #[test]
    fn from_paths_parse_all_combines_user_and_project_configs() {
        let dir = tempdir().unwrap();
        let user = dir.path().join(".claude.json");
        std::fs::write(&user, r#"{"mcpServers":{"u":{"command":"node"}}}"#).unwrap();
        let proj = dir.path().join("p");
        std::fs::create_dir_all(&proj).unwrap();
        std::fs::write(
            proj.join(".mcp.json"),
            r#"{"mcpServers":{"p":{"type":"http","url":"https://x"}}}"#,
        )
        .unwrap();

        let cc = ClaudeCode::from_paths(Some(user.clone()), [proj.clone()]);
        let servers = cc.discover().unwrap();

        assert_eq!(servers.len(), 2);
        let by_name: BTreeMap<_, _> = servers.iter().map(|s| (s.name.clone(), s)).collect();
        assert_eq!(by_name["u"].scope, Scope::Global);
        assert_eq!(by_name["u"].transport, Transport::Stdio);
        assert_eq!(by_name["p"].scope, Scope::Project(proj));
        assert_eq!(by_name["p"].transport, Transport::Remote);
    }

    /// Servers configured through `settings.json` (no `~/.claude.json` at all)
    /// still mean Claude Code is in use. Reporting otherwise skipped hook
    /// injection and hid those servers from the app's review list.
    #[test]
    fn installed_when_only_settings_json_exists() {
        let dir = tempdir().unwrap();
        let claude_dir = dir.path().join(".claude");
        std::fs::create_dir_all(&claude_dir).unwrap();
        let settings = claude_dir.join("settings.json");
        std::fs::write(&settings, r#"{"mcpServers":{"s":{"command":"x"}}}"#).unwrap();

        let agent = ClaudeCode::from_parts(None, Some(settings), None, None, None, []);
        assert!(agent.is_installed());
        assert_eq!(
            agent.discover().unwrap().len(),
            1,
            "and its servers are found"
        );
    }

    #[test]
    fn not_installed_when_no_config_source_exists() {
        let dir = tempdir().unwrap();
        let agent = ClaudeCode::from_parts(
            Some(dir.path().join("absent.json")),
            Some(dir.path().join(".claude/settings.json")),
            None,
            None,
            None,
            [],
        );
        assert!(!agent.is_installed());
    }
}
