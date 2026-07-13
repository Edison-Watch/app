//! Shared error type for the quarantine layer.

use std::path::PathBuf;

/// Errors from config mutation and the seen-store.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("io at {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("json at {path}: {message}")]
    Json { path: PathBuf, message: String },
    #[error("server '{0}' not found at the expected location")]
    NotFound(String),
    #[error("expected an object at key path {0:?}")]
    NotAnObject(Vec<String>),
    #[error("server config is not actionable (unsupported/report-only)")]
    NotActionable,
    #[error("no writer implemented for source kind {0:?}")]
    UnsupportedKind(mcp_detector_lib::SourceKind),
}

pub type Result<T> = std::result::Result<T, Error>;
