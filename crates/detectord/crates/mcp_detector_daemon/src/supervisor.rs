//! The daemon supervisor: runs the IPC server and a reconcile worker per
//! enrolled OS user, together, and keeps `state.json` fresh. This is the actual
//! long-running daemon mode; `run`/`serve` are focused dev tools.
//!
//! (The root build's launchd plist points at this via the `daemon` subcommand.)

use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;

use tokio::sync::broadcast;
use tokio::task::JoinHandle;

use crate::enrollment::Enrollments;
use crate::runner::EventTx;
use crate::{ipc, runner, status};

const EVENT_CAPACITY: usize = 256;
const STATE_REFRESH: Duration = Duration::from_secs(15);
/// How often to reconcile the running workers against the enrolled users, so a
/// user who enrolls at runtime (via the socket) gets a worker without a restart.
const WORKER_REFRESH: Duration = Duration::from_secs(5);

/// Start the IPC server + a worker per enrolled user; run until terminated.
pub async fn run(enforce: bool, socket: PathBuf, hook_consumer: bool) -> anyhow::Result<()> {
    let (events, _keep) = broadcast::channel(EVENT_CAPACITY);

    // IPC server.
    let ipc_events = events.clone();
    let ipc_socket = socket.clone();
    let mut ipc_task = tokio::spawn(async move { ipc::serve(&ipc_socket, ipc_events).await });

    // A reconcile worker per enrolled user, kept in sync with the enrollment set.
    let mut workers: HashMap<String, JoinHandle<_>> = HashMap::new();
    spawn_missing_workers(&mut workers, enforce, &events);

    // Drain the hook scripts' pending/errors output (phase 2b). Skipped in
    // detect-only mode so we don't fight the client's own hook monitor over
    // ~/.edison-watch/pending.
    if hook_consumer && let Some(dir) = crate::paths::edison_watch_dir() {
        tokio::spawn(crate::hook_consumer::run(dir));
    }

    tracing::info!(
        enforce,
        users = workers.len(),
        socket = %socket.display(),
        "supervisor started"
    );

    let _ = status::write(&socket, &worker_names(&workers));
    let mut state_timer = tokio::time::interval(STATE_REFRESH);
    let mut worker_timer = tokio::time::interval(WORKER_REFRESH);

    loop {
        tokio::select! {
            _ = state_timer.tick() => {
                let _ = status::write(&socket, &worker_names(&workers));
            }
            _ = worker_timer.tick() => {
                spawn_missing_workers(&mut workers, enforce, &events);
            }
            _ = tokio::signal::ctrl_c() => {
                tracing::info!("shutting down");
                break;
            }
            r = &mut ipc_task => {
                tracing::warn!("ipc server exited: {r:?}");
                break;
            }
        }
    }

    for (_, w) in workers {
        w.abort();
    }
    ipc_task.abort();
    Ok(())
}

/// Spawn a worker for each enrolled user that doesn't have one yet (so runtime
/// enrollments are picked up without a daemon restart).
fn spawn_missing_workers(
    workers: &mut HashMap<String, JoinHandle<anyhow::Result<()>>>,
    enforce: bool,
    events: &EventTx,
) {
    let Ok(enrollments) = Enrollments::load() else {
        return;
    };
    for (user, _) in enrollments.iter() {
        if !workers.contains_key(user) {
            tracing::info!(%user, "spawning reconcile worker");
            let handle = tokio::spawn(runner::worker(user.clone(), enforce, Some(events.clone())));
            workers.insert(user.clone(), handle);
        }
    }
}

fn worker_names(workers: &HashMap<String, JoinHandle<anyhow::Result<()>>>) -> Vec<String> {
    workers.keys().cloned().collect()
}
