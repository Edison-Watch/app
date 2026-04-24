use std::path::PathBuf;

use crate::error::Result;
use crate::types::McpServer;

pub trait Client: Send + Sync {
    fn name(&self) -> &'static str;

    /// Files this client uses for MCP configuration. The watcher watches each
    /// file's parent directory (editors often write via atomic rename, which
    /// invalidates single-file watches).
    fn watch_paths(&self) -> Vec<PathBuf>;

    fn parse_all(&self) -> Result<Vec<McpServer>>;
}
