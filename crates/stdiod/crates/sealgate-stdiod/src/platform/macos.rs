//! macOS LaunchAgent integration.
//!
//! Writes a plist to `~/Library/LaunchAgents/com.sealgate.stdiod.plist` and
//! loads it via the modern `launchctl bootstrap gui/$UID …` flow (not the
//! deprecated `launchctl load`). All operations are per-user - no `sudo`,
//! no system-level LaunchDaemon - so the daemon runs as the logged-in user
//! and has access to the user's keychain and HOME.
//!
//! The bundled plist sets:
//!
//! - `RunAtLoad=true`     - start the daemon now and on every login.
//! - `KeepAlive=true`     - launchd restarts the binary on crash.
//! - `StandardOutPath` / `StandardErrorPath` route stdout+stderr into
//!   `~/Library/Logs/sealgate-stdiod/daemon.log` so `sealgate-stdiod logs`
//!   has something to tail.
//!
//! Bootstrapping is idempotent: install always boots-out the existing unit
//! (if any) before bootstrapping the fresh one, so re-running after a
//! credential rotation or a binary path change reliably picks up changes.

use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{anyhow, Context, Result};
use tracing::{debug, info, warn};

use crate::paths;

const LABEL: &str = "com.sealgate.stdiod";
const PLIST_FILENAME: &str = "com.sealgate.stdiod.plist";

/// `~/Library/LaunchAgents/com.sealgate.stdiod.plist`.
fn plist_path() -> Result<PathBuf> {
    let home = dirs::home_dir().ok_or_else(|| anyhow!("HOME not set"))?;
    let dir = home.join("Library/LaunchAgents");
    std::fs::create_dir_all(&dir)?;
    Ok(dir.join(PLIST_FILENAME))
}

/// `gui/<uid>` - the modern launchctl domain target for per-user agents.
fn user_domain() -> String {
    // SAFETY: getuid is always available on macOS via libc::getuid; but to
    // avoid pulling libc just for this we shell out to `id -u`. The
    // overhead (one fork) only happens at install/uninstall/status time,
    // never on the hot path.
    let out = Command::new("id").arg("-u").output();
    let uid = out
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "0".to_string());
    format!("gui/{uid}")
}

/// `gui/<uid>/com.sealgate.stdiod` - full service target for
/// `launchctl print` / `launchctl kickstart`.
fn service_target() -> String {
    format!("{}/{}", user_domain(), LABEL)
}

fn render_plist(binary: &Path, log_path: &Path) -> String {
    // Hand-rolled XML rather than pulling a plist crate. The schema is
    // documented at developer.apple.com/library/.../launchd.plist.5.html
    // and the fields we set are stable across macOS releases.
    //
    // ``EnvironmentVariables.PATH`` - launchd's per-user default PATH is
    // ``/usr/bin:/bin:/usr/sbin:/sbin``, which is fine for the daemon's
    // own runtime but breaks every child it spawns (railway CLI, uvx,
    // npx-wrapped MCP servers, etc.) because Homebrew lives at
    // ``/opt/homebrew/bin`` and many node tools live at
    // ``/usr/local/bin``. Without this override every ``Command::new("railway")``
    // -style spawn fails with "command not found" and the backend's
    // ``import_server`` hangs on the missing child until it 60s-times out.
    // Order matches Homebrew's own LaunchAgents - Homebrew dirs first so
    // user-installed tools shadow system equivalents (e.g. brew's python3
    // over the macOS-provided one).
    let bin = binary.display();
    let log = log_path.display();
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>{LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>{bin}</string>
    <string>run</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/local/sbin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StandardOutPath</key>
  <string>{log}</string>
  <key>StandardErrorPath</key>
  <string>{log}</string>
</dict>
</plist>
"#,
    )
}

fn write_plist(path: &Path, body: &str) -> Result<()> {
    let tmp = path.with_extension("plist.tmp");
    std::fs::write(&tmp, body).with_context(|| format!("writing {}", tmp.display()))?;
    std::fs::rename(&tmp, path).with_context(|| format!("renaming -> {}", path.display()))?;
    Ok(())
}

fn launchctl(args: &[&str]) -> Result<std::process::Output> {
    debug!(?args, "launchctl");
    let out = Command::new("launchctl")
        .args(args)
        .output()
        .context("failed to invoke launchctl")?;
    Ok(out)
}

