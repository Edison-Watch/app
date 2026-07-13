//! What an [`Agent`](crate::Agent) wants watched.

use std::path::PathBuf;

/// The filesystem locations an agent's config is spread across, plus whether it
/// has sources that change *without* emitting fs events (a SQLite state DB, an
/// extension API), which a driver must catch via a periodic rescan.
#[derive(Debug, Clone, Default)]
pub struct WatchTargets {
    /// Individual files to watch. A driver typically subscribes to each file's
    /// parent directory, since editors write configs via atomic rename, which
    /// invalidates single-file watches.
    pub files: Vec<PathBuf>,
    /// Directories to watch to a given depth — e.g. a workspace-storage or
    /// plugin-cache dir where new projects/plugins appear over time.
    pub dirs: Vec<WatchDir>,
    /// True when this agent has sources that mutate without firing fs events
    /// (e.g. VSCode's `state.vscdb`, extension-API installs). A level-triggered
    /// driver should fall back to a periodic rescan to catch them.
    pub needs_periodic_rescan: bool,
}

/// A directory to watch recursively to a bounded depth.
#[derive(Debug, Clone)]
pub struct WatchDir {
    pub path: PathBuf,
    /// Recursion depth (`0` = the directory itself only).
    pub depth: usize,
}
