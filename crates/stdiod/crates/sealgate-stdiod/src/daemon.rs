//! Daemon supervisor: connects to the backend, reconciles desired state,
//! routes MCP frames between the WS and child subprocesses.
//!
//! Connection lifecycle:
//!
//! 1. Outer ``run`` loop keeps a long-lived [`Supervisor`] across WS
//!    reconnects. Children survive transient disconnects - their
//!    [`OutgoingHandle`] is rewired on each new WS so MCP frames keep
//!    flowing without restarting subprocesses.
//! 2. Each inner attempt: open WS → wire ``OutgoingHandle`` → send
//!    ``client_hello`` → spawn a heartbeat task → drain incoming frames
//!    until the WS closes.
//! 3. On disconnect we clear the handle (so children drop frames silently
//!    until reconnect) and back off with exponential delay + jitter.
//! 4. Auth failures (401/403) enter ``needs_reauth`` and wait for the
//!    on-disk credential to change before reconnecting.

use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};

use anyhow::{bail, Result};
use sealgate_tunnel_protocol::{
    ClientHello, McpFrame, ServerHello, TunnelError, TunnelFrame, PROTOCOL_VERSION,
};
use tokio::sync::{mpsc, Mutex};
use tokio::time::sleep;
use tracing::{debug, info, warn};

use crate::config;
pub use crate::daemon_auth::RunArgs;
use crate::daemon_auth::{
    connection_error_message, is_auth_rejection, is_protocol_rejection, requires_child_reset,
    ResolveRunError, ResolvedRun,
};
use crate::env_store::EnvStore;
use crate::state::{ConnectionState, State, StateWriter};
use crate::supervisor::Supervisor;
use crate::tunnel::{self, OutgoingHandle};

// The daemon pings every 15s and considers the connection dead if no pong
// arrives within HEARTBEAT_STALE_AFTER. On stale, the WS is closed and
// the outer reconnect loop kicks in.
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(15);
const HEARTBEAT_STALE_AFTER: Duration = Duration::from_secs(25);

// If the wall-clock gap between heartbeat ticks far exceeds the interval, the
// machine slept/suspended: the socket is almost certainly dead and the monotonic
// clock paused during sleep (so HEARTBEAT_STALE_AFTER would be measured from wake).
// Tear down immediately on resume instead of waiting it out.
const HEARTBEAT_RESUME_GAP: Duration = Duration::from_secs(45);

// Exponential backoff with jitter, capped so reconnects stay responsive.
const BACKOFF_MIN: Duration = Duration::from_secs(1);
const BACKOFF_MAX: Duration = Duration::from_secs(30);
const CONFIG_POLL_INTERVAL: Duration = Duration::from_secs(1);

