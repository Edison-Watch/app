//! The desired-state application layer: everything that turns a backend
//! announcement into spawned, respawned, or killed children.
//!
//! Split out of `daemon.rs` to keep that file within the repository's
//! file-size limit. This is an `impl Supervisor` block in a child module of
//! `daemon`, so every method below stays a `Supervisor` method, keeps its
//! call sites, and keeps direct access to the supervisor's private fields.

use std::collections::HashMap;

use edison_tunnel_protocol::{
    DesiredServer, DesiredStateUpdate, ServerSpawnResult, ServerSpecUpdate, TunnelError,
    TunnelFrame,
};
use tracing::warn;

use super::Supervisor;
use crate::proc::ChildServer;

impl Supervisor {
    pub(super) async fn apply_snapshot(&mut self, desired: Vec<DesiredServer>) {
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
    ///
    /// Ordering contract (PROTOCOL.md T-74): every kill-and-respawn path here
    /// (`apply_snapshot`, `apply_delta`, `apply_spec_update`,
    /// `apply_env_update`, `restart_unresponsive`) MUST `await`
    /// [`ChildServer::shutdown`] for the outgoing child *before* calling this,
    /// and this method's `server_spawn_result` send must stay after the
    /// spawn. That is what makes the old child's terminal `server_offline`
    /// reach the outbound channel first: `shutdown` returns only once the
    /// stdout pump's report has been queued, and the channel behind
    /// [`OutgoingHandle`] preserves the order in which sends complete, so the
    /// WS writer emits the two frames in that order. The backend relies on it
    /// to treat a successful ack as clearing a stored terminal error
    /// (`registry.py::_dispatch_inbound`).
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
    pub(super) async fn restart_unresponsive(&mut self, server_id: &str) {
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
    pub(super) async fn apply_spec_update(&mut self, update: ServerSpecUpdate) {
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
    pub(super) async fn apply_env_update(
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

    pub(super) async fn apply_delta(&mut self, delta: DesiredStateUpdate) {
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