/// `bootout` the current unit if loaded. Ignores "not loaded" / "not
/// found" so the call is safe pre-install.
///
/// Returns `true` when a unit was actually torn down, so the caller knows it
/// has to wait for launchd to finish before bootstrapping again.
fn bootout_quiet() -> Result<bool> {
    let out = launchctl(&["bootout", &service_target()])?;
    if out.status.success() {
        return Ok(true);
    }
    // Common case: nothing is loaded yet. launchctl returns 113 /
    // "Could not find specified service". Don't surface that as an
    // error.
    let stderr = String::from_utf8_lossy(&out.stderr);
    let benign = stderr.contains("Could not find specified service")
        || stderr.contains("No such process")
        || out.status.code() == Some(113);
    if !benign {
        warn!(stderr = %stderr, "launchctl bootout reported an error; continuing");
    }
    Ok(!benign)
}

/// Wait until `launchctl print` stops reporting the service.
///
/// `launchctl bootout` returns as soon as launchd has ACCEPTED the request, not
/// when the unit is gone. Bootstrapping into that window fails with EIO
/// ("Input/output error", `Bootstrap failed: 5`) because the label is still
/// registered in the domain. Polling for the service to disappear closes the
/// window without a blind sleep on the common path, where the unit is already
/// gone on the first check.
fn wait_for_bootout(timeout: std::time::Duration) {
    let start = std::time::Instant::now();
    let target = service_target();
    while start.elapsed() < timeout {
        match launchctl(&["print", &target]) {
            // Non-zero means launchd no longer knows the label: teardown done.
            Ok(out) if !out.status.success() => {
                debug!(
                    waited_ms = start.elapsed().as_millis() as u64,
                    "bootout settled"
                );
                return;
            }
            // Still present, or launchctl could not be run at all. In the
            // latter case bootstrap will produce the better error; just stop
            // spinning on it.
            Ok(_) => {}
            Err(e) => {
                debug!(error = %e, "launchctl print failed while waiting for bootout");
                return;
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    warn!(
        timeout_ms = timeout.as_millis() as u64,
        "service still registered after bootout; bootstrapping anyway"
    );
}

/// A human-readable reason for a failed `launchctl` call, guaranteed non-empty.
///
/// Empty-string reasons are what let a failure masquerade as a success (see the
/// bootstrap loop) and they also produce useless errors like
/// "launchctl bootstrap failed: ". launchctl normally puts its diagnostic on
/// stderr, but fall through to stdout and finally to the exit status so there is
/// always something to report.
fn launchctl_failure_detail(out: &std::process::Output) -> String {
    let stderr = String::from_utf8_lossy(&out.stderr).trim().to_owned();
    if !stderr.is_empty() {
        return stderr;
    }
    let stdout = String::from_utf8_lossy(&out.stdout).trim().to_owned();
    if !stdout.is_empty() {
        return stdout;
    }
    match out.status.code() {
        Some(code) => format!("exit status {code} with no output"),
        None => "terminated by a signal".to_string(),
    }
}

/// True when a failed `bootstrap` looks like the transient post-bootout race
/// rather than a real misconfiguration.
///
/// launchd surfaces it as EIO - `Bootstrap failed: 5: Input/output error` -
/// and it clears on its own within a few hundred milliseconds. EBUSY shows up
/// the same way when the domain is mid-transition.
fn is_transient_bootstrap_error(stderr: &str, code: Option<i32>) -> bool {
    code == Some(5)
        || stderr.contains("Input/output error")
        || stderr.contains("Bootstrap failed: 5")
        || stderr.contains("Resource busy")
        || stderr.contains("Operation already in progress")
}

/// Write the plist + `launchctl bootstrap` it. Idempotent.
pub fn install() -> Result<()> {
    // Refuse to install if there are no credentials on disk - the daemon
    // would just spin in a reconnect loop. The user sees this error
    // immediately rather than discovering it in the logs later.
    let cfg = crate::config::PersistedConfig::load()?;
    cfg.ensure_installable()?;

    let binary = std::env::current_exe().context("could not resolve current exe path")?;
    let log = paths::daemon_log_file()?;
    let plist = plist_path()?;
    let body = render_plist(&binary, &log);
    write_plist(&plist, &body)?;
    info!(path = %plist.display(), "wrote LaunchAgent plist");

    // Always bootout before bootstrap so re-running install picks up a
    // moved binary, an updated plist, or a previously-broken unit.
    //
    // Then WAIT for launchd to finish that teardown. bootout returns when the
    // request is accepted, not when it is done, and bootstrapping into that
    // window fails with EIO - the "Bootstrap failed: 5: Input/output error"
    // seen on fresh installs. Retries below cover the residual race (and a
    // domain busy for other reasons); the wait is what makes them rare.
    if bootout_quiet()? {
        wait_for_bootout(std::time::Duration::from_secs(5));
    }

    const BOOTSTRAP_ATTEMPTS: u32 = 4;
    // Success is tracked by its own flag, NOT by whether `last_err` is empty.
    // Overloading the message as the sentinel meant a failure that produced no
    // message - `is_transient_bootstrap_error` deliberately accepts a bare exit
    // code 5, with no text at all - left `last_err` empty after every attempt
    // was exhausted, and install went on to print "Daemon is running" for a
    // LaunchAgent that had never loaded.
    let mut bootstrapped = false;
    let mut last_err = String::new();
    for attempt in 1..=BOOTSTRAP_ATTEMPTS {
        let out = launchctl(&[
            "bootstrap",
            &user_domain(),
            plist.to_string_lossy().as_ref(),
        ])?;
        if out.status.success() {
            bootstrapped = true;
            break;
        }
        let detail = launchctl_failure_detail(&out);
        if !is_transient_bootstrap_error(&detail, out.status.code()) {
            return Err(anyhow!("launchctl bootstrap failed: {detail}"));
        }
        last_err = detail;
        if attempt < BOOTSTRAP_ATTEMPTS {
            // 200ms, 400ms, 800ms - the race clears well inside that.
            let backoff = std::time::Duration::from_millis(200 * 2_u64.pow(attempt - 1));
            warn!(
                attempt,
                backoff_ms = backoff.as_millis() as u64,
                error = %last_err,
                "launchctl bootstrap hit a transient error; retrying"
            );
            std::thread::sleep(backoff);
        }
    }
    if !bootstrapped {
        return Err(anyhow!(
            "launchctl bootstrap failed after {BOOTSTRAP_ATTEMPTS} attempts: {last_err}\n\
             hint: this is usually a launchd domain that is still busy. If it persists, \
             check that you are in a GUI login session (bootstrapping gui/$UID from a bare \
             SSH session cannot work), then retry `sealgate-stdiod install`."
        ));
    }
    info!(label = LABEL, "LaunchAgent loaded");
    println!("Installed LaunchAgent: {}", plist.display());
    println!("Daemon is running. Tail logs with `sealgate-stdiod logs --follow`.");
    Ok(())
}

/// `launchctl bootout` + remove the plist. Idempotent.
pub fn uninstall() -> Result<()> {
    // Nothing here bootstraps afterwards, so the teardown does not have to have
    // completed before returning - the plist removal below is independent of it.
    let _ = bootout_quiet()?;
    let plist = plist_path()?;
    match std::fs::remove_file(&plist) {
        Ok(()) => info!(path = %plist.display(), "removed LaunchAgent plist"),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            info!("no LaunchAgent plist to remove");
        }
        Err(e) => return Err(e).with_context(|| format!("removing {}", plist.display())),
    }
    println!("Uninstalled LaunchAgent. Config + logs left in place (--purge to wipe).");
    Ok(())
}

/// True iff the plist exists on disk. We don't shell out to `launchctl
/// print` here because that's slow and the file's presence is the
/// canonical "did install run" signal.
#[allow(dead_code)] // wired up by the `status` subcommand (next commit)
pub fn is_installed() -> Result<bool> {
    Ok(plist_path()?.exists())
}

/// True iff launchd currently knows the label in the user's GUI domain.
///
/// Distinct from [`is_installed`], which only checks the filesystem. A plist
/// that was written but never successfully bootstrapped - the EIO failure this
/// module retries around - leaves those two disagreeing, and that gap is the
/// single most useful diagnostic there is: "the unit was never loaded" and "the
/// daemon started and died" look identical from disk alone but need completely
/// different fixes.
pub fn is_loaded() -> Result<bool> {
    Ok(launchctl(&["print", &service_target()])?.status.success())
}

/// Restart the daemon in place with `launchctl kickstart -k`.
///
/// `-k` kills the running instance first, so this is a true restart rather than
/// a no-op when the daemon is already up. Deliberately does NOT fall back to
/// `install` when the unit is not loaded: install re-renders the plist and
/// requires credentials on disk, which is more than "restart" should ever
/// silently do. The error names it instead.
pub fn restart() -> Result<()> {
    if !is_loaded()? {
        return Err(anyhow!(
            "the LaunchAgent is not loaded, so there is nothing to restart\n\
             hint: run `sealgate-stdiod install` to (re)load it"
        ));
    }
    let out = launchctl(&["kickstart", "-k", &service_target()])?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(anyhow!("launchctl kickstart failed: {}", stderr.trim()));
    }
    info!(label = LABEL, "LaunchAgent restarted");
    println!("Restarted {LABEL}. Tail logs with `sealgate-stdiod logs --follow`.");
    Ok(())
}

/// True iff `launchctl print` reports the service is loaded AND has a
/// running PID. Used by ``status`` to distinguish "installed but not
/// running" from "running healthily".
#[allow(dead_code)] // wired up by the `status` subcommand (next commit)
pub fn is_running() -> Result<bool> {
    let out = launchctl(&["print", &service_target()])?;
    if !out.status.success() {
        return Ok(false);
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    // launchctl print emits "pid = 12345" when the service is alive and
    // "state = running" alongside it. Either is sufficient; we check for
    // a non-zero pid since "state = running" briefly appears during
    // bootstrap before a pid is assigned.
    for line in stdout.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("pid =") {
            if rest.trim().parse::<u32>().is_ok() {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn render_plist_includes_label_and_paths() {
        let body = render_plist(
            Path::new("/usr/local/bin/sealgate-stdiod"),
            Path::new("/tmp/x.log"),
        );
        assert!(body.contains("<string>com.sealgate.stdiod</string>"));
        assert!(body.contains("<string>/usr/local/bin/sealgate-stdiod</string>"));
        assert!(body.contains("<string>run</string>"));
        assert!(body.contains("<string>/tmp/x.log</string>"));
        assert!(body.contains("<key>RunAtLoad</key>"));
        assert!(body.contains("<key>KeepAlive</key>"));
    }

    #[test]
    fn render_plist_extends_path_for_child_spawns() {
        let body = render_plist(Path::new("/bin/x"), Path::new("/tmp/x.log"));
        assert!(body.contains("<key>EnvironmentVariables</key>"));
        assert!(body.contains("/opt/homebrew/bin"));
        assert!(body.contains("/usr/local/bin"));
    }

    #[test]
    fn render_plist_is_valid_xml_prologue() {
        let body = render_plist(Path::new("/bin/x"), Path::new("/tmp/x.log"));
        assert!(body.starts_with("<?xml version=\"1.0\""));
        assert!(body.contains("<!DOCTYPE plist"));
        assert!(body.trim_end().ends_with("</plist>"));
    }

    // The EIO race is timing-dependent and cannot be provoked on demand, so the
    // classifier that decides whether to retry is pinned here instead. The
    // literal strings are what launchctl actually prints.
    #[test]
    fn transient_bootstrap_errors_are_retried() {
        // The exact failure seen on a fresh machine.
        assert!(is_transient_bootstrap_error(
            "Bootstrap failed: 5: Input/output error",
            Some(5)
        ));
        // Same condition reported only through the exit code.
        assert!(is_transient_bootstrap_error("", Some(5)));
        // Domain mid-transition.
        assert!(is_transient_bootstrap_error("Resource busy", Some(16)));
        assert!(is_transient_bootstrap_error(
            "Operation already in progress",
            Some(37)
        ));
    }

    /// Build an `Output` with the given streams and exit code, for the
    /// detail-extraction tests below.
    fn output(stdout: &str, stderr: &str, code: i32) -> std::process::Output {
        use std::os::unix::process::ExitStatusExt;
        std::process::Output {
            // Wait status encodes a normal exit in the high byte.
            status: std::process::ExitStatus::from_raw(code << 8),
            stdout: stdout.as_bytes().to_vec(),
            stderr: stderr.as_bytes().to_vec(),
        }
    }

    // The invariant the bootstrap loop's failure reporting rests on: a failed
    // launchctl call always yields SOMETHING to print. An empty reason
    // previously made an exhausted retry loop indistinguishable from success.
    #[test]
    fn failure_detail_is_never_empty() {
        assert_eq!(
            launchctl_failure_detail(&output("", "Bootstrap failed: 5: Input/output error", 5)),
            "Bootstrap failed: 5: Input/output error"
        );
        // Message on stdout instead of stderr.
        assert_eq!(
            launchctl_failure_detail(&output("Bootstrap failed: 5", "", 5)),
            "Bootstrap failed: 5"
        );
        // The case that caused the bug: a code with no output at all.
        let bare = launchctl_failure_detail(&output("", "", 5));
        assert!(!bare.is_empty());
        assert!(
            bare.contains('5'),
            "should name the exit code, got {bare:?}"
        );
        // Whitespace-only output is still empty for our purposes.
        assert!(!launchctl_failure_detail(&output("  ", "\n", 5)).is_empty());
    }

    #[test]
    fn permanent_bootstrap_errors_are_not_retried() {
        // A bad plist stays bad; retrying only delays the real error.
        assert!(!is_transient_bootstrap_error(
            "Bootstrap failed: 22: Invalid argument",
            Some(22)
        ));
        // Already loaded - the caller's bootout should have handled it, and
        // retrying cannot change the outcome.
        assert!(!is_transient_bootstrap_error(
            "Bootstrap failed: 17: File exists",
            Some(17)
        ));
        // No GUI session to bootstrap into (bare SSH): retrying never helps.
        assert!(!is_transient_bootstrap_error(
            "Could not find domain for",
            Some(112)
        ));
        assert!(!is_transient_bootstrap_error("", None));
    }
}
