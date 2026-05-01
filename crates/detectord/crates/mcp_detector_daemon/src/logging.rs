//! Daemon logging: rolling daily file in `~/Library/Logs/Edison Watch/` plus
//! stdout when stdout is a TTY (i.e. when the daemon was launched from a
//! terminal, not by launchd).

use std::path::Path;

use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::{EnvFilter, fmt};

/// Returned guard must be kept alive for the lifetime of the program;
/// dropping it flushes pending file writes.
pub fn init(log_dir: &Path) -> std::io::Result<WorkerGuard> {
    std::fs::create_dir_all(log_dir)?;

    let file_appender = tracing_appender::rolling::Builder::new()
        .rotation(tracing_appender::rolling::Rotation::DAILY)
        .filename_prefix("daemon")
        .filename_suffix("log")
        .max_log_files(14)
        .build(log_dir)
        .map_err(|e| std::io::Error::other(e.to_string()))?;
    let (non_blocking_file, guard) = tracing_appender::non_blocking(file_appender);

    let env_filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));

    let file_layer = fmt::layer()
        .with_writer(non_blocking_file)
        .with_ansi(false);

    let stdout_layer = fmt::layer()
        .with_writer(std::io::stdout)
        .with_ansi(is_stdout_tty());

    tracing_subscriber::registry()
        .with(env_filter)
        .with(file_layer)
        .with(stdout_layer)
        .init();

    Ok(guard)
}

#[cfg(unix)]
fn is_stdout_tty() -> bool {
    // SAFETY: isatty just inspects an fd, no preconditions.
    unsafe { libc_isatty(1) != 0 }
}

#[cfg(not(unix))]
fn is_stdout_tty() -> bool {
    false
}

#[cfg(unix)]
unsafe extern "C" {
    #[link_name = "isatty"]
    fn libc_isatty(fd: i32) -> i32;
}
