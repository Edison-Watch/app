//! The reconcile loop (user-mode dev build).
//!
//! Level-triggered: each pass discovers all servers, plans against the
//! seen-store + policy, and (when enforcing) quarantines. Periodically refreshes
//! policy + known-set from the backend, fail-closed (a failed fetch keeps the
//! last-known-good). Replaces the old FDA-gated watcher; the privileged version
//! adds fs-event triggering, per-user workers, and IPC on top of this shape.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use mcp_backend::{BackendClient, KnownStatus};
use mcp_quarantine::{
    Action as SeenAction, ConfigStore, FileConfigStore, Policy, QuarantineRecord, ReconcileAction,
    SeenStore, is_sealgate_entry, plan,
};
use notify::RecursiveMode;
use notify_debouncer_full::{DebounceEventResult, new_debouncer};
use sealgate_detectord::{Agent, DiscoveredServer, ServerConfig, fingerprint};
use tokio::sync::broadcast;

use crate::agents;
use crate::enrollment::Enrollment;
use crate::protocol::{Event, ServerView};
use crate::quarantined::{QuarantinedEntry, QuarantinedState};
use crate::{paths, platform};

/// Broadcast channel of `(os_user, event)` — workers publish, IPC connections
/// forward the events matching their peer user.
pub type EventTx = broadcast::Sender<(String, Event)>;

/// Periodic safety-net rescan — catches sources that mutate without firing fs
/// events (SQLite state DBs, extension-API installs).
const RESCAN_INTERVAL: Duration = Duration::from_secs(20);
/// How often to re-fetch policy + known-set (fail-closed).
const REFRESH_INTERVAL: Duration = Duration::from_secs(300);
/// Debounce window coalescing rapid fs events into one reconcile.
const DEBOUNCE: Duration = Duration::from_millis(500);

/// The concrete fs-watcher type `start_watcher` hands back.
type FsDebouncer = notify_debouncer_full::Debouncer<
    notify::RecommendedWatcher,
    notify_debouncer_full::RecommendedCache,
>;

/// Directories held back for want of Full Disk Access, paired with the mode
/// they should be watched in once it is granted.
type DeferredWatches = Vec<(PathBuf, RecursiveMode)>;

/// Run the reconcile loop for the current OS user until Ctrl-C. `enforce=false`
/// is a dry run.
pub async fn run(enforce: bool) -> anyhow::Result<()> {
    let user = paths::current_username();
    tokio::select! {
        r = worker(user, enforce, None) => r,
        _ = tokio::signal::ctrl_c() => {
            tracing::info!("stopping");
            Ok(())
        }
    }
}