pub async fn run(args: RunArgs) -> Result<()> {
    let initial = ResolvedRun::from_args(&args);
    let writer = StateWriter::new(State {
        backend_url: initial.as_ref().ok().map(|value| value.backend.clone()),
        device_id: initial.as_ref().ok().map(|value| value.device_id.clone()),
        device_label: initial.as_ref().ok().map(|value| value.label.clone()),
        ..State::default()
    });
    writer.update(|_| {}).await;
    let mut resolved = match initial {
        Ok(resolved) => resolved,
        Err(ResolveRunError::AwaitingLogin) => {
            writer
                .update(|state| {
                    state.connection_state = ConnectionState::NeedsReauth;
                    state.last_error = Some(
                        "credentials are missing or incomplete; run `sealgate-stdiod login`".into(),
                    );
                })
                .await;
            loop {
                sleep(CONFIG_POLL_INTERVAL).await;
                if let Ok(resolved) = ResolvedRun::from_args(&args) {
                    break resolved;
                }
            }
        }
        Err(error) => return Err(error.into()),
    };
    writer
        .update(|state| {
            state.connection_state = ConnectionState::Starting;
            state.backend_url = Some(resolved.backend.clone());
            state.device_id = Some(resolved.device_id.clone());
            state.device_label = Some(resolved.label.clone());
            state.last_error = None;
        })
        .await;

    // Resolve the interactive login-shell PATH once, up front, so child MCP
    // servers can find version-manager node/npx (nvm/fnm/...) - the daemon's own
    // (systemd/launchd) PATH doesn't include shell-rc additions. See proc.rs.
    crate::proc::init_child_env().await;

    // The supervisor - and the broker handle the children depend on -
    // live across reconnects. ``apply_snapshot`` on each new WS will
    // diff and reconcile.
    let outgoing = OutgoingHandle::new();

    let env_namespace = resolved.env_namespace();
    let env_store = EnvStore::open_for(env_namespace.as_deref())?;
    let supervisor = Arc::new(Mutex::new(Supervisor::new(
        outgoing.clone(),
        writer.clone(),
        env_store,
    )));

    let mut backoff = BACKOFF_MIN;
    let shutdown_signal = crate::process_shutdown::wait();
    tokio::pin!(shutdown_signal);
    loop {
        let result = tokio::select! {
            result = run_one_session(&resolved, &args, supervisor.clone(), &outgoing, &writer) => result,
            _ = &mut shutdown_signal => {
                outgoing.clear();
                supervisor.lock().await.shutdown_children().await;
                return Ok(());
            }
        };
        outgoing.clear();
        let needs_reauth = result.as_ref().err().is_some_and(is_auth_rejection);
        let needs_upgrade = result.as_ref().err().is_some_and(is_protocol_rejection);
        let wait_limit = if needs_reauth || needs_upgrade {
            supervisor.lock().await.shutdown_children().await;
            let message = result
                .as_ref()
                .err()
                .map(|error| connection_error_message(error, &resolved))
                .unwrap_or_else(|| "backend rejected the credential".into());
            if needs_upgrade {
                warn!("backend rejected the tunnel protocol; waiting for an upgrade");
            } else {
                warn!("backend rejected the credential; waiting for login");
            }
            writer
                .update(|state| {
                    state.connection_state = if needs_upgrade {
                        ConnectionState::NeedsUpgrade
                    } else {
                        ConnectionState::NeedsReauth
                    };
                    state.last_error = Some(message);
                })
                .await;
            backoff = BACKOFF_MIN;
            None
        } else {
            match &result {
                Ok(()) => {
                    info!("WS session ended cleanly; reconnecting");
                    backoff = BACKOFF_MIN;
                    writer
                        .update(|state| {
                            state.connection_state = ConnectionState::Reconnecting;
                            state.last_error = None;
                        })
                        .await;
                }
                Err(error) => {
                    let message = connection_error_message(error, &resolved);
                    warn!(error = %message, "WS session ended with error; will retry");
                    writer
                        .update(|state| {
                            state.connection_state = ConnectionState::Reconnecting;
                            state.last_error = Some(message);
                        })
                        .await;
                }
            }
            Some(jittered(backoff))
        };
        if let Some(delay) = wait_limit {
            info!(?delay, "waiting before reconnect");
        }
        let next = tokio::select! {
            next = wait_for_config(&resolved, &args, wait_limit, supervisor.clone(), &writer) => next,
            _ = &mut shutdown_signal => {
                outgoing.clear();
                supervisor.lock().await.shutdown_children().await;
                return Ok(());
            }
        };
        let changed = !resolved.same_connection(&next);
        let reset_children = requires_child_reset(&resolved, &next);
        let current_env_namespace = resolved.env_namespace();
        let next_env_namespace = next.env_namespace();
        if current_env_namespace != next_env_namespace {
            let env_store = EnvStore::open_for(next_env_namespace.as_deref())?;
            supervisor.lock().await.switch_env_store(env_store).await;
        } else if reset_children {
            supervisor.lock().await.shutdown_children().await;
        }
        writer
            .update(|state| {
                state.connection_state = ConnectionState::Reconnecting;
                state.backend_url = Some(next.backend.clone());
                state.device_id = Some(next.device_id.clone());
                state.device_label = Some(next.label.clone());
                state.last_error = None;
            })
            .await;
        resolved = next;
        backoff = if changed {
            BACKOFF_MIN
        } else {
            (backoff * 2).min(BACKOFF_MAX)
        };
    }
}

