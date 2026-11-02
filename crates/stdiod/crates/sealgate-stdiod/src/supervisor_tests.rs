use std::time::Duration;

use sealgate_tunnel_protocol::TunnelFrame;
use tokio::sync::mpsc;

use super::*;
use crate::state::State;

fn desired(server_id: &str, script: &str) -> DesiredServer {
    DesiredServer {
        server_id: server_id.into(),
        name: server_id.into(),
        command: "/bin/sh".into(),
        args: vec!["-c".into(), script.into()],
        env: Default::default(),
        working_dir: None,
        enabled: true,
    }
}

fn env_store_for(test: &str) -> EnvStore {
    let path = std::env::temp_dir().join(format!(
        "edison-stdiod-daemon-{}-{test}.json",
        std::process::id()
    ));
    let _ = std::fs::remove_file(&path);
    EnvStore::open_at(path).unwrap()
}

fn supervisor_with(test: &str, children: HashMap<String, ChildServer>) -> Supervisor {
    supervisor_with_outgoing(test, children, OutgoingHandle::new())
}

fn supervisor_with_outgoing(
    test: &str,
    children: HashMap<String, ChildServer>,
    outgoing: OutgoingHandle,
) -> Supervisor {
    let mut supervisor = Supervisor::new(
        outgoing,
        StateWriter::new(State::default()),
        env_store_for(test),
    );
    supervisor.children = children;
    supervisor
}

/// A live child is reported as running, with its PID, so the tray can
/// address it.
#[tokio::test]
async fn snapshot_reports_a_live_child_as_running() {
    let spec = desired("filesystem", "sleep 30");
    let child = ChildServer::spawn(&spec, &spec, OutgoingHandle::new(), Vec::new(), None).unwrap();
    let pid = child.pid;
    assert!(pid.is_some(), "spawned child should have a PID");

    let supervisor = supervisor_with(
        "running",
        HashMap::from([("filesystem".to_string(), child)]),
    );
    let entries = supervisor.snapshot_entries();

    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].name, "filesystem");
    assert_eq!(entries[0].pid, pid);
    assert!(matches!(entries[0].state, ServerStatus::Running));

    supervisor
        .children
        .into_values()
        .next()
        .unwrap()
        .shutdown()
        .await;
}

/// A child that exited is reported as crashed rather than staying
/// `running` until the next desired-state push happens to arrive. The
/// child is still in the map because nothing has respawned it yet, which
/// is exactly the window the tray needs to see.
#[tokio::test]
async fn snapshot_reports_an_exited_child_as_crashed() {
    let spec = desired("fetch", "exit 3");
    let outgoing = OutgoingHandle::new();
    let (wire_tx, mut wire_rx) = mpsc::channel(4);
    outgoing.set(wire_tx);
    let child = ChildServer::spawn(&spec, &spec, outgoing, Vec::new(), None).unwrap();
    let pid = child.pid;

    // The terminal report is what latches ``has_exited``; wait for it so
    // the assertion is about observed death, not about timing.
    let frame = tokio::time::timeout(Duration::from_secs(5), wire_rx.recv())
        .await
        .expect("child death should be reported")
        .expect("outgoing channel should stay open");
    assert!(matches!(frame, TunnelFrame::TunnelError(_)));

    let supervisor = supervisor_with("crashed", HashMap::from([("fetch".to_string(), child)]));
    let entries = supervisor.snapshot_entries();

    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].name, "fetch");
    assert_eq!(entries[0].pid, pid, "a crashed entry keeps its PID");
    assert!(matches!(entries[0].state, ServerStatus::Crashed));
}

