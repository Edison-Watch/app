//! Subprocess management for stdio MCP servers.
//!
//! Each [`ChildServer`] owns a child process plus two pump tasks:
//! - **outbound** pump: receives [`McpFrame`]s addressed to this server and
//!   writes the JSON-RPC body (with a trailing newline) to the child's
//!   stdin.
//! - **inbound** pump: reads newline-delimited JSON-RPC frames from the
//!   child's stdout and sends them as [`TunnelFrame::McpFrame`] over the
//!   tunnel.
//!
//! When the child exits or the inbound pump errors, the inbound pump emits a
//! `tunnel_error { code: "server_offline" }` so the backend's transport
//! fails in-flight requests cleanly - this is the load-bearing pattern
//! surfaced by the v0 spike (see `stdiod/ARCHITECTURE.md`).

#[cfg(unix)]
use std::os::unix::process::CommandExt;
use std::process::{ExitStatus, Stdio};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use edison_tunnel_protocol::{DesiredServer, McpFrame, TunnelError, TunnelFrame};
use tokio::io::{AsyncBufReadExt, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, Mutex as AsyncMutex};
use tokio::task::JoinHandle;
use tracing::{debug, info, warn};

use crate::child_diagnostics::ChildDiagnostics;
use crate::state::StateWriter;
use crate::tunnel::OutgoingHandle;

/// How long [`ChildServer::shutdown`] waits for the stdout pump to finish its
/// terminal report before falling back to aborting it. See the comment at the
/// join site for why this is a join rather than an abort.
const PUMP_JOIN_TIMEOUT: Duration = Duration::from_secs(2);

/// Build the base `Command` for a child MCP server.
///
/// On Unix this is just `Command::new(program).args(args)` - the inherited PATH
/// (set wide by the macOS LaunchAgent plist) resolves `npx`/`uvx`. On Windows we
/// do two extra things: (1) append the bundled runtimes dir to PATH so child
/// servers find `npx`/`uvx` even when Node/uv aren't installed (system copies
/// still win - bundled is a fallback), and (2) resolve the program against
/// PATHEXT and run `.cmd`/`.bat` shims (like `npx.cmd`) through `cmd /c`, because
/// CreateProcess can't launch them directly and `Command::new` doesn't apply
/// PATHEXT.
fn build_child_command(program: &str, args: &[String]) -> Command {
    #[cfg(target_os = "linux")]
    {
        // Resolve against the augmented PATH (interactive login-shell PATH ∪ the
        // daemon PATH) so version-manager node/npx (nvm/fnm/volta) is found, and
        // set it on the child so a resolved `npx` can in turn find `node`. Linux
        // only: the systemd `--user` unit's PATH omits shell-rc additions.
        let path = linux::augmented_path();
        let mut cmd = match linux::resolve_program(program, &path) {
            Some(abs) => Command::new(abs),
            None => Command::new(program),
        };
        cmd.args(args);
        cmd.env("PATH", &path);
        cmd
    }
    #[cfg(all(unix, not(target_os = "linux")))]
    {
        // macOS / other Unix: inherit the daemon PATH as-is (the macOS
        // LaunchAgent plist already sets it wide enough for npx/uvx).
        let mut cmd = Command::new(program);
        cmd.args(args);
        cmd
    }
    #[cfg(windows)]
    {
        let path = win::augmented_path();
        let resolved = win::resolve_program(program, &path);
        tracing::info!(
            program,
            resolved = ?resolved,
            runtime_dirs = ?win::bundled_runtime_dirs(),
            "windows child command resolution"
        );
        let mut cmd = match resolved {
            // `.cmd`/`.bat` must run through cmd.exe. Use `/d /s /c "<line>"`
            // and raw_arg so cmd strips only the outer quotes and runs the rest
            // verbatim - the standard way to invoke a batch file with args that
            // may contain spaces (e.g. the fs server's directory path), which
            // plain `cmd /c "path" "arg"` mis-parses.
            Some(p) if win::is_batch(&p) => {
                let mut c = Command::new("cmd");
                c.raw_arg("/d")
                    .raw_arg("/s")
                    .raw_arg("/c")
                    .raw_arg(format!("\"{}\"", win::build_cmd_line(&p, args)));
                c
            }
            Some(p) => {
                let mut c = Command::new(&p);
                c.args(args);
                c
            }
            None => {
                tracing::warn!(
                    program,
                    "child program not found on system PATH or bundled runtimes"
                );
                let mut c = Command::new(program);
                c.args(args);
                c
            }
        };
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd.env("PATH", path);
        cmd
    }
}