/// Wait until the normal retry deadline or until a changed usable config is
/// observed. If credentials disappear (logout), pause indefinitely until a
/// subsequent login produces a usable selection.
async fn wait_for_config(
    current: &ResolvedRun,
    args: &RunArgs,
    wait_limit: Option<Duration>,
    supervisor: Arc<Mutex<Supervisor>>,
    writer: &StateWriter,
) -> ResolvedRun {
    let deadline = wait_limit.and_then(|delay| Instant::now().checked_add(delay));
    let mut saw_unusable_config = false;
    loop {
        match ResolvedRun::from_args(args) {
            Ok(next) if !current.same_connection(&next) || saw_unusable_config => return next,
            Ok(_) => {}
            Err(_) => {
                if !saw_unusable_config {
                    supervisor.lock().await.shutdown_children().await;
                    writer
                        .update(|state| {
                            state.connection_state = ConnectionState::NeedsReauth;
                            state.last_error = Some(
                                "credentials were removed or are incomplete; run `sealgate-stdiod login`"
                                    .into(),
                            );
                        })
                        .await;
                }
                saw_unusable_config = true;
            }
        }

        if !saw_unusable_config && deadline.is_some_and(|deadline| Instant::now() >= deadline) {
            return current.clone();
        }
        let sleep_for = deadline
            .map(|deadline| {
                deadline
                    .saturating_duration_since(Instant::now())
                    .min(CONFIG_POLL_INTERVAL)
            })
            .unwrap_or(CONFIG_POLL_INTERVAL);
        sleep(sleep_for).await;
    }
}

async fn wait_for_connection_change(
    current: &ResolvedRun,
    args: &RunArgs,
    supervisor: Arc<Mutex<Supervisor>>,
) {
    loop {
        sleep(CONFIG_POLL_INTERVAL).await;
        match ResolvedRun::from_args(args) {
            Ok(next) if !current.same_connection(&next) => {
                if requires_child_reset(current, &next) {
                    supervisor.lock().await.shutdown_children().await;
                }
                return;
            }
            Err(_) => {
                supervisor.lock().await.shutdown_children().await;
                return;
            }
            Ok(_) => {}
        }
    }
}

/// One connect + drain pass. Returns Ok when the WS closed cleanly (we'll
/// reconnect), Err on connect failure.
async fn run_one_session(
    args: &ResolvedRun,
    run_args: &RunArgs,
    supervisor: Arc<Mutex<Supervisor>>,
    outgoing: &OutgoingHandle,
    writer: &StateWriter,
) -> Result<()> {
    let ws = tunnel::connect(
        &args.backend,
        &args.credential,
        args.sealgate_secret_key.as_deref(),
        &args.device_id,
    )
    .await?;
    // WS upgrade succeeded - we've passed auth + the org feature flag.
    writer
        .update(|s| {
            s.connection_state = ConnectionState::Connected;
            s.last_connected_at = Some(chrono::Utc::now());
            s.last_error = None;
        })
        .await;

    let (outgoing_tx, outgoing_rx) = mpsc::channel::<TunnelFrame>(64);
    let (incoming_tx, mut incoming_rx) = mpsc::channel::<TunnelFrame>(64);

    // Wire the broker before any task can publish a frame.
    outgoing.set(outgoing_tx.clone());

    let mut ws_task = tokio::spawn(tunnel::run_frame_loop(ws, outgoing_rx, incoming_tx));

    // client_hello: announce which servers we already have running so the
    // backend can reconcile.
    let currently_running = supervisor
        .lock()
        .await
        .children
        .iter()
        .filter(|(_, child)| !child.has_exited())
        .map(|(id, _)| id.clone())
        .collect::<Vec<_>>();
    outgoing
        .send(TunnelFrame::ClientHello(ClientHello {
            protocol_version: PROTOCOL_VERSION,
            device_id: args.device_id.clone(),
            hostname: config::hostname(),
            label: args.label.clone(),
            os: config::current_os(),
            client_version: env!("CARGO_PKG_VERSION").to_string(),
            currently_running,
        }))
        .await;

    // Heartbeat. ``last_pong`` is bumped by every inbound frame (Pong or
    // anything else - any traffic means the backend is alive).
    let last_pong = Arc::new(Mutex::new(Instant::now()));
    let mut hb_task = {
        let outgoing = outgoing.clone();
        let last_pong = last_pong.clone();
        tokio::spawn(heartbeat(outgoing, last_pong))
    };

    let result = tokio::select! {
        biased;
        r = drain_incoming(supervisor.clone(), &mut incoming_rx, last_pong) => match r {
            Ok(()) => websocket_task_result(&mut ws_task).await,
            Err(error) => Err(error),
        },
        result = &mut ws_task => match result {
            Ok(result) => result,
            Err(error) => Err(anyhow::Error::from(error).context("WebSocket task failed")),
        },
        _ = &mut hb_task => {
            warn!("heartbeat: stale connection, tearing down session to reconnect");
            Ok(())
        },
        _ = wait_for_connection_change(args, run_args, supervisor) => {
            info!("configuration changed; restarting authenticated session");
            Ok(())
        }
    };
    hb_task.abort();
    ws_task.abort();
    drop(outgoing_tx);
    result
}