/// PROTOCOL.md T-74: a kill-and-respawn MUST put the old child's terminal
/// `server_offline` on the outbound channel before the replacement's
/// `server_spawn_result`, so the backend can treat a successful ack as
/// clearing the stored error. The outbound channel is the observation point
/// the WS writer drains in order, so frame order here is wire order.
///
/// Both frames are read with `try_recv`: they must already be queued by the
/// time the respawn path returns, not merely arrive eventually.
#[tokio::test]
async fn respawn_queues_terminal_offline_before_the_spawn_ack() {
    let spec = desired("filesystem", "sleep 30");
    let outgoing = OutgoingHandle::new();
    let (wire_tx, mut wire_rx) = mpsc::channel(8);
    outgoing.set(wire_tx);
    let child = ChildServer::spawn(&spec, &spec, outgoing.clone(), Vec::new(), None).unwrap();
    let mut supervisor = supervisor_with_outgoing(
        "respawn-order",
        HashMap::from([("filesystem".to_string(), child)]),
        outgoing,
    );

    supervisor.restart_unresponsive("filesystem").await;

    let TunnelFrame::TunnelError(error) = wire_rx
        .try_recv()
        .expect("the old child's terminal error should already be queued")
    else {
        panic!("first frame should be the old child's terminal tunnel_error");
    };
    assert_eq!(error.code, "server_offline");
    assert_eq!(error.server_id.as_deref(), Some("filesystem"));

    let TunnelFrame::ServerSpawnResult(result) = wire_rx
        .try_recv()
        .expect("the replacement's spawn ack should follow it")
    else {
        panic!("second frame should be the replacement's server_spawn_result");
    };
    assert!(result.ok, "the replacement should have spawned");
    assert_eq!(result.server_id, "filesystem");

    supervisor.shutdown_children().await;
}

/// A child whose stdin has broken is terminal for MCP - the backend gets its
/// `server_offline` - but the process may still be running, and the snapshot
/// must not call a live PID crashed. It stays `running` until the supervisor
/// kills and respawns it.
#[tokio::test]
async fn snapshot_keeps_a_live_child_with_broken_stdin_as_running() {
    // `exec 0<&-` closes the child's read end, so our next write to it fails
    // with EPIPE while `sleep` keeps the process alive.
    let spec = desired("memory", "exec 0<&-; sleep 30");
    let outgoing = OutgoingHandle::new();
    let (wire_tx, mut wire_rx) = mpsc::channel(4);
    outgoing.set(wire_tx);
    let child = ChildServer::spawn(&spec, &spec, outgoing, Vec::new(), None).unwrap();
    let pid = child.pid;

    // Keep offering frames until one fails to reach the child: the shell needs
    // a moment to close the descriptor, and writes before that land in the
    // pipe buffer and succeed.
    let mut reported = None;
    for _ in 0..100 {
        let _ = child
            .outbound_tx
            .send(serde_json::json!({"jsonrpc": "2.0", "id": 1, "method": "ping"}))
            .await;
        if let Ok(Some(frame)) =
            tokio::time::timeout(Duration::from_millis(50), wire_rx.recv()).await
        {
            reported = Some(frame);
            break;
        }
    }
    let Some(TunnelFrame::TunnelError(error)) = reported else {
        panic!("a broken stdin should report the server offline");
    };
    assert_eq!(error.code, "server_offline");
    assert!(
        child.has_exited(),
        "an unwritable child is terminal for MCP, so the supervisor replaces it"
    );

    let supervisor = supervisor_with(
        "broken-stdin",
        HashMap::from([("memory".to_string(), child)]),
    );
    let entries = supervisor.snapshot_entries();

    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0].pid, pid);
    assert!(
        matches!(entries[0].state, ServerStatus::Running),
        "a process that has not been seen to exit is not crashed: {:?}",
        entries[0].state
    );

    supervisor
        .children
        .into_values()
        .next()
        .unwrap()
        .shutdown()
        .await;
}

/// No child, no entries: an empty map publishes an empty array rather
/// than a stale one.
#[test]
fn snapshot_of_no_children_is_empty() {
    let supervisor = supervisor_with("empty", HashMap::new());
    assert!(supervisor.snapshot_entries().is_empty());
}

/// Wait for a child's terminal report: that is what latches its exit.
async fn wait_for_exit(wire_rx: &mut mpsc::Receiver<TunnelFrame>) {
    loop {
        let frame = tokio::time::timeout(Duration::from_secs(5), wire_rx.recv())
            .await
            .expect("child death should be reported")
            .expect("outgoing channel should stay open");
        if matches!(frame, TunnelFrame::TunnelError(_)) {
            return;
        }
    }
}

/// Drain whatever is queued and say whether a spawn ack for `id` was in it.
fn spawn_acked(wire_rx: &mut mpsc::Receiver<TunnelFrame>, id: &str) -> bool {
    let mut acked = false;
    while let Ok(frame) = wire_rx.try_recv() {
        if let TunnelFrame::ServerSpawnResult(result) = frame {
            acked |= result.ok && result.server_id == id;
        }
    }
    acked
}