/// One-time child-spawn environment setup, run once at daemon startup.
///
/// On Linux, resolves the user's *interactive login-shell* PATH so child MCP
/// servers can find node/npx/uvx installed via a version manager (nvm/fnm/volta/
/// asdf) - whose PATH additions live in shell rc files that the systemd `--user`
/// service never sources. No-op on macOS (the LaunchAgent plist already sets a
/// wide PATH) and Windows (bundled-runtimes PATH augmentation in `win`).
pub(crate) async fn init_child_env() {
    #[cfg(target_os = "linux")]
    linux::init_augmented_path().await;
}

#[cfg(target_os = "linux")]
mod linux {
    use std::collections::HashSet;
    use std::ffi::{OsStr, OsString};
    use std::path::{Path, PathBuf};
    use std::sync::OnceLock;
    use std::time::Duration;

    // Login-shell PATH ∪ daemon PATH, resolved once by init_augmented_path().
    static AUGMENTED_PATH: OnceLock<OsString> = OnceLock::new();

    /// Resolve + cache the augmented PATH. Idempotent; best-effort (on failure
    /// or timeout the cache stays empty and augmented_path() uses the daemon PATH).
    pub async fn init_augmented_path() {
        if AUGMENTED_PATH.get().is_some() {
            return;
        }
        let merged = merge_paths(login_shell_path().await, std::env::var_os("PATH"));
        let _ = AUGMENTED_PATH.set(merged);
    }

    /// PATH to use for child spawns: the cached login-shell∪daemon PATH, or the
    /// daemon PATH if init hasn't run / the shell probe failed.
    pub fn augmented_path() -> OsString {
        AUGMENTED_PATH
            .get()
            .cloned()
            .unwrap_or_else(|| std::env::var_os("PATH").unwrap_or_default())
    }

    /// Capture `$PATH` as the user's interactive login shell sees it (so
    /// nvm/fnm/volta setup in rc files is applied). Markers isolate the value
    /// from any banner an rc file prints to stdout; stdin is null so an rc that
    /// reads input can't hang; the probe is bounded by a timeout.
    async fn login_shell_path() -> Option<OsString> {
        const START: &str = "__EW_PATH_START__";
        const END: &str = "__EW_PATH_END__";
        let shell = std::env::var_os("SHELL").unwrap_or_else(|| OsString::from("/bin/bash"));
        let mut cmd = tokio::process::Command::new(&shell);
        cmd.arg("-lic")
            .arg(format!("printf '{START}%s{END}' \"$PATH\""))
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true);
        let out = tokio::time::timeout(Duration::from_secs(5), cmd.output())
            .await
            .ok()? // timed out
            .ok()?; // spawn/exec failed
        let stdout = String::from_utf8_lossy(&out.stdout);
        let path = stdout.split_once(START)?.1.split_once(END)?.0;
        (!path.is_empty()).then(|| OsString::from(path))
    }

    /// Merge two PATH values: entries from `primary` first, then any from
    /// `secondary` not already present. Order-preserving, de-duplicated.
    fn merge_paths(primary: Option<OsString>, secondary: Option<OsString>) -> OsString {
        let mut seen: HashSet<PathBuf> = HashSet::new();
        let mut dirs: Vec<PathBuf> = Vec::new();
        for src in [primary, secondary].into_iter().flatten() {
            for dir in std::env::split_paths(&src) {
                if seen.insert(dir.clone()) {
                    dirs.push(dir);
                }
            }
        }
        std::env::join_paths(dirs).unwrap_or_default()
    }

    /// Resolve `program` to an absolute path against `path`. A name that already
    /// contains '/' is returned as-is; a bare name is searched on each PATH dir.
    /// None when not found (the caller keeps the bare name, so spawn still errors
    /// with a clear "not found" rather than silently doing nothing).
    pub fn resolve_program(program: &str, path: &OsStr) -> Option<PathBuf> {
        if program.contains('/') {
            return Some(PathBuf::from(program));
        }
        std::env::split_paths(path)
            .map(|dir| dir.join(program))
            .find(|cand| is_executable(cand))
    }

    fn is_executable(p: &Path) -> bool {
        use std::os::unix::fs::PermissionsExt;
        std::fs::metadata(p).is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
    }
}

