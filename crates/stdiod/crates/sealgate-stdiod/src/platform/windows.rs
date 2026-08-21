//! Windows Scheduled Task integration.
//!
//! The Windows analog of the macOS LaunchAgent: a per-user **logon task** that
//! runs the daemon as the logged-in user, in their session, starting at logon
//! and restarting on failure. This is deliberately NOT a Windows Service - a
//! service runs in session 0 as SYSTEM, which would break the daemon's per-user
//! model (it spawns the user's MCP child servers with the user's PATH/env and
//! reads the user's credentials).
//!
//! We register via `schtasks /create /xml` with a Task Scheduler definition
//! because the `schtasks` command-line flags can't express the settings we need
//! (Hidden, restart-on-failure, unlimited run time). The task uses
//! `LogonType=InteractiveToken` so it runs with the user's live token - no
//! stored password, no admin.
//!
//! Idempotent: install deletes any existing task before recreating, mirroring
//! the macOS bootout-before-bootstrap flow.

use std::os::windows::process::CommandExt;
use std::path::Path;
use std::process::Command;
use std::time::{Duration, Instant};

use anyhow::{anyhow, Context, Result};
use tracing::{debug, info, warn};

/// Base name. The live task name appends the user's SID (see `task_name`).
const TASK_BASENAME: &str = "SealGate stdiod";

/// CREATE_NO_WINDOW: the daemon is GUI-subsystem, so spawning console programs
/// (schtasks/whoami) would otherwise flash a console window.
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Per-user Scheduled Task name: `<base> <SID>`. Namespacing by SID keeps two
/// accounts on one machine from clobbering each other's task (the name lives in
/// the machine-global root task folder, and `/create /f` overwrites). Falls back
/// to the bare base name if the SID can't be resolved.
fn task_name() -> String {
    match current_user_sid() {
        Some(sid) => format!("{TASK_BASENAME} {sid}"),
        None => TASK_BASENAME.to_string(),
    }
}

