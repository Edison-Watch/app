//! Normalised representation of an MCP server and the change events the
//! watcher emits about them.

use std::path::PathBuf;

/// One MCP server entry, parsed out of some client's config and normalised
/// to a shape that's the same regardless of where it came from.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct McpServer {
    /// Identifier of the producing [`crate::Client`] (e.g. `"vscode"`,
    /// `"claude_code"`). Useful for filtering events by source.
    pub client: &'static str,
    /// Server name as it appears in the config (the key under `servers` /
    /// `mcpServers`).
    pub name: String,
    /// Whether the server is reached via a child-process pipe ([`Transport::Stdio`])
    /// or over the network ([`Transport::Remote`]). Detected from the entry's
    /// shape: presence of a `url` or a `type` of `http`/`sse`/`streamable-http`
    /// implies remote.
    pub transport: Transport,
    /// Whether the server applies globally across the client or only inside a
    /// specific project directory. See [`Scope`].
    pub scope: Scope,
    /// On-disk file the entry was parsed from. The parent directory of this
    /// path is what the watcher actually subscribes to.
    pub source: PathBuf,
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

/// Something happened to a tracked MCP server.
///
/// Modifications to an existing server are not reported — only additions and
/// removals.
#[derive(Debug, Clone)]
pub enum ChangeEvent {
    /// A new server was added to a tracked config (or one appeared because a
    /// new project's config came online).
    Added(McpServer),
    /// A previously-known server disappeared from its config.
    Removed(McpServer),
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
            s.source.display(),
        )
    }
}