#[cfg(windows)]
mod win {
    use std::ffi::{OsStr, OsString};
    use std::path::{Path, PathBuf};

    /// Bundled runtimes live next to the daemon exe (`resources/bin/edison-stdiod.exe`
    /// -> `resources/runtimes/{node,uv}`). Also accept `<exe_dir>/runtimes/*` for
    /// standalone testing. Returns the dirs that actually exist.
    pub fn bundled_runtime_dirs() -> Vec<PathBuf> {
        let mut dirs = Vec::new();
        if let Ok(exe) = std::env::current_exe() {
            // Build candidate bases WITHOUT a ".." component (keeps the paths
            // clean for PATH/cmd): <exe_dir>/runtimes (standalone) and
            // <exe_dir>/../runtimes == resources/runtimes (bundled).
            let mut bases: Vec<PathBuf> = Vec::new();
            if let Some(bin) = exe.parent() {
                bases.push(bin.join("runtimes"));
                if let Some(res) = bin.parent() {
                    bases.push(res.join("runtimes"));
                }
            }
            for base in bases {
                for sub in ["node", "uv"] {
                    let d = base.join(sub);
                    if d.is_dir() {
                        dirs.push(d);
                    }
                }
            }
        }
        dirs
    }

    /// Inherited PATH with the bundled runtimes dirs appended (system wins).
    ///
    /// Appends to the raw PATH string rather than split_paths/join_paths, which
    /// silently returns empty if any existing PATH entry is unjoinable (e.g.
    /// contains a quote) - that would wipe the whole PATH and break resolution.
    pub fn augmented_path() -> OsString {
        let mut path = std::env::var_os("PATH").unwrap_or_default();
        for dir in bundled_runtime_dirs() {
            if !path.is_empty() {
                path.push(";");
            }
            path.push(dir.as_os_str());
        }
        path
    }

    fn pathext() -> Vec<String> {
        std::env::var("PATHEXT")
            .unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_string())
            .split(';')
            .filter(|s| !s.is_empty())
            .map(|s| s.to_ascii_lowercase())
            .collect()
    }

    /// Find `program` on `path`, applying PATHEXT for extensionless names.
    pub fn resolve_program(program: &str, path: &OsStr) -> Option<PathBuf> {
        let p = Path::new(program);
        if p.is_absolute() && p.is_file() {
            return Some(p.to_path_buf());
        }
        let has_ext = p.extension().is_some();
        let exts = pathext();
        for dir in std::env::split_paths(path) {
            if has_ext {
                // Caller gave an explicit extension - use it as-is.
                let direct = dir.join(program);
                if direct.is_file() {
                    return Some(direct);
                }
            } else {
                // No extension: only PATHEXT variants are runnable on Windows.
                // Do NOT match a bare extensionless file - Node ships an `npx`
                // Unix shell script next to `npx.cmd`, and CreateProcess can't
                // run the script. Prefer .cmd/.exe/etc. via PATHEXT.
                for ext in &exts {
                    let cand = dir.join(format!("{program}{ext}"));
                    if cand.is_file() {
                        return Some(cand);
                    }
                }
            }
        }
        None
    }

    pub fn is_batch(p: &Path) -> bool {
        matches!(
            p.extension()
                .and_then(|e| e.to_str())
                .map(|s| s.to_ascii_lowercase())
                .as_deref(),
            Some("cmd") | Some("bat")
        )
    }

    /// Quote a token for the cmd.exe command line (wrap if it has spaces or cmd
    /// metacharacters; cmd escapes an embedded `"` by doubling it).
    fn cmd_quote(s: &str) -> String {
        if !s.is_empty() && !s.chars().any(|c| " \t\"&|<>^()".contains(c)) {
            s.to_string()
        } else {
            format!("\"{}\"", s.replace('"', "\"\""))
        }
    }

    /// Build the inner command line for `cmd /s /c "<...>"`: the quoted program
    /// path followed by quoted args.
    pub fn build_cmd_line(prog: &Path, args: &[String]) -> String {
        let mut parts = vec![cmd_quote(&prog.display().to_string())];
        parts.extend(args.iter().map(|a| cmd_quote(a)));
        parts.join(" ")
    }
}

