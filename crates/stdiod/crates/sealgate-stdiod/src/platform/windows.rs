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
/// Grace period used INSTEAD of polling when the task's run state cannot be
/// read at all. Not a guarantee that the old instance is gone - nothing
/// available here can prove that - but enough that an asynchronous `/end`
/// normally completes first, which is the difference between "occasionally
/// races" and "races every single time".
const BLIND_SETTLE: Duration = Duration::from_secs(3);

/// Result of waiting for the task to reach a run state.
#[derive(Debug, PartialEq, Eq)]
enum Wait {
    /// The wanted state was observed.
    Reached,
    /// The state was readable throughout and never became the wanted one.
    TimedOut,
    /// The run state could not be read, so nothing was observed either way.
    Unreadable,
}

/// Poll [`running_status`] until it reports `want`, or `timeout` expires.
///
/// Deliberately built on the tri-state rather than [`is_running`]: flattening
/// `None` to `false` here silently defeated the whole stop-gate. On a non-
/// English Windows the "Status:" field name is localized and never matches, so
/// `unwrap_or(false)` made "cannot read the state" indistinguishable from
/// "confirmed stopped" - `wait_for_running(false, ..)` returned `Reached` on its
/// first iteration, `/run` fired while the old instance was still alive, and
/// `IgnoreNew` dropped it. The exact race this function exists to prevent, for
/// every non-English user.
///
/// `Unreadable` returns immediately rather than burning the timeout: if the
/// field cannot be parsed once it will not parse a hundred polls later, and the
/// caller has a different strategy for that case.
fn wait_for_state(want: bool, timeout: Duration) -> Wait {
    let start = Instant::now();
    loop {
        match running_status() {
            Ok(Some(state)) if state == want => return Wait::Reached,
            Ok(Some(_)) => {}
            Ok(None) | Err(_) => return Wait::Unreadable,
        }
        if start.elapsed() >= timeout {
            return Wait::TimedOut;
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

    // `/end` "fails" both when nothing was running (benign) and for real
    // problems like access denied, and its message is localized - so neither
    // the exit code nor the text is a reliable signal. The task's actual state
    // is the arbiter instead; the message is kept only to enrich the error if
    // the task never stops, which is the case a genuine /end failure produces.
    let end = schtasks(&["/end", "/tn", &task_name()])?;
    let end_msg = String::from_utf8_lossy(&end.stderr).trim().to_owned();

    // Tracks whether this restart can be stated as fact. It drops to false the
    // moment the run state stops being readable, and the closing message says
    // so rather than claiming a confirmation that never happened.
    let mut verified = true;

    match wait_for_state(false, STOP_TIMEOUT) {
        Wait::Reached => {}
        Wait::TimedOut => {
            let detail = if end_msg.is_empty() {
                String::new()
            } else {
                format!("\nschtasks /end reported: {end_msg}")
            };
            return Err(anyhow!(
                "the running instance did not stop within {}s, so starting a new one would be \
                 ignored (the task sets MultipleInstancesPolicy=IgnoreNew) and this would \
                 report a restart that never happened{detail}\n\
                 hint: check for a stuck sealgate-stdiod process, or run `sealgate-stdiod \
                 uninstall` followed by `sealgate-stdiod install`",
                STOP_TIMEOUT.as_secs()
            ));
        }
        Wait::Unreadable => {
            // No signal to wait on. Erroring out here would make `restart`
            // permanently impossible on a non-English Windows, which is worse
            // than the risk it avoids - so settle for a fixed grace period,
            // proceed, and stop claiming the outcome is confirmed.
            verified = false;
            warn!(
                task = %task_name(),
                settle_ms = BLIND_SETTLE.as_millis() as u64,
                "task run state is unreadable (localized status field); \
                 waiting a fixed grace period instead of polling"
            );
            std::thread::sleep(BLIND_SETTLE);
        }
    }

    let out = schtasks(&["/run", "/tn", &task_name()])?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(anyhow!("schtasks /run failed: {}", stderr.trim()));
    }

    // `/run` exiting 0 means the request was accepted, not that the action is
    // alive, so confirm rather than assume.
    //
    // TimedOut is an ERROR, not a warning: this function exists because `/run`
    // can be silently dropped, and returning Ok would put the exit code right
    // back where it started - `sealgate-stdiod restart && echo ok` printing ok
    // for a daemon that is down. The check is narrow enough to carry that
    // weight; it asks whether Task Scheduler started the action, not whether
    // the daemon finished connecting, so START_TIMEOUT is generous and a
    // failure here is not a judgement about startup speed.
    //
    // Unreadable is NOT an error: absence of evidence is not evidence of
    // failure, and treating it as one would fail every restart on a locale we
    // simply cannot read. It only costs the confirmation.
    match wait_for_state(true, START_TIMEOUT) {
        Wait::Reached => {}
        Wait::TimedOut => {
            warn!(task = %task_name(), "task did not report Running after /run");
            return Err(anyhow!(
                "schtasks /run was accepted but the task is still not reporting Running after \
                 {}s, so the daemon is not back up\n\
                 hint: the action may be failing on startup (see `sealgate-stdiod logs`), or a \
                 previous instance is lingering and the start was ignored. \
                 `schtasks /query /tn \"{}\" /v` shows the task's last result.",
                START_TIMEOUT.as_secs(),
                task_name()
            ));
        }
        Wait::Unreadable => verified = false,
    }

    info!(task = %task_name(), verified, "scheduled task restarted");
    if verified {
        println!(
            "Restarted {}. Tail logs with `sealgate-stdiod logs --follow`.",
            task_name()
        );
    } else {
        // Say plainly that this is a start request, not a confirmed restart.
        // The exit code stays 0 - nothing indicates failure - but the wording
        // must not imply a check that could not be performed.
        println!(
            "Start requested for {} - could NOT verify it, because this system's \
             schtasks output has no readable status field (non-English locale).\n\
             Confirm with `sealgate-stdiod status` or `sealgate-stdiod logs`.",
            task_name()
        );
    }
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
    Ok(parse_running_status(&String::from_utf8_lossy(&out.stdout)))
}

/// Extract the run state from `schtasks /query /fo LIST /v` output.
///
/// Split out from the process call so the locale behaviour - the whole reason
/// this returns an `Option` - can be tested against real output samples.
/// Returns `None` when no "Status:" line is present, which is what a localized
/// Windows produces.
fn parse_running_status(stdout: &str) -> Option<bool> {
    stdout
        .lines()
        .find_map(|line| line.trim().strip_prefix("Status:"))
        .map(|rest| rest.trim().eq_ignore_ascii_case("Running"))
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

    // The locale behaviour is the crux of the restart stop-gate: an unreadable
    // status must stay distinguishable from "not running", or wait_for_state
    // reports Reached instantly and /run races the still-dying old instance.
    #[test]
    fn parse_running_status_reads_english_output() {
        let running = "TaskName:  \\SealGate stdiod S-1-5-21\nStatus:    Running\nLogon Mode: Interactive only\n";
        assert_eq!(parse_running_status(running), Some(true));
        let ready = "TaskName:  \\SealGate stdiod S-1-5-21\nStatus:    Ready\n";
        assert_eq!(parse_running_status(ready), Some(false));
    }

    #[test]
    fn parse_running_status_distinguishes_unknown_from_stopped() {
        // The case that matters: a translated FIELD NAME. Nothing matches the
        // English prefix, so the state is genuinely unknown and must NOT read as
        // "stopped" - that is what made wait_for_state return Reached instantly
        // and let /run race the dying instance. French schtasks output.
        let fr = "Nom de la t\u{e2}che: \\SealGate stdiod\n\u{c9}tat:  En cours d\u{2019}ex\u{e9}cution\n";
        assert_eq!(parse_running_status(fr), None);

        // A translated VALUE under an English field name is a different case,
        // and a safe one: it parses as "not Running", so a stop-wait keeps
        // waiting rather than starting too early.
        let de = "Aufgabenname: \\SealGate stdiod\nStatus:  Wird ausgef\u{fc}hrt\n";
        assert_eq!(parse_running_status(de), Some(false));
    }

    #[test]
    fn parse_running_status_is_none_when_absent_entirely() {
        assert_eq!(parse_running_status(""), None);
        assert_eq!(
            parse_running_status("TaskName: x\nLogon Mode: Interactive\n"),
            None
        );
    }

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