/// Current user's SID via `whoami /user /fo csv /nh` -> `"DOMAIN\user","S-1-5-..."`.
fn current_user_sid() -> Option<String> {
    let out = Command::new("whoami")
        .args(["/user", "/fo", "csv", "/nh"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    stdout
        .rsplit(',')
        .next()
        .map(|s| s.trim().trim_matches('"').to_string())
        .filter(|s| s.starts_with("S-"))
}

/// `DOMAIN\User` (or bare `User`) for the task principal + logon trigger.
fn current_user() -> String {
    let user = std::env::var("USERNAME").unwrap_or_default();
    let domain = std::env::var("USERDOMAIN").unwrap_or_default();
    if domain.is_empty() || user.is_empty() {
        user
    } else {
        format!("{domain}\\{user}")
    }
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// Task Scheduler 1.2 XML. Hidden + restart-on-failure + no time limit; runs as
/// the current user with their interactive token at every logon.
fn render_task_xml(binary: &Path, user: &str) -> String {
    let bin = xml_escape(&binary.display().to_string());
    let u = xml_escape(user);
    format!(
        r#"<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>SealGate local MCP tunnel daemon</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>{u}</UserId>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>{u}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>true</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>999</Count>
    </RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>{bin}</Command>
      <Arguments>run</Arguments>
    </Exec>
  </Actions>
</Task>
"#
    )
}

/// schtasks `/create /xml` wants the file as UTF-16LE with a BOM; UTF-8 is
/// rejected as malformed on many Windows builds.
fn write_task_xml(path: &Path, body: &str) -> Result<()> {
    let mut bytes: Vec<u8> = vec![0xFF, 0xFE]; // UTF-16LE BOM
    for unit in body.encode_utf16() {
        bytes.extend_from_slice(&unit.to_le_bytes());
    }
    std::fs::write(path, &bytes).with_context(|| format!("writing {}", path.display()))?;
    Ok(())
}

fn schtasks(args: &[&str]) -> Result<std::process::Output> {
    debug!(?args, "schtasks");
    Command::new("schtasks")
        .args(args)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .context("failed to invoke schtasks")
}

/// Write the task XML + register it via schtasks, then start it now.
/// Idempotent (deletes any existing task first).
pub fn install() -> Result<()> {
    // Refuse to install without credentials - the daemon would just spin in a
    // reconnect loop. Surface the error now, not later in the logs.
    let cfg = crate::config::PersistedConfig::load()?;
    cfg.ensure_installable()?;

    let binary = std::env::current_exe().context("could not resolve current exe path")?;
    let user = current_user();
    if user.is_empty() {
        return Err(anyhow!("could not resolve current user (USERNAME unset)"));
    }
    let task = task_name();
    let xml = render_task_xml(&binary, &user);
    let xml_path = std::env::temp_dir().join("sealgate-stdiod-task.xml");
    write_task_xml(&xml_path, &xml)?;
    info!(path = %xml_path.display(), "wrote scheduled task definition");

    // Idempotent: drop any existing task (stops it too) before recreating, so
    // re-running picks up a moved binary or a changed definition. Also drop a
    // legacy task registered under the old un-SID'd base name (pre-migration).
    let _ = schtasks(&["/delete", "/tn", &task, "/f"]);
    if task != TASK_BASENAME {
        let _ = schtasks(&["/delete", "/tn", TASK_BASENAME, "/f"]);
    }
    let out = schtasks(&[
        "/create",
        "/tn",
        &task,
        "/xml",
        xml_path.to_string_lossy().as_ref(),
        "/f",
    ])?;
    let _ = std::fs::remove_file(&xml_path);
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        let stdout = String::from_utf8_lossy(&out.stdout);
        return Err(anyhow!(
            "schtasks /create failed: {} {}",
            stderr.trim(),
            stdout.trim()
        ));
    }
    info!(task = %task, "scheduled task created");

    // Start now (the RunAtLoad equivalent). If it fails, the logon trigger
    // still starts it at next sign-in, so don't treat it as fatal.
    match schtasks(&["/run", "/tn", &task]) {
        Ok(o) if o.status.success() => {}
        Ok(o) => warn!(
            stderr = %String::from_utf8_lossy(&o.stderr),
            "schtasks /run failed; task will start at next logon"
        ),
        Err(e) => warn!(error = %e, "could not start task now; will start at next logon"),
    }

    println!("Installed scheduled task: {task}");
    println!("Daemon is running. Tail logs with `sealgate-stdiod logs --follow`.");
    Ok(())
}

/// Stop + remove the task. Idempotent.
pub fn uninstall() -> Result<()> {
    let task = task_name();
    let _ = schtasks(&["/end", "/tn", &task]); // stop a running instance
                                               // Also clean up a legacy base-named task from before SID namespacing.
    if task != TASK_BASENAME {
        let _ = schtasks(&["/end", "/tn", TASK_BASENAME]);
        let _ = schtasks(&["/delete", "/tn", TASK_BASENAME, "/f"]);
    }
    let out = schtasks(&["/delete", "/tn", &task, "/f"])?;
    if out.status.success() {
        info!(task = %task, "removed scheduled task");
    } else {
        let stderr = String::from_utf8_lossy(&out.stderr);
        // Benign: the task doesn't exist (already uninstalled).
        let benign = stderr.contains("does not exist")
            || stderr.contains("cannot find")
            || stderr.to_lowercase().contains("the system cannot find");
        if benign {
            info!("no scheduled task to remove");
        } else {
            warn!(stderr = %stderr, "schtasks /delete reported an error; continuing");
        }
    }
    println!("Uninstalled scheduled task. Config + logs left in place (--purge to wipe).");
    Ok(())
}

/// True iff the scheduled task exists.
#[allow(dead_code)] // consumed by the `status` subcommand
pub fn is_installed() -> Result<bool> {
    Ok(schtasks(&["/query", "/tn", &task_name()])?.status.success())
}

/// True iff the Task Scheduler knows the task.
///
/// On macOS and Linux this is a genuinely different question from
/// [`is_installed`], which reads the filesystem - see the macOS counterpart.
/// Here there is no on-disk unit to get out of step: `is_installed` already
/// asks the scheduler, so the two answers are the same by construction.
pub fn is_loaded() -> Result<bool> {
    is_installed()
}

/// How long to wait for the previous instance to exit before giving up.
const STOP_TIMEOUT: Duration = Duration::from_secs(15);
/// How long to wait for the new instance to report Running after `/run`.
const START_TIMEOUT: Duration = Duration::from_secs(10);
const POLL_INTERVAL: Duration = Duration::from_millis(250);

/// Poll [`is_running`] until it reports `want`, or `timeout` expires. Returns
/// whether the wanted state was observed.
fn wait_for_running(want: bool, timeout: Duration) -> bool {
    let start = Instant::now();
    loop {
        if is_running().unwrap_or(false) == want {
            return true;
        }
        if start.elapsed() >= timeout {
            return false;
        }
        std::thread::sleep(POLL_INTERVAL);
    }
}

/// Restart the daemon: end the running instance, wait for it to actually go
/// away, then run it again.
///
/// schtasks has no atomic restart verb, and the naive `/end` + `/run` pair is
/// unsound here for two compounding reasons:
///
/// - `/end` is ASYNCHRONOUS. It requests termination and returns; the process
///   can still be alive when the next command runs.
/// - the task sets `MultipleInstancesPolicy=IgnoreNew`, so a `/run` issued
///   while an instance is still alive is silently DROPPED - and `schtasks /run`
///   still exits 0, because it reports that the request was accepted, not that
///   an instance started.
///
/// Together those mean the old process finishes exiting, nothing replaces it,
/// and the daemon is left stopped while this function reports success.
/// (`RestartOnFailure` may eventually paper over it, but not for a minute, and
/// only if the ended task counts as a failure.) So: wait for the task to stop
/// before starting it, and refuse to issue a `/run` that would be ignored.
///
/// See the macOS counterpart for why this does not fall back to `install`.
pub fn restart() -> Result<()> {
    if !is_loaded()? {
        return Err(anyhow!(
            "the scheduled task is not registered, so there is nothing to restart\n\
             hint: run `sealgate-stdiod install` to (re)create it"
        ));
    }

    // Can we read the task's run state at all? The "Status:" field name is
    // localized, so on a non-English Windows it is simply absent. That gates
    // the post-start verification below, which would otherwise warn on every
    // restart for those users. Asking running_status() (rather than inferring
    // it from is_running() being true) keeps "readable, and currently stopped"
    // distinct from "unreadable" - so restarting an already-dead daemon is
    // still verified.
    let status_readable = matches!(running_status(), Ok(Some(_)));

    // `/end` "fails" both when nothing was running (benign) and for real
    // problems like access denied, and its message is localized - so neither
    // the exit code nor the text is a reliable signal. The task's actual state
    // is the arbiter instead; the message is kept only to enrich the error if
    // the task never stops, which is the case a genuine /end failure produces.
    let end = schtasks(&["/end", "/tn", &task_name()])?;
    let end_msg = String::from_utf8_lossy(&end.stderr).trim().to_owned();

    if !wait_for_running(false, STOP_TIMEOUT) {
        let detail = if end_msg.is_empty() {
            String::new()
        } else {
            format!("\nschtasks /end reported: {end_msg}")
        };
        return Err(anyhow!(
            "the running instance did not stop within {}s, so starting a new one would be \
             ignored (the task sets MultipleInstancesPolicy=IgnoreNew) and this would report \
             a restart that never happened{detail}\n\
             hint: check for a stuck sealgate-stdiod process, or run `sealgate-stdiod \
             uninstall` followed by `sealgate-stdiod install`",
            STOP_TIMEOUT.as_secs()
        ));
    }

    let out = schtasks(&["/run", "/tn", &task_name()])?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(anyhow!("schtasks /run failed: {}", stderr.trim()));
    }

    // `/run` exiting 0 means the request was accepted, not that the action is
    // alive, so confirm rather than assume. Skipped when the status field was
    // never readable (see status_readable): there we cannot tell "not started"
    // from "cannot see it" and must not cry wolf.
    if status_readable && !wait_for_running(true, START_TIMEOUT) {
        warn!(task = %task_name(), "task did not report Running after /run");
        println!(
            "Started {} but it is not reporting Running after {}s. \
             Check `sealgate-stdiod status` and `sealgate-stdiod logs`.",
            task_name(),
            START_TIMEOUT.as_secs()
        );
        return Ok(());
    }

    info!(task = %task_name(), "scheduled task restarted");
    println!(
        "Restarted {}. Tail logs with `sealgate-stdiod logs --follow`.",
        task_name()
    );
    Ok(())
}

/// The task's run state, or `None` when it could not be determined.
///
/// `None` means the "Status:" line was absent from `schtasks /query /v` - the
/// field name is localized, so on a non-English Windows the parse finds
/// nothing. That is very different from a confident "not running", and callers
/// that act on the answer need to tell them apart: [`restart`] uses it to
/// decide whether verifying the restart is even possible. [`is_running`]
/// flattens it for callers that just want a boolean.
fn running_status() -> Result<Option<bool>> {
    let out = schtasks(&["/query", "/tn", &task_name(), "/fo", "LIST", "/v"])?;
    if !out.status.success() {
        // The query itself failed - most likely the task does not exist, which
        // is a definite "not running" rather than an unreadable status.
        return Ok(Some(false));
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    for line in stdout.lines() {
        if let Some(rest) = line.trim().strip_prefix("Status:") {
            return Ok(Some(rest.trim().eq_ignore_ascii_case("Running")));
        }
    }
    Ok(None)
}

/// True iff the task is currently executing (its action process is alive).
/// Parses `schtasks /query /v`'s "Status:" field - English-locale, mirroring
/// the macOS `launchctl print` parse. An unreadable status reads as `false`.
#[allow(dead_code)] // consumed by the `status` subcommand
pub fn is_running() -> Result<bool> {
    Ok(running_status()?.unwrap_or(false))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn render_task_xml_includes_binary_args_and_trigger() {
        let body = render_task_xml(Path::new(r"C:\Apps\sealgate-stdiod.exe"), r"WS\dimi");
        assert!(body.contains(r"<Command>C:\Apps\sealgate-stdiod.exe</Command>"));
        assert!(body.contains("<Arguments>run</Arguments>"));
        assert!(body.contains("<LogonTrigger>"));
        assert!(body.contains("<UserId>WS\\dimi</UserId>"));
        assert!(body.contains("<LogonType>InteractiveToken</LogonType>"));
    }

    #[test]
    fn render_task_xml_sets_hidden_restart_and_no_timelimit() {
        let body = render_task_xml(Path::new(r"C:\x.exe"), "u");
        assert!(body.contains("<Hidden>true</Hidden>"));
        assert!(body.contains("<RestartOnFailure>"));
        assert!(body.contains("<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>"));
    }

    #[test]
    fn xml_escape_escapes_markup() {
        assert_eq!(xml_escape("a&b<c>d"), "a&amp;b&lt;c&gt;d");
    }
}