/// One running child stdio MCP server.
pub struct ChildServer {
    /// Logical id matching `desired.server_id`. Useful for logging/diagnostics
    /// even though the supervisor keys children by id externally.
    #[allow(dead_code)]
    pub server_id: String,
    /// The pre-enrichment ``DesiredServer`` as the backend sent it - args
    /// still contain ``{KEY}`` placeholders and env still holds raw values
    /// (no env_store overlay applied yet). Stored so respawns triggered by
    /// ``ServerSpecUpdate`` / ``ServerEnvUpdate`` can re-run ``enrich``
    /// against the freshly-updated env_store; re-enriching an already-
    /// substituted spec would be a no-op and the old values would stay
    /// baked in. ``apply_snapshot``/``apply_delta`` also compare this
    /// against the incoming raw to decide whether a kill+respawn is needed.
    pub desired_raw: DesiredServer,
    /// Shared with the pumps so terminal diagnostics can report the real
    /// exit status instead of a bare "process exited".
    child: SharedChild,
    /// PID captured at spawn for status reporting; the live `Child` sits
    /// behind an async lock.
    pub pid: Option<u32>,
    pub outbound_tx: mpsc::Sender<serde_json::Value>,
    pub stdin_pump: JoinHandle<()>,
    pub stdout_pump: JoinHandle<()>,
    stderr_pump: JoinHandle<()>,
    diagnostics: ChildDiagnostics,
}

impl ChildServer {
    /// Spawn the subprocess and start the two pumps.
    ///
    /// Takes both the ``raw`` (backend-authoritative, template placeholders
    /// intact) and ``enriched`` (env_store overlaid + ``templated_args``
    /// substituted) views. The subprocess is launched from ``enriched``;
    /// ``raw`` is stowed on the handle so later ``ServerSpecUpdate`` /
    /// ``ServerEnvUpdate`` can re-enrich from a fresh env_store read.
    ///
    /// `tunnel_outgoing` is the broker handle the inbound pump uses to send
    /// frames upstream to the backend. It survives WS reconnects - sends
    /// during a disconnect drop silently.
    ///
    /// `state` is the `state.json` writer the pumps use to publish this
    /// child's death as soon as they see it; pass `None` to skip publishing.
    pub fn spawn(
        raw: &DesiredServer,
        enriched: &DesiredServer,
        tunnel_outgoing: OutgoingHandle,
        sensitive_arg_values: Vec<String>,
        state: Option<StateWriter>,
    ) -> Result<Self> {
        info!(
            server_id = %enriched.server_id,
            command = %enriched.command,
            "spawning stdio MCP subprocess",
        );

        let mut cmd = build_child_command(&enriched.command, &enriched.args);
        #[cfg(unix)]
        cmd.as_std_mut().process_group(0);
        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        // Start with current env, then layer the configured env values.
        for (k, v) in &enriched.env {
            cmd.env(k, v);
        }
        if let Some(wd) = &enriched.working_dir {
            cmd.current_dir(wd);
        }

        let mut child = cmd
            .spawn()
            .with_context(|| format!("failed to spawn `{}`", enriched.command))?;

        let stdin = child.stdin.take().context("child stdin not captured")?;
        let stdout = child.stdout.take().context("child stdout not captured")?;
        let stderr = child.stderr.take().context("child stderr not captured")?;

        let pid = child.id();
        let child: SharedChild = Arc::new(AsyncMutex::new(child));

        let sensitive_values = enriched.env.values().cloned().chain(sensitive_arg_values);
        let diagnostics = ChildDiagnostics::new(sensitive_values).publishing_to(state, pid);
        let (outbound_tx, outbound_rx) = mpsc::channel::<serde_json::Value>(64);
        let stdin_pump = tokio::spawn(stdin_pump(
            enriched.server_id.clone(),
            stdin,
            outbound_rx,
            tunnel_outgoing.clone(),
            diagnostics.clone(),
            Some(child.clone()),
        ));
        let stdout_pump = tokio::spawn(stdout_pump(
            enriched.server_id.clone(),
            stdout,
            tunnel_outgoing,
            diagnostics.clone(),
            Some(child.clone()),
        ));

        // Drain stderr into our log so child diagnostics aren't lost.
        let server_id = enriched.server_id.clone();
        let stderr_diagnostics = diagnostics.clone();
        let stderr_pump = tokio::spawn(async move {
            let mut reader = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                if let Some(sanitized) = stderr_diagnostics.record_stderr(&line) {
                    debug!(server_id = %server_id, "[child stderr] {}", sanitized);
                }
            }
            stderr_diagnostics.mark_stderr_done();
        });

