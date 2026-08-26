//! Child-process supervision for the daemon.
//!
//! Owns the live `ChildServer` map and reconciles it against the desired state
//! the backend announces over the tunnel: full snapshots, incremental deltas,
//! per-server spec/env updates, and restarts of unresponsive children. Split out
//! of `daemon.rs`, which keeps the connection lifecycle (connect, heartbeat,
//! backoff, frame routing) and drives this type across reconnects.

use std::collections::HashMap;

use sealgate_tunnel_protocol::{
    DesiredServer, DesiredStateUpdate, ServerSpawnResult, ServerSpecUpdate, TunnelError,
    TunnelFrame,
};
use tracing::warn;

use crate::env_store::{resolve_env_for_spawn, substitute_templated_args, EnvStore};
use crate::proc::ChildServer;
use crate::state::{ServerEntry, ServerStatus, StateWriter};
use crate::tunnel::OutgoingHandle;

/// One `state.json` entry for a supervised child, derived from what the
/// daemon can actually observe about the process.
///
/// Only two of [`ServerStatus`]'s three values are reachable here:
///
/// - `crashed` - the process was seen to exit
///   ([`ChildServer::has_observed_exit`]). The child stays in the map until
///   the next reconciliation respawns or drops it, so this is what the tray
///   sees in the meantime.
/// - `running` - the process was spawned and has not been seen to exit.
///
/// The mapping keys off the observed exit rather than
/// [`ChildServer::has_exited`], which is the wider "terminal for MCP" latch
/// and also covers a child whose stdin broke while the process is still
/// alive. Reporting that child as `crashed` beside its own live PID would be
/// a claim the daemon cannot support; it stays `running` until the supervisor
/// kills and respawns it, which the same latch makes it do on the next
/// reconciliation.
///
/// `starting` has no observable trigger. A stdio MCP server writes nothing
/// until the backend opens a session against it, which can be minutes or
/// hours after the spawn, so treating "no output yet" as `starting` would pin
/// healthy idle children there indefinitely. The daemon would need a health
/// signal it does not have. See PROTOCOL.md T-69.
fn child_entry(name: &str, child: &ChildServer) -> ServerEntry {
    ServerEntry {
        name: name.to_string(),
        state: if child.has_observed_exit() {
            ServerStatus::Crashed
        } else {
            ServerStatus::Running
        },
        pid: child.pid,
    }
}

/// Reconciles desired-state announcements against running children.
pub(crate) struct Supervisor {
    pub(crate) children: HashMap<String, ChildServer>,
    pub(crate) tunnel_outgoing: OutgoingHandle,
    state: StateWriter,
    env_store: EnvStore,
}

impl Supervisor {
    pub(crate) fn new(
        tunnel_outgoing: OutgoingHandle,
        state: StateWriter,
        env_store: EnvStore,
    ) -> Self {
        Self {
            children: HashMap::new(),
            tunnel_outgoing,
            state,
            env_store,
        }
    }

    pub(crate) async fn switch_env_store(&mut self, env_store: EnvStore) {
        self.shutdown_children().await;
        self.env_store = env_store;
    }

    pub(crate) async fn shutdown_children(&mut self) {
        let children = std::mem::take(&mut self.children);
        for (_, child) in children {
            child.shutdown().await;
        }
        self.publish_state().await;
    }

    /// Apply the device's stored values to the incoming `DesiredServer`:
    /// env is overlaid via [`resolve_env_for_spawn`], and any
    /// `templated_args` substitutions are applied to each arg as a substring
    /// rewrite. `command` / `args` (structure) / `working_dir` always come
    /// from `DesiredServer` - the daemon never invents the spec.
    fn enrich(&self, mut desired: DesiredServer) -> DesiredServer {
        if let Some(spec) = self.env_store.get(&desired.server_id) {
            if !spec.templated_args.is_empty() {
                desired.args = substitute_templated_args(&desired.args, &spec.templated_args);
            }
        }
        desired.env = resolve_env_for_spawn(self.env_store.get(&desired.server_id), &desired.env);
        desired
    }

    /// Build the ``servers`` entries for state.json from the live child
    /// map. Called after every supervisor mutation so the file stays in
    /// lockstep with reality.
    fn snapshot_entries(&self) -> Vec<ServerEntry> {
        self.children
            .iter()
            .map(|(name, child)| child_entry(name, child))
            .collect()
    }

    async fn publish_state(&self) {
        let entries = self.snapshot_entries();
        self.state.update(|s| s.servers = entries).await;
    }

    pub(crate) async fn apply_snapshot(&mut self, desired: Vec<DesiredServer>) {
        // Hold the *raw* (pre-enrich) DesiredServer here so respawn paths
        // (apply_spec_update / apply_env_update) can re-enrich against the
        // freshly-updated env_store. Enrichment runs inside try_spawn.
        let wanted: HashMap<String, DesiredServer> = desired
            .into_iter()
            .map(|d| (d.server_id.clone(), d))
            .collect();

        // Kill servers no longer in the snapshot (or now disabled).
        let to_drop: Vec<String> = self
            .children
            .keys()
            .filter(|id| wanted.get(*id).map(|d| !d.enabled).unwrap_or(true))
            .cloned()
            .collect();
        for id in to_drop {
            if let Some(child) = self.children.remove(&id) {
                child.shutdown().await;
            }
        }

        // Respawn changed/exited servers; dedicated frames handle env-only changes.
        for (id, desired) in wanted {
            if !desired.enabled {
                continue;
            }
            if let Some(existing) = self.children.get(&id) {
                if existing.desired_raw == desired && !existing.has_exited() {
                    continue;
                }
                if let Some(stale) = self.children.remove(&id) {
                    stale.shutdown().await;
                }
            }
            self.try_spawn(desired).await;
        }
        self.publish_state().await;
    }

