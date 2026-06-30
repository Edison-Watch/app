//! Normalised representation of an MCP server and the change events the
//! watcher emits about them.

use std::collections::BTreeMap;
use std::path::PathBuf;

/// One MCP server entry, parsed out of some agent's config and normalised to a
/// shape that's the same regardless of where it came from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiscoveredServer {
    /// Identifier of the producing [`crate::Client`] (e.g. `"vscode"`,
    /// `"claude_code"`). Useful for filtering events by source.
    pub client: &'static str,
    /// Server name as it appears in the config (the key under `servers` /
    /// `mcpServers`).
    pub name: String,
    /// Whether the server is reached via a child-process pipe ([`Transport::Stdio`])
    /// or over the network ([`Transport::Remote`]).
    pub transport: Transport,
    /// Whether the server applies globally across the agent or only inside a
    /// specific project directory. See [`Scope`].
    pub scope: Scope,
    /// Raw launch config: the payload needed to fingerprint and to act on the
    /// server. [`ServerConfig::Opaque`] marks an entry with no launch config
    /// (report-only, or removable-locally-only — see the variant).
    pub config: ServerConfig,
    /// Where the entry lives on disk and how to mutate it. The parent directory
    /// of [`ConfigLocation::path`] is what the watcher subscribes to.
    pub location: ConfigLocation,
}

/// How a client talks to a given MCP server.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Transport {
    /// Spawned as a subprocess, communicating over stdio.
    Stdio,
    /// Reached over the network via HTTP, SSE, or streamable-HTTP.
    Remote,
}

impl std::fmt::Display for Transport {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Transport::Stdio => write!(f, "stdio"),
            Transport::Remote => write!(f, "remote"),
        }
    }
}

/// Where the server is configured: globally for the client, or only inside a
/// specific project directory.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum Scope {
    /// User-level / global to the whole client.
    Global,
    /// Configured inside a specific project directory (carried as the absolute
    /// project path).
    Project(PathBuf),
}

impl std::fmt::Display for Scope {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Scope::Global => write!(f, "scope=global"),
            Scope::Project(p) => write!(f, "scope=project project_dir={}", p.display()),
        }
    }
}

/// Raw, normalised launch configuration for a server — the payload the daemon
/// needs both to compute the [fingerprint](crate::fingerprint) and to act on
/// the server. Mirrors the stdio/http arms of client_2's `McpServerConfig`
/// union; the unsupported/opaque arm (no extractable command or url) is simply
/// not emitted by adapters, so it has no variant here.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum ServerConfig {
    /// Spawned as a subprocess over stdio.
    Stdio {
        command: String,
        args: Vec<String>,
        /// Environment overrides. Note: env values never feed the fingerprint
        /// (only `command`/`args` do), but they are carried for actioning.
        env: BTreeMap<String, String>,
    },
    /// Reached over the network.
    Http {
        url: String,
        headers: BTreeMap<String, String>,
        kind: HttpKind,
    },
    /// Discovered but with no extractable command/url, so it cannot be
    /// fingerprinted or submitted to Edison Watch.
    ///
    /// `removable` distinguishes the two report-only cases: when `true` we can
    /// still *neutralise it locally* (delete the entry / rename its dir) even
    /// though we can't move it to EW — so enforcement removes it. When `false`
    /// it is genuinely untouchable (no access to its storage) and stays
    /// report-only.
    Opaque {
        removable: bool,
        reason: OpaqueReason,
    },
}

/// Why a discovered server is [`ServerConfig::Opaque`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum OpaqueReason {
    /// VSCode extension contributing `mcpServerDefinitionProviders` — registered
    /// in-process; no config and nothing we own to remove (untouchable).
    ExtensionProvider,
    /// An extension-registered server in `state.vscdb` with no resolvable
    /// command/url — removable from the state DB.
    ExtensionServer,
    /// Cursor marketplace plugin (`SERVER_METADATA.json`) — removable by
    /// renaming the plugin directory.
    CursorPlugin,
}

/// Flavour of a remote transport. Metadata only — it does not affect the
/// fingerprint (which keys on the url alone).
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum HttpKind {
    /// `type` absent but a `url` is present, or `type: "http"`.
    Http,
    /// `type: "sse"`.
    Sse,
    /// `type: "streamable-http"`.
    StreamableHttp,
}

/// Where a discovered server lives on disk and how it must be mutated. Produced
/// by the adapter during discovery so the (separate) writer never has to
/// re-derive an agent's schema — it dispatches purely on [`SourceKind`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfigLocation {
    /// Selects the write mechanism.
    pub kind: SourceKind,
    /// The config file (or, for [`SourceKind::CursorPluginDir`], the plugin dir).
    pub path: PathBuf,
    /// Path to the servers map within the file, e.g. `["mcpServers"]`,
    /// `["servers"]`, or `["projects", "/abs/proj", "mcpServers"]`.
    pub key_path: Vec<String>,
    /// The map key to remove (the original on-disk name, pre any rename).
    pub server_key: String,
    /// Mechanism-specific extra data the writer needs.
    pub extra: LocationExtra,
}

/// The write mechanism a [`ConfigLocation`] dispatches to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum SourceKind {
    /// Plain JSON edited surgically.
    Json,
    /// JSON-with-comments edited surgically (VSCode `mcp.json`, `.claude.json`).
    Jsonc,
    /// TOML (Codex).
    Toml,
    /// A SQLite state DB row (VSCode/Cursor marketplace `state.vscdb`).
    SqliteState,
    /// Removed via the `claude mcp remove` CLI (Claude Code project scope).
    ClaudeCli,
    /// Neutralised by renaming the plugin directory (Cursor plugins).
    CursorPluginDir,
}