        Ok(Self {
            server_id: enriched.server_id.clone(),
            desired_raw: raw.clone(),
            child,
            pid,
            outbound_tx,
            stdin_pump,
            stdout_pump,
            stderr_pump,
            diagnostics,
        })
    }

    pub async fn take_terminal_error(&mut self) -> Option<TunnelError> {
        let status = self.child.lock().await.try_wait().ok().flatten();
        if status.is_some() {
            self.diagnostics.mark_observed_exit();
            // This reap may be the first (or only) observation of the exit,
            // so state.json has to hear about it from here too, not just from
            // the stdout pump's death path.
            self.diagnostics.publish_crashed(&self.server_id).await;
        }
        self.diagnostics
            .take_terminal_error(&self.server_id, status.as_ref())
    }

    /// Whether this child is finished as far as MCP is concerned: a pump
    /// reported it terminal, so the supervisor should replace it rather than
    /// keep routing frames at it. True for a broken-stdin child that is still
    /// running, which is what makes that case self-healing.
    pub fn has_exited(&self) -> bool {
        self.diagnostics.exited.load(Ordering::Acquire)
    }

    /// Whether the process was actually seen to exit. This, not
    /// [`has_exited`](Self::has_exited), is what may be reported as `crashed`.
    pub fn has_observed_exit(&self) -> bool {
        self.diagnostics.has_observed_exit()
    }

    /// Kill the child and wind the pumps down.
    ///
    /// Returns only once the stdout pump has run its terminal
    /// [`report_terminal`] to completion, so by the time this returns the
    /// child's `server_offline` is already queued on the outbound channel
    /// (or the one-shot latch says it will never be sent). Callers that
    /// respawn the same `server_id` therefore cannot enqueue the new child's
    /// `server_spawn_result` ahead of the old child's terminal error - see
    /// PROTOCOL.md T-74 and `daemon.rs::Supervisor::try_spawn`.
    pub async fn shutdown(self) {
        let Self {
            server_id,
            child,
            outbound_tx,
            stdin_pump,
            mut stdout_pump,
            stderr_pump,
            diagnostics,
            ..
        } = self;
        {
            let mut guard = child.lock().await;
            if let Some(pid) = guard.id() {
                #[cfg(unix)]
                {
                    let _ = Command::new("kill")
                        .args(["-KILL", "--", &format!("-{pid}")])
                        .status()
                        .await;
                }
                #[cfg(windows)]
                {
                    let _ = Command::new("taskkill")
                        .args(["/PID", &pid.to_string(), "/T", "/F"])
                        .status()
                        .await;
                }
            }
            let _ = guard.start_kill();
            let _ = guard.wait().await;
            // Released before joining the stdout pump: its terminal report
            // reads the exit status through this same lock and would
            // otherwise deadlock until the timeout below.
        }
        // Reaped just above, so the process is observably gone even if no pump
        // ever managed to read an exit status for it.
        diagnostics.mark_observed_exit();

        // Closing the frame channel ends the stdin pump at its `recv`. It is
        // aborted below regardless; this just makes the common case a clean
        // exit rather than a cancellation.
        drop(outbound_tx);

        // Join, don't abort: the stdout pump's last act is the terminal
        // `server_offline` report, and aborting it mid-flight is what made
        // the ordering against a subsequent respawn a coin flip. The dead
        // child's pipe is already at EOF, so the pump only has to finish
        // `report_terminal`: at most ~100ms waiting for stderr to drain,
        // ~100ms polling for the exit status, then one channel send. Two
        // seconds is an order of magnitude of headroom over that, and it
        // still bounds the pathological case where the send blocks because
        // the outbound channel is full and the WS writer is wedged.
        if tokio::time::timeout(PUMP_JOIN_TIMEOUT, &mut stdout_pump)
            .await
            .is_err()
        {
            warn!(
                server_id = %server_id,
                "stdout pump did not finish reporting within the shutdown budget; aborting it",
            );
            stdout_pump.abort();
        }
        stdin_pump.abort();
        stderr_pump.abort();
    }
}

type SharedChild = Arc<AsyncMutex<Child>>;