async fn websocket_task_result(task: &mut tokio::task::JoinHandle<Result<()>>) -> Result<()> {
    match task.await {
        Ok(result) => result,
        Err(error) => Err(anyhow::Error::from(error).context("WebSocket task failed")),
    }
}

async fn drain_incoming(
    supervisor: Arc<Mutex<Supervisor>>,
    incoming_rx: &mut mpsc::Receiver<TunnelFrame>,
    last_pong: Arc<Mutex<Instant>>,
) -> Result<()> {
    while let Some(frame) = incoming_rx.recv().await {
        // Any inbound traffic counts as liveness, not just pongs.
        *last_pong.lock().await = Instant::now();

        let mut sup = supervisor.lock().await;
        match frame {
            TunnelFrame::ServerHello(ServerHello {
                protocol_version,
                servers,
            }) => {
                info!(
                    protocol_version,
                    server_count = servers.len(),
                    "received server_hello"
                );
                if protocol_version != PROTOCOL_VERSION {
                    warn!(
                        backend_version = protocol_version,
                        local_version = PROTOCOL_VERSION,
                        "protocol version mismatch; continuing in v1 MVP"
                    );
                }
                sup.apply_snapshot(servers).await;
            }
            TunnelFrame::DesiredStateUpdate(update) => sup.apply_delta(update).await,
            TunnelFrame::McpFrame(McpFrame { server_id, frame }) => {
                let mut restart_unresponsive = false;
                let terminal_error = if let Some(child) = sup.children.get_mut(&server_id) {
                    if child.has_exited() {
                        child.take_terminal_error().await
                    } else {
                        match child.outbound_tx.try_send(frame) {
                            Ok(()) => None,
                            Err(mpsc::error::TrySendError::Closed(_)) => {
                                warn!(server_id = %server_id, "child outbound channel closed");
                                child.take_terminal_error().await
                            }
                            Err(mpsc::error::TrySendError::Full(_)) => {
                                warn!(
                                    server_id = %server_id,
                                    "child outbound queue full; restarting unresponsive server"
                                );
                                restart_unresponsive = true;
                                Some(TunnelError {
                                    server_id: Some(server_id.clone()),
                                    related_jsonrpc_id: None,
                                    code: "server_unresponsive".into(),
                                    message: "Local MCP process stopped accepting requests; restarting it.".into(),
                                })
                            }
                        }
                    }
                } else {
                    warn!(server_id = %server_id, "mcp_frame for unknown server; dropping");
                    None
                };
                if let Some(error) = terminal_error {
                    sup.tunnel_outgoing
                        .send(TunnelFrame::TunnelError(error))
                        .await;
                }
                if restart_unresponsive {
                    sup.restart_unresponsive(&server_id).await;
                }
            }
            TunnelFrame::TunnelError(err) => {
                warn!(
                    code = %err.code,
                    server_id = err.server_id.as_deref(),
                    "tunnel_error from backend"
                );
                // Device-wide (server_id=None) errors are soft rejections like
                // the ``stdio_tunnel_disabled`` org feature flag. Bail so the
                // outer reconnect loop persists the friendly message into
                // state.last_error - if we wrote it directly the loop's
                // Ok-branch (triggered by the backend's graceful close that
                // follows) would clear it again.
                if err.server_id.is_none() {
                    bail!("{}", err.message);
                }
            }
            TunnelFrame::Ping(_) => {
                drop(sup); // release before awaiting
                sup = supervisor.lock().await; // and re-acquire (no-op pattern keeps borrow checker happy)
                let _ = &sup;
                // (We just need to send a Pong. Use the broker so we don't
                // need to plumb the raw sender in here.)
                sup.tunnel_outgoing
                    .send(TunnelFrame::Pong(Default::default()))
                    .await;
            }
            TunnelFrame::ServerEnvUpdate(update) => {
                debug!(
                    server_id = %update.server_id,
                    env_keys = update.env.len(),
                    "applying server_env_update",
                );
                sup.apply_env_update(update.server_id, update.env).await;
            }
            TunnelFrame::ServerSpecUpdate(update) => {
                debug!(
                    server_id = %update.server_id,
                    env_keys = update.env.as_ref().map(|e| e.len()).unwrap_or(0),
                    templated_args = update.templated_args.as_ref().map(|t| t.len()).unwrap_or(0),
                    "applying server_spec_update",
                );
                sup.apply_spec_update(update).await;
            }
            TunnelFrame::ServerSpawnResult(_)
            | TunnelFrame::ClientHello(_)
            | TunnelFrame::Pong(_) => {
                // These frames are daemon→backend only, or liveness already handled above.
            }
        }
    }
    Ok(())
}

