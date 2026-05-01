//! Wire protocol between the daemon and its clients (e.g. the Edison Watch
//! Electron supervisor). Newline-delimited JSON over a Unix domain socket.

use serde::{Deserialize, Serialize};

/// Client → daemon requests.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Request {
    /// Return the daemon's current state.
    Status,
    /// Force an immediate FDA recheck.
    RecheckFda,
}

/// Daemon → client messages. Either a direct reply to a [`Request`], or an
/// unsolicited push (e.g. a watcher event).
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Message {
    Status(StatusReply),
    Ack,
    Event(WatcherEvent),
    Error(ErrorReply),
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct StatusReply {
    pub state: DaemonState,
    pub clients_watched: Vec<String>,
    pub socket_path: String,
    pub version: String,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DaemonState {
    /// Boot, no FDA probe completed yet.
    Starting,
    /// FDA missing; daemon is polling for it.
    AwaitingFda,
    /// FDA granted; watcher running.
    Running,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct WatcherEvent {
    pub change: ChangeKind,
    pub server_name: String,
    pub client: String,
    pub scope: String,
    pub transport: String,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ChangeKind {
    Added,
    Removed,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ErrorReply {
    pub message: String,
}
