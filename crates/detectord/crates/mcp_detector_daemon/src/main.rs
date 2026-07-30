//! Edison Watch quarantine daemon.
//!
//! Runs the MCP discovery + quarantine pipeline. In this build it runs as the
//! invoking user; the privileged system-agent version (design §4–§10) layers
//! root + getpeereid scoping + a per-user supervisor on top of the same engine.
//! Two interfaces: an operator CLI (below) and an IPC socket (`serve`) — both
//! go through the shared, per-user [`ops`] layer.

// Release Windows builds are GUI-subsystem so the supervisor (Scheduled Task)
// and one-shot CLI spawns don't flash a console window. Debug keeps the console
// so `run`/`daemon` still print to a terminal during dev.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Parser, Subcommand};

mod agents;
mod claude_cli;
mod enrollment;
mod hook_consumer;
mod ipc;
mod logging;
mod ops;
mod paths;
mod platform;
mod protocol;
mod quarantined;
mod recovery;
mod runner;
mod service;
mod status;
mod supervisor;

use enrollment::Enrollment;
use protocol::{Choice, ServerView, Status};

#[derive(Parser)]
#[command(version, about = "Edison Watch quarantine daemon")]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum ServiceCmd {
    /// Install + start the LaunchAgent (the client calls this, like stdiod).
    /// Report-only by default; `--enforce` actually quarantines (gated by policy).
    Install {
        #[arg(long)]
        enforce: bool,
    },
    /// Stop + remove the LaunchAgent. Leaves state + logs unless `--purge`.
    Uninstall {
        /// Also delete all daemon data: enrollment, seen-store, quarantine
        /// records, logs, and the socket (the whole data dir).
        #[arg(long)]
        purge: bool,
    },
    /// Whether the agent is installed / running, and the socket path.
    Status,
}

#[derive(Subcommand)]
enum SecretCmd {
    /// Verify a key against the backend; if valid, adopt it (install it).
    Verify { key: String },
    /// Destructively reset to a new key — deletes your encrypted personal
    /// values on the backend — then install it. Requires --confirm.
    Reset {
        key: String,
        #[arg(long)]
        confirm: bool,
    },
}

#[derive(Subcommand)]
enum Cmd {
    /// Enroll against the backend (validates the key, caches policy + known
    /// set) and install edison-watch into the selected agents.
    Enroll {
        /// API base URL, e.g. http://localhost:3001
        #[arg(long)]
        url: String,
        /// Bearer API key.
        #[arg(long)]
        key: String,
        /// MCP gateway base URL for the edison-watch entry, e.g.
        /// http://localhost:3000 (required to install into agents).
        #[arg(long)]
        mcp_url: Option<String>,
        /// Agents to install edison-watch into (comma-separated), e.g.
        /// `cursor,vscode,codex`. Omit to keep the previous selection.
        /// Quarantine still covers all agents.
        #[arg(long, value_delimiter = ',')]
        agents: Option<Vec<String>>,
        /// The user's edison secret key (composite `user:<base64>`) for the
        /// X-Edison-Secret-Key header. Omit to keep the previous value.
        #[arg(long)]
        secret: Option<String>,
    },
    /// Show enrollment + cached policy.
    Status {
        /// Fetch the policy from the backend first (updates the cache).
        #[arg(long)]
        refresh: bool,
    },
    /// Run the reconcile loop until Ctrl-C. Dry-run unless `--enforce`.
    Run {
        /// Actually quarantine (move servers to sidecars). Off by default.
        #[arg(long)]
        enforce: bool,
    },
    /// List discovered (live) servers and quarantined ones.
    List {
        /// Show every instance with its source path, without deduping.
        #[arg(long, short)]
        verbose: bool,
    },
    /// Restore a quarantined server by name/fingerprint (or `--all`).
    Restore {
        /// Server name or fingerprint (omit with --all).
        needle: Option<String>,
        /// Restore every quarantined server.
        #[arg(long)]
        all: bool,
    },
    /// Submit a discovered server to Edison Watch (register/request) and remove
    /// it from its local config.
    SendToEw {
        /// Server name to send.
        name: String,
        /// Disambiguate when the name exists under several agents.
        #[arg(long)]
        agent: Option<String>,
    },
    /// Reverse every quarantine found on disk (sidecars + ew-disabled dirs),
    /// independent of tracked state. Idempotent.
    Recover,
    /// Verify or reset the edison secret key.
    Secret {
        #[command(subcommand)]
        action: SecretCmd,
    },
    /// Remove the local enrollment.
    Unenroll,
    /// Manage the LaunchAgent (install/uninstall/status) — how the client
    /// installs and launches the daemon, mirroring stdiod.
    Service {
        #[command(subcommand)]
        action: ServiceCmd,
    },
    /// Serve just the IPC socket the UI connects to (peer-uid-scoped).
    Serve {
        /// Socket path (default: under the state dir).
        #[arg(long)]
        socket: Option<PathBuf>,
    },
    /// Run the full daemon: IPC socket + a reconcile worker per enrolled user,
    /// with rolling-file logging and a state.json heartbeat.
    Daemon {
        /// Actually quarantine (off by default).
        #[arg(long)]
        enforce: bool,
        /// Socket path (default: under the state dir).
        #[arg(long)]
        socket: Option<PathBuf>,
        /// Don't run the hook pending-file consumer (detect-only mode, so we
        /// don't fight a client's own hook monitor over ~/.edison-watch).
        #[arg(long)]
        no_hooks: bool,
    },
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    // Daemon mode logs to a rolling file (+ stdout); everything else stdout only.
    let _log_guard = if matches!(cli.cmd, Cmd::Daemon { .. }) {
        logging::init_daemon(&paths::base_dir().join("logs"))
    } else {
        logging::init_stdout();
        None
    };

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("build tokio runtime");

