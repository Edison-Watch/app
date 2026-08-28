//! Atomically-written `state.json` describing the daemon's live status.
//!
//! Consumers:
//!
//! - `sealgate-stdiod status` - single-shot read, formats for humans.
//! - Desktop app tray icon ([client_2/src/main/index.ts]) - polls the file
//!   periodically when the user opens the menu.
//!
//! The daemon rewrites this file on every connection-state transition and
//! every child spawn / death, never on the hot path (per-frame). Writes
//! are atomic (`write tmp → rename`) so a reader never observes a torn or
//! truncated file.
//!
//! The format is intentionally small and stable - readers parse it with
//! whatever JSON lib they have lying around. Schema is described inline
//! in [`State`] below.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use tracing::debug;

use crate::paths;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionState {
    /// Initial state, before the first connection attempt.
    Starting,
    /// WS upgrade succeeded; backend `server_hello` received.
    Connected,
    /// Disconnected and in the reconnect-backoff loop.
    Reconnecting,
    /// Backend rejected our credentials - daemon stops retrying until the
    /// user runs `sealgate-stdiod login` again. v1 surfaces this; the
    /// automatic flip-back is v1.1's `creds_invalidated` flow.
    NeedsReauth,
    /// Backend rejected our protocol version. The user must upgrade the
    /// daemon binary. Also stops retrying.
    NeedsUpgrade,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ServerStatus {
    /// Reserved. No value the daemon can observe distinguishes "starting"
    /// from "running": a stdio MCP server stays silent until the backend
    /// opens a session against it, so a first-frame rule would leave healthy
    /// idle children here forever. Readers MUST still accept the value; a
    /// client class with a real activation step (the in-process mobile
    /// client) may produce it. See PROTOCOL.md T-69.
    Starting,
    /// Subprocess was spawned and no pump has reported it dead.
    Running,
    /// Subprocess exited. A pump observed the death and reported
    /// `server_offline`; the supervisor respawns on the next desired-state
    /// change that names it.
    Crashed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerEntry {
    pub name: String,
    pub state: ServerStatus,
    pub pid: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct State {
    pub connection_state: ConnectionState,
    pub backend_url: Option<String>,
    pub device_id: Option<String>,
    pub device_label: Option<String>,
    pub last_connected_at: Option<DateTime<Utc>>,
    pub last_error: Option<String>,
    #[serde(default)]
    pub servers: Vec<ServerEntry>,
    /// Bumped on every write so readers polling the file can cheaply
    /// detect "nothing changed since I last looked."
    pub generation: u64,
}

impl Default for State {
    fn default() -> Self {
        Self {
            connection_state: ConnectionState::Starting,
            backend_url: None,
            device_id: None,
            device_label: None,
            last_connected_at: None,
            last_error: None,
            servers: Vec::new(),
            generation: 0,
        }
    }
}

impl State {
    fn write_atomic(&self, path: &Path) -> Result<()> {
        let body = serde_json::to_string_pretty(self).context("serialising state.json")?;
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, body).with_context(|| format!("writing {}", tmp.display()))?;
        std::fs::rename(&tmp, path).with_context(|| format!("renaming -> {}", path.display()))?;
        Ok(())
    }

    pub fn load_from(path: &Path) -> Result<Self> {
        let body =
            std::fs::read_to_string(path).with_context(|| format!("reading {}", path.display()))?;
        serde_json::from_str(&body).with_context(|| format!("parsing {}", path.display()))
    }

    pub fn load() -> Result<Self> {
        Self::load_from(&paths::state_file()?)
    }
}

/// Process-wide writer that the daemon mutates from various tasks (the
/// WS lifecycle loop, the supervisor, every child's pumps) and that fans
/// out to the on-disk `state.json`. All mutations go through
/// [`StateWriter::update`], which holds a mutex across the whole
/// read-mutate-write so two transitions can never produce an interleaved
/// or out-of-order file write.
#[derive(Clone)]
pub struct StateWriter {
    inner: Arc<Mutex<State>>,
    /// Where to write. `None` resolves [`paths::state_file`] at write time,
    /// which is what the daemon does; tests set an explicit path so they can
    /// assert on the bytes that reach disk.
    path: Option<PathBuf>,
}

impl StateWriter {
    pub fn new(initial: State) -> Self {
        Self {
            inner: Arc::new(Mutex::new(initial)),
            path: None,
        }
    }

    /// A writer pinned to `path` instead of the per-user config dir.
    #[cfg(test)]
    pub fn new_at(initial: State, path: PathBuf) -> Self {
        Self {
            inner: Arc::new(Mutex::new(initial)),
            path: Some(path),
        }
    }

    /// Apply a mutation under the lock, bump the generation, and write
    /// the file. Failures are logged but don't propagate - `state.json`
    /// is best-effort; the WS reconnect loop must not stall on a full
    /// disk.
    ///
    /// The file write happens while the lock is still held, so the
    /// generation on disk only ever moves forward. Releasing the lock
    /// first and writing after would let two callers rename in the
    /// opposite order to the one they mutated in, leaving an older
    /// snapshot on disk until whatever writes next - a real risk now that
    /// child pumps publish deaths concurrently with the supervisor. The
    /// write is blocking under an async mutex, which is fine here: the
    /// file is a few hundred bytes and is written on state transitions
    /// only, never per forwarded frame.
    pub async fn update<F: FnOnce(&mut State)>(&self, f: F) {
        let mut guard = self.inner.lock().await;
        f(&mut guard);
        guard.generation = guard.generation.saturating_add(1);
        let path = match self.path.clone().map(Ok).unwrap_or_else(paths::state_file) {
            Ok(p) => p,
            Err(e) => {
                debug!(error = %e, "state.json: cannot resolve path; skipping write");
                return;
            }
        };
        if let Err(e) = guard.write_atomic(&path) {
            debug!(error = %e, "state.json: write failed; skipping");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_roundtrips_through_json() {
        let s = State {
            connection_state: ConnectionState::Connected,
            backend_url: Some("https://demo-dashboard.sealgate.ai".into()),
            device_id: Some("laptop".into()),
            device_label: Some("Laptop".into()),
            last_connected_at: Some(Utc::now()),
            last_error: None,
            servers: vec![ServerEntry {
                name: "filesystem".into(),
                state: ServerStatus::Running,
                pid: Some(12345),
            }],
            generation: 7,
        };
        let json = serde_json::to_string(&s).unwrap();
        let parsed: State = serde_json::from_str(&json).unwrap();
        assert!(matches!(
            parsed.connection_state,
            ConnectionState::Connected
        ));
        assert_eq!(parsed.servers.len(), 1);
        assert_eq!(parsed.servers[0].pid, Some(12345));
    }

    #[test]
    fn server_statuses_keep_their_wire_spelling() {
        // The desktop tray parses these strings (`ServerRunState` in
        // packages/desktop/src/main/stdiod/types.ts), so the spelling is part
        // of the contract even for the variant the daemon never writes.
        for (status, expected) in [
            (ServerStatus::Starting, "\"starting\""),
            (ServerStatus::Running, "\"running\""),
            (ServerStatus::Crashed, "\"crashed\""),
        ] {
            assert_eq!(serde_json::to_string(&status).unwrap(), expected);
        }
    }

    /// Updates raced from several tasks must leave the newest snapshot on
    /// disk. Each task appends one entry, so the last file written is only
    /// correct if the generation the writer bumped and the bytes it renamed
    /// into place moved together: an older snapshot landing last would show
    /// both a lower generation and fewer servers.
    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn concurrent_updates_leave_the_newest_snapshot_on_disk() {
        const UPDATES: usize = 32;

        let dir = std::env::temp_dir().join(format!("edison-stdiod-state-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("concurrent-state.json");
        let _ = std::fs::remove_file(&path);
        let writer = StateWriter::new_at(State::default(), path.clone());

        let tasks: Vec<_> = (0..UPDATES)
            .map(|i| {
                let writer = writer.clone();
                tokio::spawn(async move {
                    writer
                        .update(move |s| {
                            s.servers.push(ServerEntry {
                                name: format!("server-{i}"),
                                state: ServerStatus::Running,
                                pid: Some(i as u32),
                            });
                        })
                        .await;
                })
            })
            .collect();
        for task in tasks {
            task.await.unwrap();
        }

        let on_disk = State::load_from(&path).unwrap();
        assert_eq!(
            on_disk.generation, UPDATES as u64,
            "the highest generation must be the one left on disk"
        );
        assert_eq!(on_disk.servers.len(), UPDATES);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn missing_servers_field_defaults_to_empty() {
        let json = r#"{
            "connection_state": "starting",
            "backend_url": null,
            "device_id": null,
            "device_label": null,
            "last_connected_at": null,
            "last_error": null,
            "generation": 0
        }"#;
        let parsed: State = serde_json::from_str(json).unwrap();
        assert!(parsed.servers.is_empty());
    }
}