/// The reboot case: a child that exits at once (Beeper not listening yet) is
/// started again after a short delay instead of staying down.
#[tokio::test]
async fn an_exited_child_is_started_again_after_the_first_delay() {
    let spec = desired("beeper", "exit 1");
    let outgoing = OutgoingHandle::new();
    let (wire_tx, mut wire_rx) = mpsc::channel(32);
    outgoing.set(wire_tx);
    let child = ChildServer::spawn(&spec, &spec, outgoing.clone(), Vec::new(), None).unwrap();
    let mut supervisor = supervisor_with_outgoing(
        "respawn-first",
        HashMap::from([("beeper".to_string(), child)]),
        outgoing,
    );
    wait_for_exit(&mut wire_rx).await;

    let t0 = Instant::now();
    supervisor.respawn_exited(t0).await;
    assert!(
        !spawn_acked(&mut wire_rx, "beeper"),
        "not before the first delay"
    );

    supervisor.respawn_exited(t0 + Duration::from_secs(3)).await;
    assert!(
        spawn_acked(&mut wire_rx, "beeper"),
        "started again after it"
    );
    supervisor.shutdown_children().await;
}

/// A child that keeps exiting is tried less and less often.
#[tokio::test]
async fn the_delay_grows_while_a_child_keeps_exiting() {
    let spec = desired("beeper", "exit 1");
    let outgoing = OutgoingHandle::new();
    let (wire_tx, mut wire_rx) = mpsc::channel(32);
    outgoing.set(wire_tx);
    let child = ChildServer::spawn(&spec, &spec, outgoing.clone(), Vec::new(), None).unwrap();
    let mut supervisor = supervisor_with_outgoing(
        "respawn-growth",
        HashMap::from([("beeper".to_string(), child)]),
        outgoing,
    );
    wait_for_exit(&mut wire_rx).await;

    let t0 = Instant::now();
    supervisor.respawn_exited(t0).await;
    supervisor.respawn_exited(t0 + Duration::from_secs(2)).await;
    assert!(spawn_acked(&mut wire_rx, "beeper"), "first retry after 2s");
    wait_for_exit(&mut wire_rx).await;

    // The second wait is 5s, counted from the first retry.
    supervisor.respawn_exited(t0 + Duration::from_secs(6)).await;
    assert!(
        !spawn_acked(&mut wire_rx, "beeper"),
        "not within 5s of the first retry"
    );
    supervisor.respawn_exited(t0 + Duration::from_secs(7)).await;
    assert!(spawn_acked(&mut wire_rx, "beeper"), "second retry 5s later");
    supervisor.shutdown_children().await;
}

/// Once a child has stayed up, its retry count starts afresh: the next exit
/// is retried after the short first delay again.
#[tokio::test]
async fn a_child_that_stays_up_is_forgiven() {
    let outgoing = OutgoingHandle::new();
    let (wire_tx, mut wire_rx) = mpsc::channel(32);
    outgoing.set(wire_tx);
    let failing = desired("beeper", "exit 1");
    let child = ChildServer::spawn(&failing, &failing, outgoing.clone(), Vec::new(), None).unwrap();
    let mut supervisor = supervisor_with_outgoing(
        "respawn-forgiven",
        HashMap::from([("beeper".to_string(), child)]),
        outgoing.clone(),
    );
    wait_for_exit(&mut wire_rx).await;
    let t0 = Instant::now();
    supervisor.respawn_exited(t0).await;
    supervisor.respawn_exited(t0 + Duration::from_secs(2)).await;
    assert_eq!(supervisor.respawns["beeper"].attempts, 1);

    // The replacement stays up: swap in a long-running child under the same id.
    let healthy = desired("beeper", "sleep 30");
    let replacement = ChildServer::spawn(&healthy, &healthy, outgoing, Vec::new(), None).unwrap();
    if let Some(old) = supervisor
        .children
        .insert("beeper".to_string(), replacement)
    {
        old.shutdown().await;
    }
    supervisor
        .respawn_exited(t0 + Duration::from_secs(2 + 61))
        .await;
    assert!(
        !supervisor.respawns.contains_key("beeper"),
        "the count is forgotten"
    );
    supervisor.shutdown_children().await;
}

#[test]
fn the_delays_level_off_at_a_minute() {
    assert_eq!(respawn_delay(0), Duration::from_secs(2));
    assert_eq!(respawn_delay(1), Duration::from_secs(5));
    assert_eq!(respawn_delay(4), Duration::from_secs(60));
    assert_eq!(respawn_delay(40), Duration::from_secs(60));
}
