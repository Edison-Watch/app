//! End-to-end smoke test for [`sealgate_detectord::Watcher::spawn`].
//!
//! Asserts that mutating a watched config file actually produces an `Added`
//! / `Removed` event on the receiver - the only path *not* covered by unit
//! tests, and the place where the filesystem-watcher integration is most
//! likely to break silently (per-OS event-delivery quirks, atomic-rename
//! handling, debouncer wiring, etc.).
//!
//! Gated on the `vscode` feature because we use `VsCode::from_paths` as a
//! convenient stand-in for a real client.

#![cfg(feature = "vscode")]

use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use sealgate_detectord::clients::VsCode;
use sealgate_detectord::{Agent, ChangeEvent, Watcher};
use tempfile::tempdir;

/// Wait up to `timeout` for an event matching `pred` to arrive on `events`.
fn wait_for(
    events: &std::sync::mpsc::Receiver<ChangeEvent>,
    timeout: Duration,
    pred: impl Fn(&ChangeEvent) -> bool,
) -> Option<ChangeEvent> {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        match events.recv_timeout(remaining.min(Duration::from_millis(200))) {
            Ok(ev) if pred(&ev) => return Some(ev),
            Ok(_) => continue,
            Err(_) => continue,
        }
    }
    None
}

#[test]
fn spawn_delivers_added_event_when_a_server_appears() {
    let dir = tempdir().unwrap();
    let global = dir.path().join("mcp.json");
    std::fs::write(&global, r#"{"servers":{}}"#).unwrap();

    let client = Arc::new(VsCode::from_paths(
        Some(global.clone()),
        None,
        Vec::<PathBuf>::new(),
    ));
    let (events, _handle) = Watcher::new(vec![client as Arc<dyn Agent>])
        .spawn()
        .unwrap();

    // Give the worker time to set up the debouncer + register the watch.
    std::thread::sleep(Duration::from_millis(300));

    std::fs::write(&global, r#"{"servers":{"new-thing":{"command":"echo"}}}"#).unwrap();

    let ev = wait_for(
        &events,
        Duration::from_secs(10),
        |e| matches!(e, ChangeEvent::Added(s) if s.name == "new-thing"),
    )
    .expect("Added event for new-thing within 10s");
    if let ChangeEvent::Added(s) = ev {
        assert_eq!(s.client, "vscode");
        assert_eq!(s.location.path, global);
    }
}

#[test]
fn spawn_delivers_removed_event_when_a_server_disappears() {
    let dir = tempdir().unwrap();
    let global = dir.path().join("mcp.json");
    std::fs::write(&global, r#"{"servers":{"existing":{"command":"echo"}}}"#).unwrap();

    let client = Arc::new(VsCode::from_paths(
        Some(global.clone()),
        None,
        Vec::<PathBuf>::new(),
    ));
    let (events, _handle) = Watcher::new(vec![client as Arc<dyn Agent>])
        .spawn()
        .unwrap();

    std::thread::sleep(Duration::from_millis(300));

    std::fs::write(&global, r#"{"servers":{}}"#).unwrap();

    wait_for(
        &events,
        Duration::from_secs(10),
        |e| matches!(e, ChangeEvent::Removed(s) if s.name == "existing"),
    )
    .expect("Removed event for existing within 10s");
}

#[test]
fn dropping_the_handle_stops_the_worker() {
    let dir = tempdir().unwrap();
    let global = dir.path().join("mcp.json");
    std::fs::write(&global, r#"{"servers":{}}"#).unwrap();

    let client = Arc::new(VsCode::from_paths(
        Some(global.clone()),
        None,
        Vec::<PathBuf>::new(),
    ));
    let (events, handle) = Watcher::new(vec![client as Arc<dyn Agent>])
        .spawn()
        .unwrap();

    std::thread::sleep(Duration::from_millis(300));
    drop(handle);

    // After the handle is dropped the worker stops, the channel's senders
    // are dropped, and recv() returns Err(Disconnected). It might take up
    // to STOP_CHECK_INTERVAL (250ms) plus join overhead.
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        match events.recv_timeout(Duration::from_millis(100)) {
            Ok(_) => continue,
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => return,
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
        }
    }
    panic!("worker did not stop within 5s after handle was dropped");
}
