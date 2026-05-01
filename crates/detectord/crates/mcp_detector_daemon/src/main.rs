//! Entrypoint for the Edison Watch quarantine daemon.

use std::path::PathBuf;
use std::process::ExitCode;

use clap::Parser;

mod app;
mod ipc;
mod logging;
mod permission;
mod protocol;

#[derive(Parser, Debug)]
#[command(version, about = "Edison Watch quarantine daemon", long_about = None)]
struct Args {
    /// Path to the Unix domain socket to listen on. Defaults to
    /// `~/Library/Application Support/Edison Watch/daemon.sock`.
    #[arg(long)]
    socket: Option<PathBuf>,
    /// Directory for the rolling log file. Defaults to
    /// `~/Library/Logs/Edison Watch`.
    #[arg(long)]
    log_dir: Option<PathBuf>,
    /// Override the FDA probe path (testing only).
    #[arg(long, hide = true)]
    fda_probe_path: Option<PathBuf>,
}

fn main() -> ExitCode {
    let args = Args::parse();

    let socket_path = args
        .socket
        .unwrap_or_else(default_socket_path);
    let log_dir = args.log_dir.unwrap_or_else(default_log_dir);

    let _log_guard = match logging::init(&log_dir) {
        Ok(g) => g,
        Err(e) => {
            eprintln!("failed to init logging: {e}");
            return ExitCode::FAILURE;
        }
    };

    tracing::info!(
        socket = %socket_path.display(),
        log_dir = %log_dir.display(),
        "mcp_detector_daemon starting"
    );

    let runtime = match tokio::runtime::Builder::new_multi_thread().enable_all().build() {
        Ok(r) => r,
        Err(e) => {
            tracing::error!("failed to build tokio runtime: {e}");
            return ExitCode::FAILURE;
        }
    };

    let probe_path = args.fda_probe_path.unwrap_or_else(permission::default_probe_path);

    let result = runtime.block_on(app::run(app::Config {
        socket_path,
        probe_path,
    }));
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            tracing::error!("daemon exited with error: {e}");
            ExitCode::FAILURE
        }
    }
}

fn default_socket_path() -> PathBuf {
    let base = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/tmp"));
    base.join("Library/Application Support/Edison Watch/daemon.sock")
}

fn default_log_dir() -> PathBuf {
    let base = dirs::home_dir().unwrap_or_else(|| PathBuf::from("/tmp"));
    base.join("Library/Logs/Edison Watch")
}
