//! The driver: subscribes to every client's watch paths via a debounced
//! filesystem watcher and emits [`ChangeEvent`]s as snapshots diverge.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use notify::RecursiveMode;
use notify_debouncer_full::{DebounceEventResult, new_debouncer};

use crate::agent::Agent;
use crate::diff::Snapshot;
use crate::error::{Error, Result};
use crate::types::ChangeEvent;

/// How often the event loop wakes up to check the stop flag.
const STOP_CHECK_INTERVAL: Duration = Duration::from_millis(250);

/// How often to re-check whether a deferred directory became watchable, i.e.
/// was created. Lets a client installed after startup take effect without
/// restarting the process.
const DEFERRED_RETRY_INTERVAL: Duration = Duration::from_secs(5);

/// How often to re-parse every client while any directory is deferred.
///
/// A deferred directory produces no fs events at all, so this poll is the ONLY
/// thing that sees changes under it. Runs only while something is deferred:
/// with a complete watch set the event stream is authoritative and polling
/// would be pure overhead.
const DEFERRED_RESCAN_INTERVAL: Duration = Duration::from_secs(5);

/// Driver that observes a fixed set of [`Agent`]s and emits [`ChangeEvent`]s
/// as their configs change.
///
/// A `Watcher` is constructed with [`Watcher::new`] and consumed by either
/// [`Watcher::run`] (blocking, callback-based) or [`Watcher::spawn`]
/// (background thread, channel-based).
///
/// Both methods take an initial snapshot silently - only changes after that
/// point produce events.
pub struct Watcher {
    clients: Vec<Arc<dyn Agent>>,
}

