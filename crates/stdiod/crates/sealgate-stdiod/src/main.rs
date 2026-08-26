//! `sealgate-stdiod` - SealGate stdiod daemon.
//!
//! Bridges local stdio MCP server subprocesses to the SealGate backend
//! over a WebSocket tunnel. v1 MVP scope: connect, receive desired state,
//! spawn subprocesses, forward MCP frames. Reconnect / heartbeat / install
//! are deferred to v1.1 per the design in
//! `stdiod/ARCHITECTURE.md`.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use clap::{Parser, Subcommand};

mod auth;
mod child_diagnostics;
mod cli;
mod config;
mod daemon;
mod daemon_auth;
mod env_store;
mod http;
mod machine_id;
mod paths;
mod platform;
mod proc;
mod process_shutdown;
mod secure_file;
mod state;
mod supervisor;
mod tunnel;

/// The daemon's reported release version.
///
/// Stamped by `build.rs` from the desktop app's `packages/desktop/package.json`
/// (or the `SEALGATE_DAEMON_VERSION` override), falling back to the crate
/// version. Announced as `client_version` in the tunnel handshake and
/// device-authorization request, and shown on the dashboard's Devices page - so
/// it tracks the shipped release rather than the pinned `0.0.1` workspace version.
pub const DAEMON_VERSION: &str = env!("SEALGATE_DAEMON_VERSION");

/// SealGate stdiod daemon and CLI.
#[derive(Debug, Parser)]
#[command(version = DAEMON_VERSION, about, long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Run the daemon in the foreground. v1 MVP entry point.
    Run(daemon::RunArgs),
    /// Authorize this device in a browser and persist its client credential.
    Login(cli::login::LoginArgs),
    /// Revoke the current client credential and remove local account bindings.
    Logout(cli::logout::LogoutArgs),
    /// Register the OS supervisor unit (macOS LaunchAgent) so the daemon
    /// starts at login and is restarted on crash. Requires `login` first.
    Install(cli::install::InstallArgs),
    /// Stop and remove the OS supervisor unit. Pass `--purge` to also
    /// delete the persisted config and logs.
    Uninstall(cli::install::UninstallArgs),
    /// Restart the running daemon in place, without re-registering the
    /// supervisor unit or touching credentials.
    Restart(cli::install::RestartArgs),
    /// Print a one-shot summary of daemon health (supervisor unit
    /// status, connection state, and currently-running child servers).
    Status(cli::status::StatusArgs),
    /// Print the daemon log. Pass `--follow` to tail in real time.
    Logs(cli::logs::LogsArgs),
    /// Register, list, or remove stdio_tunnel servers for this device.
    #[command(subcommand)]
    Server(cli::server::ServerCommand),
}

/// Best-effort open of the daemon log file (create + append) for the hidden
/// Windows Scheduled Task, which has no stderr to capture. Falls back to stderr
/// when `None`.
#[cfg(target_os = "windows")]
fn open_daemon_log() -> Option<std::fs::File> {
    let path = paths::daemon_log_file().ok()?;
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .ok()
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();

    let make_filter = || {
        tracing_subscriber::EnvFilter::try_from_default_env()
            .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info,sealgate_stdiod=debug"))
    };

    // The `run` daemon on Windows runs under a hidden Scheduled Task with no
    // stderr capture (unlike the macOS plist's StandardErrorPath), so it must
    // write its own log file. Every other path logs to stderr so the Electron
    // app (which spawns login/install/uninstall/status) still sees output.
    #[cfg(target_os = "windows")]
    let daemon_log: Option<std::fs::File> = if matches!(cli.command, Command::Run(_)) {
        open_daemon_log()
    } else {
        None
    };
    #[cfg(not(target_os = "windows"))]
    let daemon_log: Option<std::fs::File> = None;

    match daemon_log {
        Some(file) => tracing_subscriber::fmt()
            .with_env_filter(make_filter())
            .with_ansi(false)
            .with_writer(move || file.try_clone().expect("clone daemon log handle"))
            .init(),
        None => tracing_subscriber::fmt()
            .with_env_filter(make_filter())
            .with_writer(std::io::stderr)
            .init(),
    }

    match cli.command {
        Command::Run(args) => daemon::run(args).await,
        Command::Login(args) => cli::login::run(args).await,
        Command::Logout(args) => cli::logout::run(args).await,
        Command::Install(args) => cli::install::install(args),
        Command::Uninstall(args) => cli::install::uninstall(args),
        Command::Restart(args) => cli::install::restart(args),
        Command::Status(args) => cli::status::run(args),
        Command::Logs(args) => cli::logs::run(args),
        Command::Server(args) => cli::server::run(cli::server::ServerArgs { command: args }).await,
    }
}
