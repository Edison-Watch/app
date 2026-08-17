//! The hook pending-file consumer (phase 2b — the `hookHealthMonitor`
//! equivalent). Drains `~/.sealgate/pending/` and `errors/` so the hook
//! scripts' output doesn't accumulate, and sweeps stale/orphaned files.
//!
//! Purely local file lifecycle: session-end files are logged then removed,
//! registration files are discarded, error files are logged then removed. No
//! network. Runs as a background task under the supervisor.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use notify::RecursiveMode;
use notify_debouncer_full::{DebounceEventResult, new_debouncer};
use tokio::sync::mpsc;

/// How often to re-drain + sweep as a safety net (fs events do the prompt work).
const SWEEP_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);
/// Pending files older than this are swept (matches the app's 7 days).
const PENDING_MAX_AGE: Duration = Duration::from_secs(7 * 24 * 60 * 60);

/// Run the consumer for `sealgate_dir` (`~/.sealgate`) until the task is
/// dropped.
pub async fn run(sealgate_dir: PathBuf) {
    let pending = sealgate_dir.join("pending");
    let errors = sealgate_dir.join("errors");
    let _ = std::fs::create_dir_all(&pending);
    let _ = std::fs::create_dir_all(&errors);

    // Drain any backlog left while we weren't running.
    drain_pending(&pending);
    drain_errors(&errors);

    let (tx, mut rx) = mpsc::unbounded_channel();
    let _debouncer = start_watcher(&sealgate_dir, tx);
    tracing::info!(dir = %sealgate_dir.display(), watching = _debouncer.is_some(), "hook consumer started");

    let mut sweep = tokio::time::interval(SWEEP_INTERVAL);
    sweep.tick().await; // the first tick fires immediately; skip it

    loop {
        tokio::select! {
            _ = rx.recv() => {
                while rx.try_recv().is_ok() {} // coalesce
                drain_pending(&pending);
                drain_errors(&errors);
            }
            _ = sweep.tick() => {
                drain_pending(&pending);
                drain_errors(&errors);
                sweep_stale(&pending);
                sweep_orphaned(&sealgate_dir);
            }
        }
    }
}

type Debouncer = notify_debouncer_full::Debouncer<
    notify::RecommendedWatcher,
    notify_debouncer_full::RecommendedCache,
>;

fn start_watcher(dir: &Path, tx: mpsc::UnboundedSender<()>) -> Option<Debouncer> {
    let mut debouncer = new_debouncer(
        Duration::from_millis(300),
        None,
        move |res: DebounceEventResult| {
            if res.is_ok() {
                let _ = tx.send(());
            }
        },
    )
    .ok()?;
    debouncer.watch(dir, RecursiveMode::Recursive).ok()?;
    Some(debouncer)
}

/// Consume every ready pending file: log session-ends, discard the rest.
fn drain_pending(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        // `.tmp` in-flight writes are dot-prefixed; never touch them.
        if !name.ends_with(".json") || name.starts_with('.') {
            continue;
        }
        let path = entry.path();
        if name.ends_with("-session-end.json") {
            log_session_end(&path);
        }
        let _ = std::fs::remove_file(&path);
    }
}

fn log_session_end(path: &Path) {
    if let Ok(text) = std::fs::read_to_string(path)
        && let Ok(v) = serde_json::from_str::<serde_json::Value>(&text)
        && v.get("event").and_then(|x| x.as_str()) == Some("session_end")
    {
        let conv = v
            .get("conversation_id")
            .and_then(|x| x.as_str())
            .unwrap_or("?");
        let reason = v
            .get("reason")
            .and_then(|x| x.as_str())
            .unwrap_or("unknown");
        tracing::info!(conversation_id = conv, reason, "session ended");
    }
}

fn drain_errors(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !name.ends_with(".json") || name.starts_with('.') {
            continue;
        }
        let path = entry.path();
        if let Ok(text) = std::fs::read_to_string(&path) {
            tracing::warn!(file = %name, detail = %text.trim(), "hook reported an error");
        }
        let _ = std::fs::remove_file(&path);
    }
}

/// Delete pending files older than [`PENDING_MAX_AGE`] (by mtime).
fn sweep_stale(dir: &Path) {
    let now = SystemTime::now();
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if let Ok(meta) = entry.metadata()
            && let Ok(mtime) = meta.modified()
            && now.duration_since(mtime).unwrap_or_default() > PENDING_MAX_AGE
        {
            let _ = std::fs::remove_file(&path);
        }
    }
}

/// Delete `active_session_<pid>.json` files whose process is gone.
fn sweep_orphaned(sealgate_dir: &Path) {
    let Ok(entries) = std::fs::read_dir(sealgate_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if let Some(pid) = name
            .strip_prefix("active_session_")
            .and_then(|s| s.strip_suffix(".json"))
            .and_then(|s| s.parse::<i32>().ok())
            && !process_alive(pid)
        {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

/// `kill(pid, 0)`: 0 → alive; `EPERM` → alive (exists, no permission); `ESRCH`
/// → gone.
#[cfg(unix)]
fn process_alive(pid: i32) -> bool {
    // SAFETY: kill with signal 0 performs only an existence/permission check.
    if unsafe { libc::kill(pid, 0) } == 0 {
        return true;
    }
    std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

/// Non-Unix has no `kill(pid, 0)` probe; a real liveness check lands with the
/// Windows hook-consumer work. Conservatively assume alive so we never delete a
/// live process's pending/error entry.
#[cfg(not(unix))]
fn process_alive(_pid: i32) -> bool {
    true
}
