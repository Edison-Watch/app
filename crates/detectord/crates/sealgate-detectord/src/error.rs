//! Errors surfaced by the public API.

use std::io;
use std::path::PathBuf;

use thiserror::Error;

/// All errors the library can surface. `Send + Sync` so it can cross threads
/// (used by [`crate::Watcher::spawn`]).
#[derive(Debug, Error)]
pub enum Error {
    /// Failure inside the underlying filesystem watcher (creating it,
    /// registering a directory, etc.).
    #[error("filesystem watcher: {0}")]
    Notify(#[from] notify::Error),

    /// I/O failure while reading a config file. The `path` field carries the
    /// file the failure was attributed to.
    #[error("I/O error at {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: io::Error,
    },

    /// SQLite failure while reading an editor's state database (e.g. VSCode's
    /// or Cursor's `state.vscdb`).
    #[cfg(any(feature = "vscode", feature = "cursor"))]
    #[error("sqlite error at {path}: {source}")]
    Sqlite {
        path: PathBuf,
        #[source]
        source: rusqlite::Error,
    },

    /// JSON parse failure on a config file. The `path` field carries the
    /// file that failed to parse.
    #[error("JSON parse error at {path}: {source}")]
    Json {
        path: PathBuf,
        #[source]
        source: serde_json::Error,
    },

    /// Could not spawn the background worker thread used by
    /// [`crate::Watcher::spawn`].
    #[error("failed to spawn watcher thread: {0}")]
    Thread(#[source] io::Error),
}

/// Convenience alias: [`std::result::Result`] with this crate's [`enum@Error`].
pub type Result<T> = std::result::Result<T, Error>;
