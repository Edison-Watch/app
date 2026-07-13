//! Read + write a single `ItemTable(key, value)` row of a `state.vscdb` SQLite
//! DB. Unlike the read-only reader in `mcp_detector_lib`, this opens read-write
//! so quarantine can rewrite the row's JSON value.
//!
//! Note on the live-DB race: Cursor/VSCode may hold the DB open and rewrite the
//! row from their in-memory cache, undoing our edit. We open read-write with a
//! busy timeout; the level-triggered reconcile re-quarantines on the next pass
//! if the editor puts the server back — same tolerance model as client_2.

use std::path::Path;
use std::time::Duration;

use rusqlite::OptionalExtension;

use crate::error::{Error, Result};

const BUSY_TIMEOUT: Duration = Duration::from_secs(3);

fn sqlite_err(path: &Path, e: rusqlite::Error) -> Error {
    Error::Json {
        path: path.to_path_buf(),
        message: format!("sqlite: {e}"),
    }
}

/// Read the JSON value of `key`, or `None` if the row is absent.
pub(crate) fn read_row(db_path: &Path, key: &str) -> Result<Option<String>> {
    let conn = rusqlite::Connection::open(db_path).map_err(|e| sqlite_err(db_path, e))?;
    conn.busy_timeout(BUSY_TIMEOUT)
        .map_err(|e| sqlite_err(db_path, e))?;
    conn.query_row("SELECT value FROM ItemTable WHERE key = ?1", [key], |r| {
        r.get::<_, String>(0)
    })
    .optional()
    .map_err(|e| sqlite_err(db_path, e))
}

/// Overwrite the JSON value of `key` (read-write open + `UPDATE`).
pub(crate) fn write_row(db_path: &Path, key: &str, value: &str) -> Result<()> {
    let conn = rusqlite::Connection::open(db_path).map_err(|e| sqlite_err(db_path, e))?;
    conn.busy_timeout(BUSY_TIMEOUT)
        .map_err(|e| sqlite_err(db_path, e))?;
    conn.execute(
        "UPDATE ItemTable SET value = ?1 WHERE key = ?2",
        rusqlite::params![value, key],
    )
    .map_err(|e| sqlite_err(db_path, e))?;
    Ok(())
}
