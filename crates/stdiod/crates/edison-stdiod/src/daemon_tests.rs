use super::*;
use edison_tunnel_protocol::TunnelFrame;

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

/// No child, no entries: an empty map publishes an empty array rather
/// than a stale one.
#[test]
fn snapshot_of_no_children_is_empty() {
    let supervisor = supervisor_with("empty", HashMap::new());
    assert!(supervisor.snapshot_entries().is_empty());
}
