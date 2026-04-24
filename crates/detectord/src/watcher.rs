use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::mpsc;
use std::time::Duration;

use notify::RecursiveMode;
use notify_debouncer_full::{DebounceEventResult, new_debouncer};

use crate::client::Client;
use crate::diff::Snapshot;
use crate::error::Result;
use crate::types::ChangeEvent;

pub struct Watcher {
    clients: Vec<Arc<dyn Client>>,
}

impl Watcher {
    pub fn new(clients: Vec<Arc<dyn Client>>) -> Self {
        Self { clients }
    }

    /// Watch forever, invoking `on_event` for every detected change.
    ///
    /// Takes an initial snapshot silently, then re-parses each client's configs
    /// whenever the filesystem fires an event in any watched directory.
    pub fn run<F>(self, mut on_event: F) -> Result<()>
    where
        F: FnMut(ChangeEvent),
    {
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

        for res in rx {
            match res {
                Ok(events) => {
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
                Err(errors) => {
                    for e in errors {
                        tracing::warn!(error = %e, "watcher error");
                    }
                }
            }
        }

        Ok(())
    }
}
