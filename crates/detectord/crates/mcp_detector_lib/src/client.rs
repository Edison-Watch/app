//! The [`Client`] trait - the extension point for adding support for a new
//! MCP client.

use std::path::PathBuf;

use crate::error::Result;
use crate::types::McpServer;

/// A source of MCP server configuration that the watcher can observe.
///
/// Implementations are typically constructed by a `discover()` constructor
/// that does the one-time work of locating their config files (potentially
/// reading other state, e.g. an editor's recent-workspaces database).
///
/// The [`Watcher`](crate::Watcher) requires `Send + Sync` so a list of clients
/// can be shared across threads via `Arc<dyn Client>`.
pub trait Client: Send + Sync {
    /// Stable, machine-readable identifier (e.g. `"vscode"`, `"claude_code"`).
    /// Surfaced in [`McpServer::client`] and used in log lines.
    fn name(&self) -> &'static str;

    /// Files this client uses for MCP configuration.
    ///
    /// The watcher subscribes to each path's **parent directory**, not the
    /// file itself, because most editors write configs via atomic rename
    /// (create temp + rename over target) and that pattern invalidates
    /// single-file watches. Returning a non-existent path is fine - the
    /// watcher will simply skip the parent dir if it does not exist either.
    fn watch_paths(&self) -> Vec<PathBuf>;

    /// Read every configured source and return all currently-defined servers.
    ///
    /// Called on startup (to seed the snapshot) and again on every debounced
    /// filesystem event. Implementations should be tolerant of missing or
    /// malformed files - log and return what was parseable rather than
    /// erroring out, so one broken config can't kill the detector.
    fn parse_all(&self) -> Result<Vec<McpServer>>;
}
