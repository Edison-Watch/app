//! Drive the watcher via its channel API and print each event.
//!
//! Run with: `cargo run --example watch`.
//!
//! Demonstrates [`Watcher::spawn`], which is usually what you want when
//! integrating the watcher into a larger program - it runs on a background
//! thread, delivers events on an `mpsc::Receiver`, and stops cleanly when
//! the returned [`WatcherHandle`](mcp_detector_lib::WatcherHandle) is dropped.

use std::sync::Arc;

use mcp_detector_lib::{
    Agent, Result, Watcher,
    clients::{ClaudeCode, VsCode},
};

fn main() -> Result<()> {
    tracing_subscriber::fmt::init();

    let clients: Vec<Arc<dyn Agent>> = vec![
        Arc::new(VsCode::discover()?),
        Arc::new(ClaudeCode::discover()?),
    ];

    let (events, _handle) = Watcher::new(clients).spawn()?;

    // Block on the channel until it disconnects (e.g. on Ctrl-C). The
    // background worker keeps running because `_handle` is still alive; if
    // we dropped it here, the worker would shut down immediately.
    for ev in events {
        println!("{ev}");
    }

    Ok(())
}
