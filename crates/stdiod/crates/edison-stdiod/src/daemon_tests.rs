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
    let mut supervisor = Supervisor::new(
        OutgoingHandle::new(),
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