/// Best-effort exit status for terminal diagnostics. The child's pipes close
/// a moment before the process becomes reapable, so poll `try_wait` briefly
/// rather than reporting a statusless exit for a process that just died.
async fn child_exit_status(child: Option<&SharedChild>) -> Option<ExitStatus> {
    let child = child?;
    for _ in 0..10 {
        if let Ok(Some(status)) = child.lock().await.try_wait() {
            return Some(status);
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    None
}

async fn stdin_pump<W: AsyncWrite + Unpin>(
    server_id: String,
    mut stdin: W,
    mut rx: mpsc::Receiver<serde_json::Value>,
    tunnel_outgoing: OutgoingHandle,
    diagnostics: ChildDiagnostics,
    child: Option<SharedChild>,
) {
    while let Some(body) = rx.recv().await {
        let mut line = match serde_json::to_vec(&body) {
            Ok(v) => v,
            Err(e) => {
                warn!(server_id = %server_id, error = %e, "skipping unserialisable JSON-RPC frame");
                continue;
            }
        };
        line.push(b'\n');
        if let Err(e) = stdin.write_all(&line).await {
            warn!(server_id = %server_id, error = %e, "stdin write failed; ending pump");
            report_terminal(&server_id, &diagnostics, &tunnel_outgoing, child.as_ref()).await;
            return;
        }
        if let Err(e) = stdin.flush().await {
            warn!(server_id = %server_id, error = %e, "stdin flush failed; ending pump");
            report_terminal(&server_id, &diagnostics, &tunnel_outgoing, child.as_ref()).await;
            return;
        }
    }
}

/// Shared terminal-error reporting for both pumps: give stderr a moment to
/// drain, attach the child's exit status when it can be observed, emit the
/// one-shot `server_offline` tunnel error, and flip the child's `state.json`
/// entry to `crashed` if the process really is gone.
///
/// The two halves are deliberately independent. The tunnel error is terminal
/// for MCP as soon as any pump gives up on the child (PROTOCOL.md T-42/T-47):
/// a server whose stdin no longer accepts writes cannot serve a request, even
/// if its process is still around. The `crashed` entry in `state.json` is a
/// claim about the process, so it waits for an actual exit. A child that is
/// unreachable but alive therefore stays `running` next to its live PID until
/// the supervisor kills and respawns it, which it does on the next
/// reconciliation because `has_exited` is latched (PROTOCOL.md T-69).
async fn report_terminal(
    server_id: &str,
    diagnostics: &ChildDiagnostics,
    tunnel_outgoing: &OutgoingHandle,
    child: Option<&SharedChild>,
) {
    diagnostics.wait_for_stderr().await;
    let status = child_exit_status(child).await;
    if status.is_some() {
        diagnostics.mark_observed_exit();
    }
    // ``take_terminal_error`` latches ``exited`` on both branches, so by the
    // time the entry is published the supervisor's own snapshot agrees.
    let error = diagnostics.take_terminal_error(server_id, status.as_ref());
    diagnostics.publish_crashed(server_id).await;
    if let Some(error) = error {
        tunnel_outgoing.send(TunnelFrame::TunnelError(error)).await;
    }
}

async fn stdout_pump(
    server_id: String,
    stdout: tokio::process::ChildStdout,
    tunnel_outgoing: OutgoingHandle,
    diagnostics: ChildDiagnostics,
    child: Option<SharedChild>,
) {
    let mut reader = BufReader::new(stdout).lines();
    loop {
        match reader.next_line().await {
            Ok(Some(line)) => {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                match serde_json::from_str::<serde_json::Value>(trimmed) {
                    Ok(value) => {
                        let frame = TunnelFrame::McpFrame(McpFrame {
                            server_id: server_id.clone(),
                            frame: value,
                        });
                        // ``send`` is a no-op when disconnected; we keep
                        // reading so reconnect doesn't drop us.
                        tunnel_outgoing.send(frame).await;
                    }
                    Err(e) => {
                        warn!(
                            server_id = %server_id,
                            error = %e,
                            "child emitted non-JSON line; skipping",
                        );
                    }
                }
            }
            Ok(None) => break, // EOF - child exited.
            Err(e) => {
                warn!(server_id = %server_id, error = %e, "stdout read failed; ending pump");
                break;
            }
        }
    }

    // Load-bearing per v0 spike + ARCHITECTURE.md: tell the backend that
    // this server's subprocess is gone so any in-flight tool calls fail
    // cleanly instead of hanging.
    report_terminal(&server_id, &diagnostics, &tunnel_outgoing, child.as_ref()).await;
    info!(server_id = %server_id, "child stdout pump ended");
}

#[cfg(test)]
#[path = "proc_tests.rs"]
mod tests;