    match runtime.block_on(dispatch(cli.cmd)) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("error: {e:#}");
            ExitCode::FAILURE
        }
    }
}

async fn dispatch(cmd: Cmd) -> anyhow::Result<()> {
    match cmd {
        Cmd::Enroll {
            url,
            key,
            mcp_url,
            agents,
            secret,
        } => cmd_enroll(url, key, mcp_url, agents, secret).await,
        Cmd::Status { refresh } => cmd_status(refresh).await,
        Cmd::Run { enforce } => runner::run(enforce).await,
        Cmd::List { verbose } => cmd_list(verbose),
        Cmd::Restore { needle, all } => cmd_restore(needle, all),
        Cmd::SendToEw { name, agent } => cmd_send_to_ew(name, agent).await,
        Cmd::Recover => {
            let (servers, dirs) = recovery::recover();
            println!("Recovered {servers} server(s) and {dirs} plugin dir(s) from disk.");
            Ok(())
        }
        Cmd::Secret { action } => match action {
            SecretCmd::Verify { key } => cmd_verify_secret(key).await,
            SecretCmd::Reset { key, confirm } => cmd_reset_secret(key, confirm).await,
        },
        Cmd::Service { action } => match action {
            ServiceCmd::Install { enforce } => service::install(enforce),
            ServiceCmd::Uninstall { purge } => service::uninstall(purge),
            ServiceCmd::Status => {
                println!(
                    "installed: {}\nrunning:   {}\nsocket:    {}",
                    service::is_installed(),
                    service::is_running(),
                    ipc::default_socket_path().display()
                );
                Ok(())
            }
        },
        Cmd::Unenroll => cmd_unenroll(),
        Cmd::Serve { socket } => {
            let (events, _keep) = tokio::sync::broadcast::channel(256);
            let path = socket.unwrap_or_else(ipc::default_socket_path);
            ipc::serve(&path, events).await
        }
        Cmd::Daemon {
            enforce,
            socket,
            no_hooks,
        } => {
            let path = socket.unwrap_or_else(ipc::default_socket_path);
            supervisor::run(enforce, path, !no_hooks).await
        }
    }
}

/// The OS user the CLI operates on (this process's owner).
fn cli_user() -> String {
    paths::current_username()
}

async fn cmd_enroll(
    url: String,
    key: String,
    mcp_url: Option<String>,
    agents: Option<Vec<String>>,
    secret: Option<String>,
) -> anyhow::Result<()> {
    // CLI enroll always applies the install and arms enforcement (the
    // operator's explicit intent; no onboarding gate for the dev/admin path).
    print_status(
        &ops::enroll(
            &cli_user(),
            url,
            key,
            mcp_url,
            agents,
            secret,
            true,
            Some(true),
        )
        .await?,
    );
    Ok(())
}

async fn cmd_status(refresh: bool) -> anyhow::Result<()> {
    let u = cli_user();
    let s = if refresh {
        ops::refresh_policy(&u).await?
    } else {
        ops::status(&u)?
    };
    print_status(&s);
    Ok(())
}

fn print_status(s: &Status) {
    if !s.enrolled {
        println!("Not enrolled. Run `enroll --url <api> --key <key>`.");
        return;
    }
    println!(
        "Enrolled.\n  org:               {} ({})\n  user:              {} [{}] [{}]\n  policy.quarantine: {}\n  quarantined:       {}",
        s.org_name.as_deref().unwrap_or("-"),
        s.org_id.as_deref().unwrap_or("-"),
        s.email.as_deref().unwrap_or("-"),
        s.role.as_deref().unwrap_or("-"),
        if s.armed { "armed" } else { "disarmed" },
        s.quarantine,
        s.quarantined_count,
    );
}