async fn heartbeat(outgoing: OutgoingHandle, last_pong: Arc<Mutex<Instant>>) {
    let mut tick = tokio::time::interval(HEARTBEAT_INTERVAL);
    // ``MissedTickBehavior::Delay`` so we don't burst pings after a pause.
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut last_tick_wall = SystemTime::now();
    loop {
        tick.tick().await;

        // Detect a resume-from-sleep: a wall-clock jump much larger than the
        // interval means the process was frozen. Reconnect now rather than waiting
        // out the (monotonic) stale window, which only starts counting from wake.
        let now_wall = SystemTime::now();
        let wall_gap = now_wall.duration_since(last_tick_wall).unwrap_or_default();
        last_tick_wall = now_wall;
        if wall_gap > HEARTBEAT_RESUME_GAP {
            warn!(
                ?wall_gap,
                "heartbeat: large wall-clock gap (system resumed?), reconnecting"
            );
            outgoing.clear();
            return;
        }

        let stale = {
            let last = *last_pong.lock().await;
            Instant::now().saturating_duration_since(last)
        };
        if stale > HEARTBEAT_STALE_AFTER {
            warn!(
                ?stale,
                "heartbeat: no traffic from backend, closing connection"
            );
            // Dropping the only OutgoingHandle clone in our scope doesn't
            // close the underlying sender (the supervisor still holds one).
            // The cleanest way to force-close is to clear the broker so the
            // WS send task's channel drains and exits - but the WS task
            // also reads from the wire, and the read won't return until the
            // backend writes. We rely on the WS task's own keepalive and on
            // the supervisor-level reconnect; for v1.1 we'll add an
            // explicit ws-close signal here.
            outgoing.clear();
            return;
        }
        debug!("heartbeat: sending ping");
        outgoing.send(TunnelFrame::Ping(Default::default())).await;
    }
}

fn jittered(base: Duration) -> Duration {
    // ±25% jitter, computed without bringing in a full RNG crate. Uses the
    // process-monotonic nanos as a quick & dirty entropy source - fine for
    // backoff dispersion.
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0) as u64;
    let pct = (nanos % 51) as i64 - 25; // -25..=+25
    let base_ms = base.as_millis() as i64;
    let delta_ms = (base_ms * pct) / 100;
    let final_ms = (base_ms + delta_ms).max(0) as u64;
    Duration::from_millis(final_ms)
}
