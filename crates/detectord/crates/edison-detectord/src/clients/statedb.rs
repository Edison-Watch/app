//! Shared reader for editor "state DB" files (`state.vscdb`) — a SQLite
//! `ItemTable(key TEXT, value BLOB)`. Used by the VSCode and Cursor adapters.

use std::path::Path;

use rusqlite::OptionalExtension;

use crate::error::{Error, Result};

/// Open `state.vscdb` read-only and return the value of a single `ItemTable`
/// row, or `None` if the key is absent.
///
/// `immutable=1` tells SQLite the file won't change on disk so it can skip the
/// WAL and locking — safe to read while the editor is running.
pub(crate) fn read_state_db_value(db_path: &Path, key: &str) -> Result<Option<String>> {
    let uri = format!("file:{}?mode=ro&immutable=1", db_path.to_string_lossy());
    let conn = rusqlite::Connection::open_with_flags(
        &uri,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_URI,
    )
    .map_err(|source| Error::Sqlite {
        path: db_path.to_path_buf(),
        source,
    })?;

    conn.query_row("SELECT value FROM ItemTable WHERE key = ?1", [key], |r| {
        r.get::<_, String>(0)
    })
    .optional()
    .map_err(|source| Error::Sqlite {
        path: db_path.to_path_buf(),
        source,
    })
}