/// How to install the `edison-watch` proxy entry into an agent's config — the
/// inverse of quarantine (we *add* an entry). Produced by
/// [`Agent::edison_install`](crate::Agent::edison_install).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EdisonInstall {
    /// The config file to write the entry into (created if absent).
    pub path: PathBuf,
    /// Path to the servers map within the file, e.g. `["mcpServers"]`,
    /// `["servers"]`, `["mcp_servers"]`.
    pub key_path: Vec<String>,
    /// The shape of the injected entry.
    pub style: EdisonStyle,
    /// The `?client=<id>` value (the app id, e.g. `cursor`, `claude-code`).
    pub client_id: String,
    /// Prefer the agent's own CLI (`claude mcp add`) over a direct file write,
    /// falling back to `path` if the CLI is unavailable. Claude Code needs this.
    pub prefer_cli: bool,
}

/// The shape of an installed `edison-watch` entry.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EdisonStyle {
    /// `{ "type": "http", "url": … }` in a JSON/JSONC file.
    Http,
    /// `{ "command": "npx", "args": ["-y","mcp-remote", url] }` — for stdio-only
    /// clients (Claude Desktop / Cowork).
    StdioShim,
    /// `[mcp_servers.edison-watch]` in a TOML file (Codex).
    Toml,
}

/// How to inject Edison Watch hooks into an agent's config (phase-2 mirror of
/// [`EdisonInstall`]). The injected commands run scripts materialised into
/// `~/.edison-watch/`; the scripts are self-contained (they only write files
/// there — no network).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HookInstall {
    /// The config file the hooks go into.
    pub path: PathBuf,
    /// How the hooks nest in that file.
    pub style: HookStyle,
    /// The client id passed to the registration script (e.g. `claude-code`).
    pub client_id: String,
    /// The hook bindings to inject.
    pub events: Vec<HookBinding>,
}

/// The per-agent shape of injected hooks.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HookStyle {
    /// Claude Code `~/.claude/settings.json`:
    /// `hooks.<Event> = [{ matcher, hooks: [{type, command}] }]`.
    ClaudeSettings,
    /// Cursor `~/.cursor/hooks.json`: `hooks.<event> = [{type, command}]`.
    CursorHooks,
    /// VSCode Copilot `~/.copilot/hooks/edison-watch.json`: the whole file is
    /// Edison-owned.
    CopilotFile,
    /// Codex `~/.codex/config.toml`: `[[hooks.<Event>]]\ncommand = "…"`.
    CodexToml,
}

/// One hook binding: an event, an optional matcher, and which script it runs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HookBinding {
    /// The event key in the config (e.g. `UserPromptSubmit`, `beforeMCPExecution`).
    pub event: String,
    /// Claude Code tool matcher (`*`, `mcp__*`); ignored by other styles.
    pub matcher: Option<String>,
    /// Which materialised script this binding runs.
    pub script: HookScriptKind,
    /// Whether the command passes the client id as an argument (registration).
    pub pass_client_arg: bool,
}

impl HookBinding {
    /// Terse constructor for the per-agent binding tables.
    pub fn new(
        event: &str,
        matcher: Option<&str>,
        script: HookScriptKind,
        pass_client_arg: bool,
    ) -> Self {
        Self {
            event: event.to_string(),
            matcher: matcher.map(str::to_string),
            script,
            pass_client_arg,
        }
    }
}

/// Which of the four materialised scripts a [`HookBinding`] runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HookScriptKind {
    /// `edison-hook.sh <client>` — writes a project-registration pending file.
    Registration,
    /// `edison-session-start.py` — persists the session id.
    SessionStart,
    /// `edison-session-hook.py` — tags MCP tool calls with the conversation id.
    SessionHook,
    /// `edison-session-end.py` — writes a session-end pending file.
    SessionEnd,
}

/// Mechanism-specific data carried by a [`ConfigLocation`].
#[derive(Debug, Clone, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
pub enum LocationExtra {
    /// Nothing extra needed.
    #[default]
    None,
    /// Absolute project directory to run `claude mcp remove` in, for
    /// [`SourceKind::ClaudeCli`].
    ClaudeProjectDir(PathBuf),
    /// The server lives inside a `state.vscdb` row's JSON value
    /// ([`SourceKind::SqliteState`]).
    StateDb {
        /// The `ItemTable` key of the row (e.g. `anysphere.cursor-mcp`,
        /// `mcpToolCache`).
        item_key: String,
        /// How the server is embedded in that row's JSON value.
        shape: StateShape,
    },
}

/// How a server sits inside a `state.vscdb` row's JSON value.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum StateShape {
    /// A key in a JSON object (`server_key` is the object key; the value is the
    /// server, e.g. a URL string). Cursor marketplace OAuth.
    ObjectKey,
    /// An element of a JSON array, matched by its `id` field (`server_key` is
    /// the id); `array_key` names the array within the row. VSCode
    /// `mcpToolCache.extensionServers`.
    ArrayById { array_key: String },
}

/// Something happened to a tracked MCP server.
///
/// Modifications to an existing server are not reported - only additions and
/// removals.
#[derive(Debug, Clone)]
pub enum ChangeEvent {
    /// A new server was added to a tracked config (or one appeared because a
    /// new project's config came online).
    Added(DiscoveredServer),
    /// A previously-known server disappeared from its config.
    Removed(DiscoveredServer),
}

impl std::fmt::Display for ChangeEvent {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let (tag, s) = match self {
            ChangeEvent::Added(s) => ("ADDED", s),
            ChangeEvent::Removed(s) => ("REMOVED", s),
        };
        write!(
            f,
            "{} client={} name={} {} transport={} source={}",
            tag,
            s.client,
            s.name,
            s.scope,
            s.transport,
            s.location.path.display(),
        )
    }
}