fn cmd_list(verbose: bool) -> anyhow::Result<()> {
    let u = cli_user();
    if let Some(e) = Enrollment::load_for(&u)? {
        println!(
            "Enrolled: [{}] [{}]\n",
            e.role,
            if e.armed { "armed" } else { "disarmed" }
        );
    }
    let servers = ops::list_servers(&u)?;

    if verbose {
        print_list_verbose(&servers);
    } else {
        print_list_deduped(&servers);
    }

    println!(
        "\n  state: edison=our own entry (skipped) · known=already at backend (silent removal)"
    );
    println!("         new=would be quarantined · opaque=removed locally, can't send to EW");
    println!("         report=untouchable, no access to remove");

    match Enrollment::load_for(&u)? {
        None => println!("  (enroll to classify known vs new)"),
        Some(e) if !e.quarantine => {
            println!("  policy.quarantine=false → `run` is inert (reports only, no removal)")
        }
        _ => {}
    }

    let q = quarantined::QuarantinedState::load_for(&u)?;
    if !q.entries.is_empty() {
        println!("\nQuarantined ({}):", q.entries.len());
        for e in &q.entries {
            println!("  {:<22} {:<12} {}", e.name, e.agent, e.fingerprint);
        }
    }
    Ok(())
}

fn print_list_deduped(servers: &[ServerView]) {
    let mut order: Vec<(String, String, String)> = Vec::new();
    let mut info: HashMap<(String, String, String), (String, String, usize)> = HashMap::new();
    for s in servers {
        let id = s.fingerprint.clone().unwrap_or_else(|| "-".to_string());
        let key = (s.name.clone(), s.agent.clone(), id);
        match info.get_mut(&key) {
            Some(e) => e.2 += 1,
            None => {
                order.push(key.clone());
                info.insert(key, (s.kind.clone(), s.state.clone(), 1));
            }
        }
    }

    println!("Discovered across host apps ({} unique):\n", order.len());
    println!(
        "  {:<22} {:<12} {:<7} {:<7} FINGERPRINT",
        "NAME", "AGENT", "TYPE", "STATE"
    );
    for key in &order {
        let (kind, state, count) = &info[key];
        let (name, agent, id) = key;
        let name_disp = if *count > 1 {
            format!("{name} (x{count})")
        } else {
            name.clone()
        };
        println!("  {name_disp:<22} {agent:<12} {kind:<7} {state:<7} {id}");
    }
    println!("  (use --verbose to list every instance with its source path)");
}

fn print_list_verbose(servers: &[ServerView]) {
    let mut rows: Vec<&ServerView> = servers.iter().collect();
    rows.sort_by(|a, b| (&a.agent, &a.name, &a.path).cmp(&(&b.agent, &b.name, &b.path)));
    println!("Discovered across host apps ({} instances):\n", rows.len());
    println!(
        "  {:<18} {:<12} {:<7} {:<7} {:<18} PATH",
        "NAME", "AGENT", "TYPE", "STATE", "FINGERPRINT"
    );
    for s in rows {
        let id = s.fingerprint.as_deref().unwrap_or("-");
        println!(
            "  {:<18} {:<12} {:<7} {:<7} {id:<18} {}",
            s.name, s.agent, s.kind, s.state, s.path
        );
    }
}

async fn cmd_send_to_ew(name: String, agent: Option<String>) -> anyhow::Result<()> {
    ops::disposition(
        &cli_user(),
        &name,
        agent.as_deref(),
        Choice::SendToEw,
        None,
        None,
        None, // role decides register-vs-request from the CLI
    )
    .await?;
    println!("Sent {name} to Edison Watch and removed it from the local config.");
    Ok(())
}

async fn cmd_verify_secret(key: String) -> anyhow::Result<()> {
    let r = ops::verify_secret(&cli_user(), key).await?;
    if r.valid {
        let warn = if r.expired {
            " (WARNING: key has expired)"
        } else {
            ""
        };
        println!("Key is valid — adopted and installed into selected agents.{warn}");
    } else {
        println!("Key does NOT match the registered key. Nothing installed.");
    }
    Ok(())
}

async fn cmd_reset_secret(key: String, confirm: bool) -> anyhow::Result<()> {
    if !confirm {
        anyhow::bail!(
            "reset is destructive — it deletes your encrypted personal values on the backend. Re-run with --confirm."
        );
    }
    let r = ops::reset_secret(&cli_user(), key).await?;
    println!(
        "Reset complete: {} encrypted value(s) deleted. New key installed into selected agents.",
        r.deleted
    );
    Ok(())
}

fn cmd_unenroll() -> anyhow::Result<()> {
    match ops::unenroll(&cli_user())? {
        None => println!("Not enrolled."),
        Some(org) => println!("Unenrolled {org}."),
    }
    Ok(())
}

fn cmd_restore(needle: Option<String>, all: bool) -> anyhow::Result<()> {
    let needle = if all {
        None
    } else {
        Some(needle.ok_or_else(|| anyhow::anyhow!("provide a server name/fingerprint, or --all"))?)
    };
    let (restored, errors) = ops::restore_quarantined(&cli_user(), needle.as_deref())?;
    for e in &errors {
        eprintln!("failed to restore {e}");
    }
    println!("Restored {restored} quarantined server(s).");
    Ok(())
}