/// Level-triggered reconcile worker for one OS user: reconcile on fs events
/// (debounced/coalesced) and on a periodic safety-net tick, refreshing policy
/// on its own cadence. Loops until the task is dropped/aborted. When `events` is
/// set, publishes what it quarantines. The supervisor spawns one per enrolled
/// user.
pub async fn worker(user: String, enforce: bool, events: Option<EventTx>) -> anyhow::Result<()> {
    paths::ensure_user_dir(&user)?;
    let mut enrollment = Enrollment::load_for(&user)?
        .ok_or_else(|| anyhow::anyhow!("not enrolled; run `enroll` first"))?;
    let client = BackendClient::new(enrollment.api_base_url.clone(), enrollment.api_key.clone());
    let mut seen = SeenStore::open(paths::seen_store_path(&user), enrollment.org_id.clone())?;
    refresh(&client, &mut enrollment, &mut seen, &user).await;

    let agents = agents::build();
    let store = FileConfigStore;
    let mut qstate = QuarantinedState::load_for(&user)?;

    // fs-event triggering. `tx` (held for the loop) keeps the channel open so
    // `rx.recv()` pends forever even if the watcher fails to start.
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<()>();
    let started = start_watcher(&agents, tx.clone());
    let watching = started.is_some();
    // Held for the lifetime of the loop: dropping the debouncer stops watching.
    let (mut _debouncer, mut deferred) = match started {
        Some((deb, deferred)) => (Some(deb), deferred),
        None => (None, Vec::new()),
    };
    let deferred_watches = deferred.len();
    // Directories already reported as unwatchable; keeps `retry_deferred` from
    // warning on every tick about a failure that is not going to change.
    let mut watch_failures: HashSet<PathBuf> = HashSet::new();

    tracing::info!(
        user = %user,
        org = %enrollment.org_id,
        quarantine = enrollment.quarantine,
        enforce,
        agents = agents.len(),
        watching,
        deferred_watches,
        "reconcile worker starting (Ctrl-C to stop)"
    );

    let mut last_refresh = Instant::now();
    let mut reported = HashSet::new();
    loop {
        // Re-read the enrollment from disk each pass so an onboarding-completion
        // re-enroll takes effect without restarting the worker: it arms
        // enforcement AND fills in selected_agents / mcp_base_url / secret (the
        // login enroll started empty). Until armed the daemon is detect-only —
        // lists/reports but quarantines nothing — so onboarding can review +
        // send-to-SG first. Policy (`quarantine`) is refreshed from the backend
        // separately and persisted, so reading it back from disk keeps
        // last-known-good.
        if let Ok(Some(fresh)) = Enrollment::load_for(&user) {
            if fresh.armed != enrollment.armed {
                tracing::info!(armed = fresh.armed, "enforcement armed state changed");
            }
            if fresh.selected_agents != enrollment.selected_agents {
                tracing::info!(agents = ?fresh.selected_agents, "selected agents changed");
            }
            enrollment = fresh;
        }
        reconcile_once(
            &agents,
            &mut seen,
            enrollment.quarantine,
            &store,
            &mut qstate,
            enforce && enrollment.armed,
            &user,
            events.as_ref(),
            &mut reported,
        );
        // Self-heal: if a config was overwritten and dropped our sealgate
        // entry, put it back. Only while enforcing + armed (i.e. we own the
        // install); a no-op when the entry is already present, so no fs loop.
        if enforce && enrollment.armed {
            let healed = crate::ops::heal_sealgate_install(&user, &enrollment);
            if healed > 0 {
                tracing::info!(count = healed, "self-healed sealgate install");
            }
        }
        if last_refresh.elapsed() >= REFRESH_INTERVAL {
            refresh(&client, &mut enrollment, &mut seen, &user).await;
            last_refresh = Instant::now();
        }
        // Cheap (one open() of a file that is either readable or not), and this
        // tick is at most every RESCAN_INTERVAL, so no need to pace it further.
        if let Some(deb) = _debouncer.as_mut() {
            retry_deferred(deb, &mut deferred, &mut watch_failures);
        }
        // Stops when the task is dropped (Ctrl-C in `run`, or the supervisor
        // aborting the worker).
        tokio::select! {
            _ = rx.recv() => {
                while rx.try_recv().is_ok() {} // coalesce queued triggers
                tracing::debug!("fs change; reconciling");
            }
            _ = tokio::time::sleep(RESCAN_INTERVAL) => {}
        }
    }
}

