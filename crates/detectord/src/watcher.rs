//! The driver: subscribes to every client's watch paths via a debounced
//! filesystem watcher and emits [`ChangeEvent`]s as snapshots diverge.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use notify::RecursiveMode;
use notify_debouncer_full::{DebounceEventResult, new_debouncer};

use crate::client::Client;
use crate::diff::Snapshot;
use crate::error::{Error, Result};
use crate::types::ChangeEvent;

/// How often the event loop wakes up to check the stop flag.
const STOP_CHECK_INTERVAL: Duration = Duration::from_millis(250);

/// Driver that observes a fixed set of [`Client`]s and emits [`ChangeEvent`]s
/// as their configs change.
///
/// A `Watcher` is constructed with [`Watcher::new`] and consumed by either
/// [`Watcher::run`] (blocking, callback-based) or [`Watcher::spawn`]
/// (background thread, channel-based).
///
/// Both methods take an initial snapshot silently — only changes after that
/// point produce events.
pub struct Watcher {
    clients: Vec<Arc<dyn Client>>,
}

impl Watcher {
    /// Create a watcher over the given clients. The list is fixed for the
    /// lifetime of the watcher; clients added later will not be observed.
    pub fn new(clients: Vec<Arc<dyn Client>>) -> Self {
        Self { clients }
    }

    /// Watch in the current thread, invoking `on_event` for every detected
    /// change. Blocks until the process is killed.
    ///
    /// Takes an initial snapshot silently, then re-parses each client's
    /// configs whenever the filesystem fires an event in any watched
    /// directory.
    pub fn run<F>(self, mut on_event: F) -> Result<()>
    where
        F: FnMut(ChangeEvent),
    {
        let stop = Arc::new(AtomicBool::new(false));
        self.run_inner(stop, &mut on_event)
    }

    /// Watch on a background thread and deliver events over a channel.
    ///
    /// The returned [`WatcherHandle`] will signal the worker to stop and join
    /// it either when `.stop()` is called explicitly or when the handle is
    /// dropped. Dropping the [`Receiver`](mpsc::Receiver) alone does **not**
    /// stop the worker — hold on to the handle for that.
    pub fn spawn(self) -> Result<(mpsc::Receiver<ChangeEvent>, WatcherHandle)> {
        let (ev_tx, ev_rx) = mpsc::channel::<ChangeEvent>();
        let stop = Arc::new(AtomicBool::new(false));
        let stop_c = stop.clone();

        let thread = thread::Builder::new()
            .name("mcp_detector".into())
            .spawn(move || {
                let mut on_event = move |e| {
                    let _ = ev_tx.send(e);
                };
                if let Err(e) = self.run_inner(stop_c, &mut on_event) {
                    tracing::error!(error = %e, "watcher thread failed");
                }
            })
            .map_err(Error::Thread)?;

        Ok((
            ev_rx,
            WatcherHandle {
                stop,
                thread: Some(thread),
            },
        ))
    }

    fn run_inner(
        self,
        stop: Arc<AtomicBool>,
        on_event: &mut dyn FnMut(ChangeEvent),
    ) -> Result<()> {
        let mut dirs: HashSet<PathBuf> = HashSet::new();
        for c in &self.clients {
            for p in c.watch_paths() {
                if let Some(parent) = p.parent() {
                    dirs.insert(parent.to_path_buf());
                }
            }
        }

        let mut snapshots: Vec<Snapshot> = Vec::with_capacity(self.clients.len());
        for c in &self.clients {
            let mut snap = Snapshot::new();
            match c.parse_all() {
                Ok(servers) => {
                    tracing::info!(
                        client = c.name(),
                        count = servers.len(),
                        "initial snapshot"
                    );
                    snap.prime(&servers);
                }
                Err(e) => tracing::warn!(client = c.name(), error = %e, "initial parse failed"),
            }
            snapshots.push(snap);
        }

        let (tx, rx) = mpsc::channel::<DebounceEventResult>();
        let mut debouncer = new_debouncer(Duration::from_millis(500), None, move |res| {
            let _ = tx.send(res);
        })?;

        for dir in &dirs {
            if !dir.exists() {
                tracing::debug!(dir = %dir.display(), "skipping non-existent watch dir");
                continue;
            }
            debouncer.watch(dir, RecursiveMode::NonRecursive)?;
            tracing::info!(dir = %dir.display(), "watching");
        }

        loop {
            if stop.load(Ordering::Relaxed) {
                tracing::debug!("stop requested; exiting event loop");
                break;
            }
            match rx.recv_timeout(STOP_CHECK_INTERVAL) {
                Ok(Ok(events)) => {
                    tracing::debug!(batch_size = events.len(), "debounced batch");
                    for e in &events {
                        tracing::debug!(paths = ?e.paths, kind = ?e.kind, "  event");
                    }
                    for (c, snap) in self.clients.iter().zip(snapshots.iter_mut()) {
                        match c.parse_all() {
                            Ok(current) => {
                                tracing::debug!(
                                    client = c.name(),
                                    count = current.len(),
                                    "reparse"
                                );
                                for ev in snap.update(&current) {
                                    on_event(ev);
                                }
                            }
                            Err(e) => {
                                tracing::warn!(client = c.name(), error = %e, "reparse failed")
                            }
                        }
                    }
                }
                Ok(Err(errors)) => {
                    for e in errors {
                        tracing::warn!(error = %e, "watcher error");
                    }
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => {
                    tracing::debug!("debouncer channel disconnected; exiting");
                    break;
                }
            }
        }

        Ok(())
    }
}

/// Handle to a watcher spawned by [`Watcher::spawn`]. Stops the worker and
/// joins it on `stop()` or when dropped.
pub struct WatcherHandle {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl WatcherHandle {
    /// Signal the worker to stop and wait for it to exit.
    pub fn stop(mut self) {
        self.stop_inner();
    }

    fn stop_inner(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

impl Drop for WatcherHandle {
    fn drop(&mut self) {
        self.stop_inner();
    }
}