impl Watcher {
    /// Create a watcher over the given clients. The list is fixed for the
    /// lifetime of the watcher; clients added later will not be observed.
    pub fn new(clients: Vec<Arc<dyn Agent>>) -> Self {
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
    /// stop the worker - hold on to the handle for that.
    pub fn spawn(self) -> Result<(mpsc::Receiver<ChangeEvent>, WatcherHandle)> {
        let (ev_tx, ev_rx) = mpsc::channel::<ChangeEvent>();
        let stop = Arc::new(AtomicBool::new(false));
        let stop_c = stop.clone();

        let thread = thread::Builder::new()
            .name("sealgate_detectord".into())
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

    fn run_inner(self, stop: Arc<AtomicBool>, on_event: &mut dyn FnMut(ChangeEvent)) -> Result<()> {
        // A config file is normally watched through its parent directory
        // (atomic-rename writes replace the file), except for one that lives
        // directly in $HOME - see `tcc::watch_path_for_file`.
        let mut dirs: HashSet<PathBuf> = HashSet::new();
        for c in &self.clients {
            for p in c.watch_targets().files {
                if let Some(target) = crate::tcc::watch_path_for_file(&p) {
                    dirs.insert(target);
                }
            }
        }

        let mut snapshots: Vec<Snapshot> = Vec::with_capacity(self.clients.len());
        for c in &self.clients {
            let mut snap = Snapshot::new();
            match c.discover() {
                Ok(servers) => {
                    tracing::info!(client = c.name(), count = servers.len(), "initial snapshot");
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

        // Every directory we are NOT watching, for whatever reason. Two causes,
        // deliberately handled together because they have the same consequence -
        // no fs events from that directory, so its changes are invisible until
        // something polls:
        //
        //   * it does not exist yet (a client's config directory is often
        //     created later, and `notify` cannot watch a missing path), or
        //   * it is a TCC-protected folder, which we never watch (see
        //     crate::tcc) - permanent, so it is retried but never promoted.
        //
        // Retried, and polled, for as long as any remain.
        let mut deferred: Vec<PathBuf> = Vec::new();
        for dir in &dirs {
            match defer_reason(dir) {
                Some(reason) => {
                    reason.log(dir);
                    deferred.push(dir.clone());
                }
                None => {
                    debouncer.watch(dir, RecursiveMode::NonRecursive)?;
                    tracing::info!(dir = %dir.display(), "watching");
                }
            }
        }

        // Re-parse every client and emit whatever the snapshots say changed.
        // Shared by the fs-event path and the deferred-dir rescan below, so a
        // change found by polling produces exactly the same events as one found
        // by an fs notification.
        let reparse_all = |clients: &[Arc<dyn Agent>],
                           snapshots: &mut Vec<Snapshot>,
                           on_event: &mut dyn FnMut(ChangeEvent)| {
            for (c, snap) in clients.iter().zip(snapshots.iter_mut()) {
                match c.discover() {
                    Ok(current) => {
                        tracing::debug!(client = c.name(), count = current.len(), "reparse");
                        for ev in snap.update(&current) {
                            on_event(ev);
                        }
                    }
                    Err(e) => tracing::warn!(client = c.name(), error = %e, "reparse failed"),
                }
            }
        };

        // Directories whose watch attempt has already been reported, so a
        // durable failure is warned about once rather than on every retry.
        // Cleared on success, so a later failure of the same directory is heard.
        let mut watch_failures: HashSet<PathBuf> = HashSet::new();
        let mut last_retry = Instant::now();
        let mut last_rescan = Instant::now();
        loop {
            if stop.load(Ordering::Relaxed) {
                tracing::debug!("stop requested; exiting event loop");
                break;
            }

            // Promote whatever became watchable, i.e. the directory got
            // created. Cheap (an exists() and at most one
            // open()) but pointless on every 250ms stop-check tick, so it is
            // paced. Only ever ADDS watches - a grant revoked later leaves the
            // existing ones alone, which is harmless since that prompt has
            // already been answered.
            if !deferred.is_empty() && last_retry.elapsed() >= DEFERRED_RETRY_INTERVAL {
                last_retry = Instant::now();
                let before = deferred.len();
                deferred.retain(|dir| {
                    if defer_reason(dir).is_some() {
                        return true;
                    }
                    match debouncer.watch(dir, RecursiveMode::NonRecursive) {
                        Ok(()) => {
                            tracing::info!(dir = %dir.display(), "watching (now available)");
                            clear_watch_failure(&mut watch_failures, dir);
                            false
                        }
                        Err(e) => {
                            // Warn ONCE per directory. A watch that fails for a
                            // durable reason - an exhausted inotify limit, a
                            // directory we cannot read - fails again on every
                            // retry, and this runs every DEFERRED_RETRY_INTERVAL
                            // for the life of the process. Warning each time
                            // turns one problem into an unbounded log stream.
                            //
                            // The retry itself stays: these causes are often
                            // transient, and the rescan below keeps covering the
                            // directory meanwhile, so dropping it would silently
                            // narrow what we watch.
                            if should_warn_watch_failure(&mut watch_failures, dir) {
                                tracing::warn!(
                                    dir = %dir.display(),
                                    error = %e,
                                    "deferred watch failed; retrying quietly from here"
                                );
                            } else {
                                tracing::debug!(
                                    dir = %dir.display(),
                                    error = %e,
                                    "deferred watch still failing"
                                );
                            }
                            true
                        }
                    }
                });
                // Anything that changed while that directory was unwatched
                // produced no event and never will - a fresh watch only reports
                // what happens from now on. Close the gap immediately, and do it
                // BEFORE the rescan below can be switched off by `deferred`
                // having just become empty.
                if deferred.len() != before {
                    reparse_all(&self.clients, &mut snapshots, on_event);
                    last_rescan = Instant::now();
                }
            }
            // A deferred directory has NO event source, so without this its
            // changes would surface only when some unrelated watched directory
            // happened to fire (which re-parses every client). Polling while
            // anything is deferred is what makes the deferral safe, and what
            // the "picked up by the periodic rescan" warning above promises.
            if !deferred.is_empty() && last_rescan.elapsed() >= DEFERRED_RESCAN_INTERVAL {
                last_rescan = Instant::now();
                tracing::debug!(
                    deferred = deferred.len(),
                    "rescanning: some directories are unwatched"
                );
                reparse_all(&self.clients, &mut snapshots, on_event);
            }

            match rx.recv_timeout(STOP_CHECK_INTERVAL) {
                Ok(Ok(events)) => {
                    tracing::debug!(batch_size = events.len(), "debounced batch");
                    for e in &events {
                        tracing::debug!(paths = ?e.paths, kind = ?e.kind, "  event");
                    }
                    reparse_all(&self.clients, &mut snapshots, on_event);
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

/// Why a directory is not being watched right now. `None` from
/// [`defer_reason`] means it is watchable.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DeferReason {
    /// The directory does not exist yet; `notify` cannot watch a missing path.
    Missing,
    /// Watching it would raise a macOS TCC prompt (see [`crate::tcc`]).
    /// Permanent, not pending: we never watch these, rather than waiting on a
    /// Full Disk Access grant to unlock them.
    TccProtected,
}

impl DeferReason {
    fn log(self, dir: &Path) {
        match self {
            // Routine - a client that isn't installed has no config directory.
            Self::Missing => tracing::debug!(
                dir = %dir.display(),
                "deferring watch: directory does not exist yet"
            ),
            // Not a problem to fix, so not a warning: we hold no target under
            // these folders, and watching one would prompt the user for access
            // we do not need. The periodic rescan still covers it.
            Self::TccProtected => tracing::debug!(
                dir = %dir.display(),
                "not watching: TCC-protected folder (Desktop/Documents/Downloads); \
                 changes here are found by the periodic rescan instead"
            ),
        }
    }
}

/// Whether a failed watch attempt on `dir` deserves a warn-level line.
///
/// True the first time, false for every repeat, until the directory is watched
/// successfully and [`clear_watch_failure`] resets it. A watch that fails for a
/// durable reason fails again on every retry, and the retry loop runs for the
/// life of the process - so an unconditional warn turns one problem into an
/// unbounded log stream. Repeats are still logged, at debug.
fn should_warn_watch_failure(seen: &mut HashSet<PathBuf>, dir: &Path) -> bool {
    seen.insert(dir.to_path_buf())
}

/// Forget `dir`'s failure history, so a later failure is heard about again.
fn clear_watch_failure(seen: &mut HashSet<PathBuf>, dir: &Path) {
    seen.remove(dir);
}

/// Whether `dir` can be watched right now, and if not, why.
fn defer_reason(dir: &Path) -> Option<DeferReason> {
    if !dir.exists() {
        return Some(DeferReason::Missing);
    }
    if crate::tcc::is_tcc_protected(dir) {
        return Some(DeferReason::TccProtected);
    }
    None
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

#[cfg(test)]
mod tests {
    use super::*;

    /// A directory that cannot be watched is retried for the life of the
    /// process, so the failure must be reported once and then go quiet -
    /// otherwise one unwatchable directory (an exhausted inotify limit, a
    /// directory we cannot read) emits a warn line every retry interval,
    /// forever.
    #[test]
    fn a_durable_watch_failure_is_warned_about_once() {
        let mut seen = HashSet::new();
        let dir = Path::new("/tmp/sealgate-unwatchable");

        assert!(
            should_warn_watch_failure(&mut seen, dir),
            "the first failure is worth a warning"
        );
        assert!(
            !should_warn_watch_failure(&mut seen, dir),
            "a repeat of the same failure must not warn again"
        );
        assert!(!should_warn_watch_failure(&mut seen, dir));
    }

    /// Recovering resets the history: a directory that starts failing again
    /// later is a new problem and has to be audible.
    #[test]
    fn a_recovered_directory_can_warn_again() {
        let mut seen = HashSet::new();
        let dir = Path::new("/tmp/sealgate-flaky");

        assert!(should_warn_watch_failure(&mut seen, dir));
        clear_watch_failure(&mut seen, dir);
        assert!(
            should_warn_watch_failure(&mut seen, dir),
            "after a successful watch, a fresh failure must warn again"
        );
    }

    /// Each directory is tracked separately - one noisy directory must not
    /// silence the first failure of another.
    #[test]
    fn failures_are_tracked_per_directory() {
        let mut seen = HashSet::new();
        assert!(should_warn_watch_failure(&mut seen, Path::new("/tmp/a")));
        assert!(should_warn_watch_failure(&mut seen, Path::new("/tmp/b")));
        assert!(!should_warn_watch_failure(&mut seen, Path::new("/tmp/a")));
    }
}