/// Watch every agent's targets and signal `tx` (debounced) on any change.
/// Returns the debouncer, which must be held alive to keep watching, plus any
/// directories deferred for want of Full Disk Access (see [`retry_deferred`]).
///
/// This is the daemon's own watcher, deliberately separate from
/// [`sealgate_detectord::Watcher`]: it splits file-parent vs recursive dirs and
/// signals a channel rather than diffing snapshots itself, because the reconcile
/// loop already re-discovers everything. The TCC gating therefore has to be
/// applied HERE as well - the library `Watcher` is used only by its own tests
/// and example, so gating it alone left the daemon prompting exactly as before.
fn start_watcher(
    agents: &[Arc<dyn Agent>],
    tx: tokio::sync::mpsc::UnboundedSender<()>,
) -> Option<(FsDebouncer, DeferredWatches)> {
    // Files → watch their parent dir non-recursively (editors write via atomic
    // rename); dirs (workspace storage, plugin caches) → recursively.
    let mut file_dirs = HashSet::new();
    let mut rec_dirs = HashSet::new();
    for a in agents {
        let wt = a.watch_targets();
        for f in wt.files {
            if let Some(p) = f.parent() {
                file_dirs.insert(p.to_path_buf());
            }
        }
        for d in wt.dirs {
            rec_dirs.insert(d.path);
        }
    }

    let mut deb = new_debouncer(DEBOUNCE, None, move |res: DebounceEventResult| {
        if res.is_ok() {
            let _ = tx.send(());
        }
    })
    .map_err(|e| tracing::warn!(error = %e, "fs watcher setup failed; periodic rescan only"))
    .ok()?;

    // Watching a TCC-protected directory raises a permission dialog per folder
    // service. $HOME is the parent of ~/.claude.json, so every Claude Code user
    // hits it, and an FSEvents watch there prompts for Desktop, Documents AND
    // Downloads. Defer those until Full Disk Access is granted; the reconcile
    // loop's periodic rescan still sees changes under them, so detection
    // degrades to polling rather than stopping.
    let mut deferred: Vec<(PathBuf, RecursiveMode)> = Vec::new();
    let fda = sealgate_detectord::tcc::has_full_disk_access();
    for (dirs, mode) in [
        (&file_dirs, RecursiveMode::NonRecursive),
        (&rec_dirs, RecursiveMode::Recursive),
    ] {
        for dir in dirs {
            if !dir.exists() {
                continue;
            }
            if sealgate_detectord::tcc::watch_needs_full_disk_access(dir) && fda != Some(true) {
                tracing::warn!(
                    dir = %dir.display(),
                    "deferring watch: needs Full Disk Access. Watching it would prompt \
                     separately for Desktop, Documents and Downloads. Grant Full Disk \
                     Access to this binary in System Settings -> Privacy & Security; \
                     until then changes here are found by the periodic rescan instead \
                     of live events."
                );
                deferred.push((dir.clone(), mode));
                continue;
            }
            let _ = deb.watch(dir, mode);
        }
    }
    Some((deb, deferred))
}

/// Pick up watches deferred for want of Full Disk Access, once it is granted.
///
/// Called from the reconcile loop's periodic tick, so a grant made in System
/// Settings takes effect without restarting the daemon. Retains whatever it
/// could not watch, and only ever ADDS: a grant revoked later leaves existing
/// watches alone, since that prompt has already been answered.
/// `warned` carries the directories whose failure has already been reported, so
/// a durable failure (an exhausted inotify limit, an unreadable directory) is
/// warned about once instead of on every reconcile tick for the life of the
/// daemon. Retrying continues regardless - those causes are often transient, and
/// the periodic rescan still covers the directory meanwhile.
fn retry_deferred(
    deb: &mut FsDebouncer,
    deferred: &mut DeferredWatches,
    warned: &mut HashSet<PathBuf>,
) {
    if deferred.is_empty() || sealgate_detectord::tcc::has_full_disk_access() != Some(true) {
        return;
    }
    deferred.retain(|(dir, mode)| match deb.watch(dir, *mode) {
        Ok(()) => {
            tracing::info!(dir = %dir.display(), "watching (Full Disk Access granted)");
            warned.remove(dir);
            false
        }
        Err(e) => {
            if warned.insert(dir.clone()) {
                tracing::warn!(
                    dir = %dir.display(),
                    error = %e,
                    "deferred watch failed; retrying quietly from here"
                );
            } else {
                tracing::debug!(dir = %dir.display(), error = %e, "deferred watch still failing");
            }
            true
        }
    });
}

/// Publish a `Quarantined` event for `user` (no-op when there's no channel).
fn publish(events: Option<&EventTx>, user: &str, server: &DiscoveredServer, state: &str) {
    if let Some(tx) = events {
        let _ = tx.send((
            user.to_string(),
            Event::Quarantined(event_view(server, state)),
        ));
    }
}

fn event_view(s: &DiscoveredServer, state: &str) -> ServerView {
    let kind = match &s.config {
        ServerConfig::Stdio { .. } => "stdio",
        ServerConfig::Http { .. } => "http",
        ServerConfig::Opaque { .. } => "opaque",
    };
    ServerView {
        name: s.name.clone(),
        agent: s.client.to_string(),
        kind: kind.to_string(),
        state: state.to_string(),
        fingerprint: fingerprint(&s.name, &s.config),
        path: s.location.path.display().to_string(),
        // Events stay lean; a UI that needs the config reads it from list_servers.
        config: None,
    }
}

