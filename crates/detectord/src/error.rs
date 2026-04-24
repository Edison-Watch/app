use std::io;
use std::path::PathBuf;

use thiserror::Error;

/// All errors the library can surface. `Send + Sync` so it can cross threads
/// (used by [`crate::Watcher::spawn`]).
#[derive(Debug, Error)]
pub enum Error {
    #[error("filesystem watcher: {0}")]
    Notify(#[from] notify::Error),

    #[error("I/O error at {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: io::Error,
    },

    #[cfg(feature = "vscode")]
    #[error("sqlite error at {path}: {source}")]
    Sqlite {
        path: PathBuf,
        #[source]
        source: rusqlite::Error,
    },

    #[error("JSON parse error at {path}: {source}")]
    Json {
        path: PathBuf,
        #[source]
        source: serde_json::Error,
    },

    #[error("failed to spawn watcher thread: {0}")]
    Thread(#[source] io::Error),
}

pub type Result<T> = std::result::Result<T, Error>;
