use super::*;
use serde_json::json;
use tokio::io::duplex;

use crate::child_diagnostics::mark_entry_crashed;
use crate::state::{ServerEntry, ServerStatus};

#[test]
fn diagnostics_are_bounded_and_redacted() {
    let diagnostics = ChildDiagnostics::default();
    diagnostics.record_stderr("Authorization: Bearer do-not-show");
    diagnostics.record_stderr("Connecting to https://example.test/mcp?key=do-not-show");
    diagnostics.record_stderr("postgres://user:password@example.test/database");
    diagnostics.record_stderr("AWS_ACCESS_KEY_ID=do-not-show");
    diagnostics.record_stderr("eyJhbGciOiJIUzI1NiJ9.payload.signature");
    let redacted = diagnostics.terminal_error("server", None);
    assert!(!redacted.message.contains("do-not-show"));
    assert!(redacted.message.contains("[redacted"));

    let diagnostics = ChildDiagnostics::new(["violet-horse-battery".into()]);
    diagnostics.record_stderr("upstream rejected violet-horse-battery");
    let redacted = diagnostics.terminal_error("server", None);
    assert!(!redacted.message.contains("violet-horse-battery"));
    assert!(redacted.message.contains("upstream rejected [redacted]"));

    let diagnostics = ChildDiagnostics::default();
    for index in 0..25 {
        diagnostics.record_stderr(&format!("diagnostic line {index}"));
    }

    let error = diagnostics.terminal_error("server", None);
    assert!(!error.message.contains("diagnostic line 0"));
    assert!(error.message.contains("diagnostic line 24"));
}

#[test]
fn crashed_entry_is_addressed_by_name_and_pid() {
    let mut servers = vec![
        ServerEntry {
            name: "filesystem".into(),
            state: ServerStatus::Running,
            pid: Some(4242),
        },
        ServerEntry {
            name: "fetch".into(),
            state: ServerStatus::Running,
            pid: Some(99),
        },
    ];

    assert!(mark_entry_crashed(&mut servers, "filesystem", Some(4242)));
    assert!(matches!(servers[0].state, ServerStatus::Crashed));
    assert!(matches!(servers[1].state, ServerStatus::Running));

    // A late report from a dead child must not touch the replacement that
    // was respawned under the same name with a new PID.
    servers[0].state = ServerStatus::Running;
    servers[0].pid = Some(5353);
    assert!(!mark_entry_crashed(&mut servers, "filesystem", Some(4242)));
    assert!(matches!(servers[0].state, ServerStatus::Running));

    // Unknown server: nothing published yet, nothing to update.
    assert!(!mark_entry_crashed(&mut servers, "memory", Some(1)));
}

#[test]
fn terminal_error_is_emitted_only_once_per_process() {
    let diagnostics = ChildDiagnostics::default();
    assert!(diagnostics.take_terminal_error("server", None).is_some());
    assert!(diagnostics.take_terminal_error("server", None).is_none());
}

#[tokio::test]
async fn broken_stdin_replays_actionable_terminal_error() {
    let diagnostics = ChildDiagnostics::default();
    diagnostics.record_stderr("Connection failed: ECONNREFUSED localhost:23373");
    let outgoing = OutgoingHandle::new();
    let (wire_tx, mut wire_rx) = mpsc::channel(1);
    outgoing.set(wire_tx);
    let (frame_tx, frame_rx) = mpsc::channel(1);
    let (stdin, reader) = duplex(64);
    drop(reader);
    frame_tx.send(json!({"jsonrpc": "2.0"})).await.unwrap();
    drop(frame_tx);

    stdin_pump(
        "server".into(),
        stdin,
        frame_rx,
        outgoing,
        diagnostics.clone(),
        None,
    )
    .await;

    let frame = wire_rx.recv().await.unwrap();
    let TunnelFrame::TunnelError(error) = frame else {
        panic!("expected terminal tunnel error");
    };
    assert_eq!(error.code, "server_offline");
    assert!(error.message.contains("ECONNREFUSED localhost:23373"));
    assert!(
        diagnostics.exited.load(Ordering::Acquire),
        "a child that cannot be written to is terminal for MCP"
    );
    assert!(
        !diagnostics.has_observed_exit(),
        "a failed write is not an exit observation, so nothing may be published as crashed"
    );
}

/// `shutdown` must not return until the stdout pump has finished reporting
/// the child's death: the terminal `server_offline` is read here with a
/// non-blocking `try_recv`, so it can only pass if the frame was queued
/// before `shutdown` returned. That is what lets a caller respawn the same
/// `server_id` without racing its `server_spawn_result` ahead of this frame
/// (PROTOCOL.md T-74).
#[cfg(unix)]
#[tokio::test]
async fn shutdown_returns_only_after_the_terminal_report_is_queued() {
    let desired = DesiredServer {
        server_id: "server".into(),
        name: "server".into(),
        command: "/bin/sh".into(),
        // Silent and long-lived: nothing reaches the wire until the kill
        // closes stdout, so anything received afterwards is the pump's
        // terminal report.
        args: vec!["-c".into(), "sleep 30".into()],
        env: Default::default(),
        working_dir: None,
        enabled: true,
    };
    let outgoing = OutgoingHandle::new();
    let (wire_tx, mut wire_rx) = mpsc::channel(4);
    outgoing.set(wire_tx);
    let child = ChildServer::spawn(&desired, &desired, outgoing, Vec::new(), None).unwrap();
    assert!(
        wire_rx.try_recv().is_err(),
        "a live child should not have reported anything yet"
    );

    child.shutdown().await;

    let frame = wire_rx
        .try_recv()
        .expect("terminal report should be queued before shutdown returns");
    let TunnelFrame::TunnelError(error) = frame else {
        panic!("expected terminal tunnel error");
    };
    assert_eq!(error.code, "server_offline");
    assert_eq!(error.server_id.as_deref(), Some("server"));
    assert!(
        wire_rx.try_recv().is_err(),
        "the terminal report is one-shot per child"
    );
}

#[cfg(unix)]
#[tokio::test]
async fn exited_process_reports_final_stderr_once() {
    let desired = DesiredServer {
        server_id: "server".into(),
        name: "server".into(),
        command: "/bin/sh".into(),
        args: vec![
            "-c".into(),
            "echo 'connect failed: ECONNREFUSED' >&2; exit 7".into(),
        ],
        env: Default::default(),
        working_dir: None,
        enabled: true,
    };
    let outgoing = OutgoingHandle::new();
    let (wire_tx, mut wire_rx) = mpsc::channel(4);
    outgoing.set(wire_tx);
    let child = ChildServer::spawn(&desired, &desired, outgoing, Vec::new(), None).unwrap();

    let frame = tokio::time::timeout(Duration::from_secs(1), wire_rx.recv())
        .await
        .unwrap()
        .unwrap();
    let TunnelFrame::TunnelError(error) = frame else {
        panic!("expected terminal tunnel error");
    };
    assert!(error.message.contains("connect failed: ECONNREFUSED"));
    assert!(
        error.message.contains("exited with code 7"),
        "terminal diagnostic should carry the child's exit code: {}",
        error.message
    );
    assert!(
        tokio::time::timeout(Duration::from_millis(100), wire_rx.recv())
            .await
            .is_err()
    );

    child.shutdown().await;
}
