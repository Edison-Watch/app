//! Logging: stdout for the operator CLI, rolling file + stdout for the daemon.

use std::path::Path;

use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::{EnvFilter, fmt};

fn filter() -> EnvFilter {
    EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"))
}

/// Stdout only (CLI). Filter via `RUST_LOG` (default `info`). Idempotent.
pub fn init_stdout() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter())
        .try_init();
}

/// Daily-rolling file under `log_dir` **plus** stdout (daemon mode). The
/// returned guard must be held for the process lifetime to flush file writes.
pub fn init_daemon(log_dir: &Path) -> Option<WorkerGuard> {
    std::fs::create_dir_all(log_dir).ok()?;
    let file = tracing_appender::rolling::daily(log_dir, "detectord.log");
    let (non_blocking, guard) = tracing_appender::non_blocking(file);
    let _ = tracing_subscriber::registry()
        .with(filter())
        .with(fmt::layer().with_writer(non_blocking).with_ansi(false))
        .with(fmt::layer().with_writer(std::io::stdout))
        .try_init();
    Some(guard)
}