/// chown newly-created quarantine files (sidecar + backup) back to the owning
/// user. Only meaningful under root; a no-op in the dev build.
fn chown_new_files(record: &QuarantineRecord, user: &str) {
    if !paths::is_root() {
        return;
    }
    let Some((uid, gid)) = platform::uid_gid_for(user) else {
        tracing::warn!(user, "could not resolve uid for chown");
        return;
    };
    for p in [&record.disabled_path, &record.backup_path] {
        if p.exists() {
            let _ = platform::chown(p, uid, gid);
        }
    }
}

/// Refresh policy + known fingerprints into the enrollment/seen-store.
/// Fail-closed: on any error the cached values are kept, never downgraded.
pub async fn refresh(
    client: &BackendClient,
    enrollment: &mut Enrollment,
    seen: &mut SeenStore,
    user: &str,
) {
    match client.fetch_policy().await {
        Ok(p) => {
            if p.quarantine != enrollment.quarantine {
                tracing::info!(quarantine = p.quarantine, "policy updated");
            }
            enrollment.quarantine = p.quarantine;
            let _ = enrollment.save_for(user);
        }
        Err(e) => tracing::warn!(error = %e, "policy refresh failed; keeping last-known-good"),
    }

    match client.fetch_fingerprints().await {
        Ok(fps) if fps.org_id == enrollment.org_id => {
            let mut synced = HashSet::new();
            for e in &fps.entries {
                let action = match e.status {
                    KnownStatus::Requested => SeenAction::Requested,
                    KnownStatus::Registered => SeenAction::Registered,
                };
                let _ = seen.mark_from_backend(&e.fingerprint, &e.name, action);
                synced.insert(e.fingerprint.clone());
            }
            let _ = seen.prune_backend(&synced);
        }
        Ok(_) => tracing::warn!("fingerprints org mismatch; skipping sync"),
        Err(e) => {
            tracing::warn!(error = %e, "fingerprints refresh failed; keeping last-known-good")
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn reconcile_once(
    agents: &[Arc<dyn Agent>],
    seen: &mut SeenStore,
    quarantine: bool,
    store: &FileConfigStore,
    qstate: &mut QuarantinedState,
    enforce: bool,
    user: &str,
    events: Option<&EventTx>,
    reported: &mut HashSet<String>,
) {
    let observed = agents::discover_all(agents);

    // Notify the UI of report-only servers (edge-triggered, once each): non-sealgate
    // servers we won't quarantine — everything when the policy is off, plus
    // untouchable-opaque servers when it's on. Actioned servers get their own
    // Quarantined event instead.
    if let Some(tx) = events {
        for s in &observed {
            let report_only = !is_sealgate_entry(s)
                && (!quarantine
                    || matches!(
                        &s.config,
                        ServerConfig::Opaque {
                            removable: false,
                            ..
                        }
                    ));
            if report_only {
                let key = format!(
                    "{}\u{1f}{}\u{1f}{}",
                    s.client,
                    s.name,
                    s.location.path.display()
                );
                if reported.insert(key) {
                    let _ = tx.send((user.to_string(), Event::Discovered(event_view(s, "report"))));
                }
            }
        }
    }

    // Servers the pass deliberately leaves alone, with the reason (logged last):
    // our own entry, and *untouchable* opaque servers. Removable-opaque and
    // fingerprint-able servers are actioned, not skipped. Deduped by
    // (name, agent, fingerprint) since a report-only server is often discovered
    // from many project/plugin sources.
    let mut seen_skip = HashSet::new();
    let skips: Vec<Skip> = observed
        .iter()
        .filter_map(|s| {
            let skip = if is_sealgate_entry(s) {
                Skip::sealgate(s)
            } else if matches!(
                &s.config,
                ServerConfig::Opaque {
                    removable: false,
                    ..
                }
            ) {
                Skip::untouchable(s)
            } else {
                return None;
            };
            seen_skip
                .insert((skip.name.clone(), skip.agent, skip.fingerprint.clone()))
                .then_some(skip)
        })
        .collect();

    if !quarantine {
        tracing::info!(
            discovered = observed.len(),
            skipped = skips.len(),
            "policy OFF: inert (report only)"
        );
        log_skips(&skips);
        return;
    }

    let actions = plan(&observed, seen, Policy { quarantine });
    let known = count(&actions, |a| {
        matches!(a, ReconcileAction::SilentQuarantine { .. })
    });
    let opaque = count(&actions, |a| {
        matches!(a, ReconcileAction::RemoveOpaque { .. })
    });
    tracing::info!(
        discovered = observed.len(),
        will_quarantine = actions.len(),
        known,
        new = actions.len() - known - opaque,
        opaque_removals = opaque,
        will_skip = skips.len(),
        "reconcile"
    );

    for action in actions {
        // Opaque removals: neutralise locally, no fingerprint / disposition.
        if let ReconcileAction::RemoveOpaque { server } = &action {
            if !enforce {
                tracing::debug!(server = %server.name, agent = server.client, "[dry-run] would remove (opaque, cannot send to SG)");
                continue;
            }
            match store.quarantine(&server.location, &server.config) {
                Ok(record) => {
                    chown_new_files(&record, user);
                    publish(events, user, server, "removed");
                    tracing::info!(server = %server.name, agent = server.client, "removed (opaque, cannot send to SG)");
                    qstate.upsert(QuarantinedEntry {
                        name: server.name.clone(),
                        agent: server.client.to_string(),
                        // Path-keyed so each plugin dir is a distinct record
                        // (the dir name repeats across projects).
                        fingerprint: format!("opaque:{}", server.location.path.display()),
                        config: None, // opaque: can't be submitted to SG
                        record,
                    });
                    let _ = qstate.save_for(user);
                }
                Err(e) => {
                    tracing::warn!(server = %server.name, error = %e, "opaque removal failed")
                }
            }
            continue;
        }

        let (server, fp, known) = match action {
            ReconcileAction::SilentQuarantine {
                server,
                fingerprint,
            } => (server, fingerprint, true),
            ReconcileAction::QuarantineAndPrompt {
                server,
                fingerprint,
            } => (server, fingerprint, false),
            ReconcileAction::RemoveOpaque { .. } => unreachable!("handled above"),
        };

        if !enforce {
            tracing::debug!(server = %server.name, agent = server.client, known, fingerprint = %fp, "would quarantine (dry-run)");
            continue;
        }
        match store.quarantine(&server.location, &server.config) {
            Ok(record) => {
                chown_new_files(&record, user);
                // Known servers are neutralised silently; new (unknown) ones need
                // the UI to prompt (send to SG / keep quarantined).
                let state = if known {
                    "quarantined"
                } else {
                    "quarantine-prompt"
                };
                publish(events, user, &server, state);
                tracing::info!(server = %server.name, agent = server.client, known, fingerprint = %fp, "quarantined");
                let _ = seen.mark(&fp, &server.name, SeenAction::Quarantined);
                qstate.upsert(QuarantinedEntry {
                    name: server.name.clone(),
                    agent: server.client.to_string(),
                    fingerprint: fp,
                    config: Some(server.config.clone()),
                    record,
                });
                let _ = qstate.save_for(user);
            }
            Err(e) => tracing::warn!(server = %server.name, error = %e, "quarantine failed"),
        }
    }

    log_skips(&skips);
}

fn count(actions: &[ReconcileAction], pred: impl Fn(&ReconcileAction) -> bool) -> usize {
    actions.iter().filter(|a| pred(a)).count()
}

/// A discovered server the reconcile pass will not quarantine.
struct Skip {
    name: String,
    agent: &'static str,
    reason: &'static str,
    fingerprint: String,
}

impl Skip {
    fn sealgate(s: &sealgate_detectord::DiscoveredServer) -> Self {
        Self {
            name: s.name.clone(),
            agent: s.client,
            reason: "sealgate (our own server)",
            fingerprint: fingerprint(&s.name, &s.config).unwrap_or_else(|| "-".into()),
        }
    }

    fn untouchable(s: &sealgate_detectord::DiscoveredServer) -> Self {
        Self {
            name: s.name.clone(),
            agent: s.client,
            reason: "untouchable (no access to remove — e.g. an installed extension)",
            fingerprint: "-".into(),
        }
    }
}

fn log_skips(skips: &[Skip]) {
    // Per-server detail is debug — it repeats every reconcile tick; the summary
    // line carries the counts at info.
    for s in skips {
        tracing::debug!(server = %s.name, agent = s.agent, reason = s.reason, fingerprint = %s.fingerprint, "will not quarantine");
    }
}
