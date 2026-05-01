//! Top-level state machine. Boots the IPC server immediately so clients can
//! connect and observe the `awaiting_fda` state, then transitions into
//! `running` once Full Disk Access is granted. Re-enters `awaiting_fda` if a
//! watcher error suggests FDA was revoked.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use mcp_detector_lib::{ChangeEvent, Client as McpClient};
use tokio::sync::{Mutex, RwLock, broadcast, mpsc};
use tokio::task::JoinHandle;

use crate::ipc;
use crate::permission;
use crate::protocol::{ChangeKind, DaemonState, Message, StatusReply, WatcherEvent};

const FDA_POLL_INTERVAL: Duration = Duration::from_secs(3);
const EVENT_BROADCAST_CAPACITY: usize = 256;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
}

pub struct Config {
    pub socket_path: PathBuf,
    pub probe_path: PathBuf,
}

#[derive(Clone)]
pub struct SharedState {
    pub state: Arc<RwLock<DaemonState>>,
    pub clients_watched: Arc<RwLock<Vec<String>>>,
    pub events: broadcast::Sender<Message>,
    pub recheck_tx: mpsc::Sender<()>,
    pub socket_path: PathBuf,
}

impl SharedState {
    pub async fn snapshot_status(&self) -> StatusReply {
        StatusReply {
            state: *self.state.read().await,
            clients_watched: self.clients_watched.read().await.clone(),
            socket_path: self.socket_path.to_string_lossy().into_owned(),
            version: env!("CARGO_PKG_VERSION").to_string(),
        }
    }
}

pub async fn run(cfg: Config) -> Result<(), Error> {
    let (recheck_tx, recheck_rx) = mpsc::channel::<()>(8);
    let (event_tx, _event_rx) = broadcast::channel::<Message>(EVENT_BROADCAST_CAPACITY);

    let shared = SharedState {
        state: Arc::new(RwLock::new(DaemonState::Starting)),
        clients_watched: Arc::new(RwLock::new(Vec::new())),
        events: event_tx,
        recheck_tx,
        socket_path: cfg.socket_path.clone(),
    };

    let ipc_handle = ipc::serve(cfg.socket_path.clone(), shared.clone()).await?;

    let supervisor_state = shared.clone();
    let supervisor_handle = tokio::spawn(supervise(supervisor_state, cfg.probe_path, recheck_rx));

    tokio::select! {
        _ = wait_for_termination() => {
            tracing::info!("termination signal received, shutting down");
        }
        res = ipc_handle => {
            tracing::warn!("ipc server exited unexpectedly: {res:?}");
        }
        res = supervisor_handle => {
            tracing::warn!("supervisor task exited unexpectedly: {res:?}");
        }
    }
    Ok(())
}

async fn wait_for_termination() {
    use tokio::signal::unix::{SignalKind, signal};
    let Ok(mut term) = signal(SignalKind::terminate()) else {
        std::future::pending::<()>().await;
        return;
    };
    let Ok(mut int) = signal(SignalKind::interrupt()) else {
        std::future::pending::<()>().await;
        return;
    };
    tokio::select! {
        _ = term.recv() => {}
        _ = int.recv() => {}
    }
}

async fn supervise(
    shared: SharedState,
    probe_path: PathBuf,
    mut recheck_rx: mpsc::Receiver<()>,
) {
    {
        *shared.state.write().await = DaemonState::AwaitingFda;
    }

    let watcher_slot: Arc<Mutex<Option<JoinHandle<()>>>> = Arc::new(Mutex::new(None));

    loop {
        if matches!(*shared.state.read().await, DaemonState::Running) {
            tokio::select! {
                _ = tokio::time::sleep(FDA_POLL_INTERVAL) => {}
                Some(_) = recheck_rx.recv() => {}
            }
            // Periodically re-probe so we can drop into AwaitingFda if the
            // user revokes access. Watcher errors will also flip us back.
            if !permission::check(&probe_path) {
                tracing::warn!("FDA appears revoked; stopping watcher");
                stop_watcher(&watcher_slot).await;
                {
                    *shared.state.write().await = DaemonState::AwaitingFda;
                    shared.clients_watched.write().await.clear();
                }
            }
            continue;
        }

        if permission::check(&probe_path) {
            tracing::info!("FDA granted; starting watcher");
            match start_watcher(&shared).await {
                Ok(handle) => {
                    *watcher_slot.lock().await = Some(handle);
                    *shared.state.write().await = DaemonState::Running;
                }
                Err(e) => {
                    tracing::error!("failed to start watcher: {e}");
                }
            }
        } else {
            tracing::debug!("FDA still missing");
        }

        tokio::select! {
            _ = tokio::time::sleep(FDA_POLL_INTERVAL) => {}
            Some(_) = recheck_rx.recv() => {
                tracing::info!("recheck requested by client");
            }
        }
    }
}

async fn stop_watcher(slot: &Arc<Mutex<Option<JoinHandle<()>>>>) {
    if let Some(handle) = slot.lock().await.take() {
        handle.abort();
    }
}

async fn start_watcher(shared: &SharedState) -> Result<JoinHandle<()>, std::io::Error> {
    let mut clients: Vec<Arc<dyn McpClient>> = Vec::new();
    let mut names: Vec<String> = Vec::new();

    match mcp_detector_lib::clients::ClaudeCode::discover() {
        Ok(c) => {
            names.push("claude_code".into());
            clients.push(Arc::new(c));
        }
        Err(e) => {
            tracing::warn!("claude_code discover failed: {e}");
        }
    }
    match mcp_detector_lib::clients::VsCode::discover() {
        Ok(c) => {
            names.push("vscode".into());
            clients.push(Arc::new(c));
        }
        Err(e) => {
            tracing::warn!("vscode discover failed: {e}");
        }
    }

    *shared.clients_watched.write().await = names;

    if clients.is_empty() {
        return Err(std::io::Error::other("no clients available to watch"));
    }

    let watcher = mcp_detector_lib::Watcher::new(clients);
    let (rx, handle) = match watcher.spawn() {
        Ok(pair) => pair,
        Err(e) => return Err(std::io::Error::other(e.to_string())),
    };

    let events_tx = shared.events.clone();
    let join = tokio::task::spawn_blocking(move || {
        // Hold the handle for the lifetime of this task so the worker thread
        // stays alive. When the JoinHandle is aborted, the receiver will be
        // dropped and the inner thread will be stopped via the handle drop.
        let _handle = handle;
        for ev in rx.iter() {
            let msg = Message::Event(map_event(&ev));
            // ignore send errors when no subscribers
            let _ = events_tx.send(msg);
        }
    });
    Ok(join)
}

fn map_event(ev: &ChangeEvent) -> WatcherEvent {
    let (change, server) = match ev {
        ChangeEvent::Added(s) => (ChangeKind::Added, s),
        ChangeEvent::Removed(s) => (ChangeKind::Removed, s),
    };
    WatcherEvent {
        change,
        server_name: server.name.clone(),
        client: server.client.to_string(),
        scope: format!("{:?}", server.scope),
        transport: server.transport.to_string(),
    }
}
