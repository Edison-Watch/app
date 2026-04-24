use std::sync::Arc;

use anyhow::Result;
use mcp_detector::{
    Client, Watcher,
    clients::{ClaudeCode, VsCode},
};
use tracing_subscriber::EnvFilter;

fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let clients: Vec<Arc<dyn Client>> = vec![
        Arc::new(VsCode::discover()?),
        Arc::new(ClaudeCode::discover()?),
    ];

    Watcher::new(clients).run(|ev| println!("{ev}"))?;
    Ok(())
}