    /// Spawn one raw desired server after applying current local values. Reports
    /// the spawn result and retains placeholders so later respawns re-enrich cleanly.
    async fn try_spawn(&mut self, raw: DesiredServer) {
        let server_id = raw.server_id.clone();
        let sensitive_arg_values = self
            .env_store
            .get(&server_id)
            .map(|spec| spec.templated_args.values().cloned().collect())
            .unwrap_or_default();
        let enriched = self.enrich(raw.clone());
        match ChildServer::spawn(
            &raw,
            &enriched,
            self.tunnel_outgoing.clone(),
            sensitive_arg_values,
            Some(self.state.clone()),
        ) {
            Ok(child) => {
                self.children.insert(server_id.clone(), child);
                self.tunnel_outgoing
                    .send(TunnelFrame::ServerSpawnResult(ServerSpawnResult {
                        server_id,
                        ok: true,
                        error: None,
                    }))
                    .await;
            }
            Err(e) => {
                let message = format!("failed to spawn `{}`: {e}", enriched.command);
                warn!(server_id = %server_id, error = %e, "spawn failed");
                self.tunnel_outgoing
                    .send(TunnelFrame::ServerSpawnResult(ServerSpawnResult {
                        server_id: server_id.clone(),
                        ok: false,
                        error: Some(message.clone()),
                    }))
                    .await;
                self.tunnel_outgoing
                    .send(TunnelFrame::TunnelError(TunnelError {
                        server_id: Some(server_id),
                        related_jsonrpc_id: None,
                        code: "spawn_failed".into(),
                        message,
                    }))
                    .await;
            }
        }
    }

    /// Kill and respawn a child whose outbound queue overflowed. Dropping
    /// the wedged process restores request forwarding immediately instead of
    /// leaving frames silently dropped until the next desired-state
    /// reconciliation happens to arrive.
    pub(crate) async fn restart_unresponsive(&mut self, server_id: &str) {
        let Some(existing) = self.children.remove(server_id) else {
            return;
        };
        let raw = existing.desired_raw.clone();
        existing.shutdown().await;
        self.try_spawn(raw).await;
        self.publish_state().await;
    }

    /// Persist a full resolved spec for a server (the backend's substituted
    /// command/args/env/working_dir) and respawn if it's currently running so
    /// the new spec takes effect immediately. No-op on not-yet-known
    /// servers; the spec is still saved for whenever the matching
    /// `DesiredStateUpdate` arrives. Wholesale replace (not merge) on the
    /// store side: each `ServerSpecUpdate` carries the complete resolved
    /// view, so previously-staged stale fields shouldn't linger.
    pub(crate) async fn apply_spec_update(&mut self, update: ServerSpecUpdate) {
        let server_id = update.server_id.clone();
        if let Err(e) =
            self.env_store
                .merge_template_values(&server_id, update.env, update.templated_args)
        {
            warn!(server_id = %server_id, error = %e, "failed to persist server_spec_update");
            return;
        }
        if let Some(existing) = self.children.remove(&server_id) {
            // Clone the *raw* spec so ``try_spawn``'s internal ``enrich``
            // can re-apply ``{KEY}`` substitution against the freshly-
            // merged env_store. Cloning ``existing.spec`` (the already-
            // substituted form) would leave ``substitute_templated_args``
            // nothing to find and the stale values would stay baked in.
            let raw = existing.desired_raw.clone();
            existing.shutdown().await;
            self.try_spawn(raw).await;
            self.publish_state().await;
        }
    }

    /// Persist new env values for a server and restart it if it's already
    /// running so the new env takes effect immediately. No-op on
    /// not-yet-known servers - the env is still saved for whenever the
    /// matching `DesiredStateUpdate` arrives.
    pub(crate) async fn apply_env_update(
        &mut self,
        server_id: String,
        env: std::collections::BTreeMap<String, String>,
    ) {
        // Merge because the backend forwards only changed keys.
        if let Err(e) = self.env_store.merge_env(&server_id, env) {
            warn!(server_id = %server_id, error = %e, "failed to persist server_env_update");
            return;
        }
        if let Some(existing) = self.children.remove(&server_id) {
            // Raw spec, same reasoning as apply_spec_update above:
            // ``try_spawn`` re-enriches against the updated env_store.
            let raw = existing.desired_raw.clone();
            existing.shutdown().await;
            self.try_spawn(raw).await;
            self.publish_state().await;
        }
    }

    pub(crate) async fn apply_delta(&mut self, delta: DesiredStateUpdate) {
        // Preserve healthy identical children so tools/list never precedes initialize.
        for d in delta.added.into_iter().chain(delta.updated) {
            if !d.enabled {
                if let Some(existing) = self.children.remove(&d.server_id) {
                    existing.shutdown().await;
                }
                continue;
            }
            if let Some(existing) = self.children.get(&d.server_id) {
                if existing.desired_raw == d && !existing.has_exited() {
                    continue;
                }
            }
            if let Some(existing) = self.children.remove(&d.server_id) {
                existing.shutdown().await;
            }
            self.try_spawn(d).await;
        }
        for id in delta.removed {
            if let Some(child) = self.children.remove(&id) {
                child.shutdown().await;
            }
            if let Err(e) = self.env_store.remove(&id) {
                warn!(server_id = %id, error = %e, "failed to drop env_store entry on remove");
            }
        }
        self.publish_state().await;
    }
}

#[cfg(all(test, unix))]
#[path = "supervisor_tests.rs"]
mod tests;
