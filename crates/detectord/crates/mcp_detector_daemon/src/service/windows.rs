//! Windows Scheduled Task integration.
//!
//! The Windows analog of the macOS LaunchAgent: a per-user **logon task** that
//! runs the daemon as the logged-in user, in their session, starting at logon
//! and restarting on failure. Deliberately NOT a Windows Service: a service runs
//! in session 0 as SYSTEM, which would break the daemon's per-user model (it
//! reads the user's MCP client configs and spawns the user's tools with their
//! PATH/env).
//!
//! We register via `schtasks /create /xml` with a Task Scheduler definition
//! because the command-line flags can't express what we need (Hidden,
//! restart-on-failure, unlimited run time). `LogonType=InteractiveToken` runs
//! with the user's live token: no stored password, no admin.
//!
//! Idempotent: install deletes any existing task before recreating, mirroring
//! the macOS bootout-before-bootstrap flow.

use std::os::windows::process::CommandExt;
use std::path::Path;
use std::process::Command;

use anyhow::{Context, Result, anyhow};
use tracing::{debug, info, warn};

/// Base name. The live task name appends the user's SID (see `task_name`).
const TASK_BASENAME: &str = "SealGate detectord";

/// CREATE_NO_WINDOW: the daemon has no console, so spawning console programs
/// (schtasks/whoami) would otherwise flash a window.
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Per-user task name `<base> <SID>`. Namespacing by SID keeps two accounts on
/// one machine from clobbering each other's task; falls back to the bare base
/// name if the SID can't be resolved.
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
/// the current user with their interactive token at every logon. `enforce`
/// selects the daemon's enforcing vs report-only args (mirrors the macOS plist).
fn render_task_xml(binary: &Path, user: &str, enforce: bool) -> String {
    let bin = xml_escape(&binary.display().to_string());
    let u = xml_escape(user);
    let args = if enforce {
        "daemon --enforce"
    } else {
        "daemon --no-hooks"
    };
    format!(
        r#"<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>SealGate MCP detector and quarantine daemon</Description>
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
      <Arguments>{args}</Arguments>
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

/// Write the task XML + register it via schtasks, then start it now. Idempotent
/// (deletes any existing task first).
pub fn install(enforce: bool) -> Result<()> {
    let binary = std::env::current_exe().context("could not resolve current exe path")?;
    let user = current_user();
    if user.is_empty() {
        return Err(anyhow!("could not resolve current user (USERNAME unset)"));
    }
    let task = task_name();
    let xml = render_task_xml(&binary, &user, enforce);
    let xml_path = std::env::temp_dir().join("sealgate-detectord-task.xml");
    write_task_xml(&xml_path, &xml)?;
    info!(path = %xml_path.display(), enforce, "wrote scheduled task definition");

    // Idempotent: drop any existing task (stops it too), plus a legacy task
    // under the bare base name (pre-SID-namespacing), before recreating.
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

    // Start now (the RunAtLoad equivalent). Non-fatal: the logon trigger still
    // starts it at next sign-in.
    match schtasks(&["/run", "/tn", &task]) {
        Ok(o) if o.status.success() => {}
        Ok(o) => warn!(
            stderr = %String::from_utf8_lossy(&o.stderr),
            "schtasks /run failed; task will start at next logon"
        ),
        Err(e) => warn!(error = %e, "could not start task now; will start at next logon"),
    }

    println!("Installed scheduled task: {task}");
    println!(
        "Daemon running{}.",
        if enforce {
            " (enforcing)"
        } else {
            " (report-only)"
        }
    );
    Ok(())
}

/// Every registered task whose leaf name starts with `TASK_BASENAME` (the bare
/// legacy name plus every `<base> <SID>` variant). Parses `schtasks /query /fo
/// LIST`'s `TaskName:` field (English-locale, matching `is_running`'s parse).
///
/// We enumerate rather than reconstruct the SID name because uninstall can run
/// in a different context than install (UAC elevation to another admin, or a
/// context where `whoami` resolves a different/no SID), so the name rebuilt from
/// the live token may not match the task that was actually registered.
fn all_matching_tasks() -> Vec<String> {
    let Ok(out) = schtasks(&["/query", "/fo", "LIST"]) else {
        return Vec::new();
    };
    if !out.status.success() {
        return Vec::new();
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    let mut tasks = Vec::new();
    for line in stdout.lines() {
        if let Some(rest) = line.trim().strip_prefix("TaskName:") {
            let full = rest.trim();
            // TaskName is a path like `\SealGate detectord S-1-5-...`; match
            // on the leaf so a task nested in a folder still matches.
            let leaf = full.rsplit('\\').next().unwrap_or(full);
            if leaf.starts_with(TASK_BASENAME) {
                tasks.push(full.to_string());
            }
        }
    }
    tasks
}

/// Stop + remove the task. Idempotent. Leaves data; the caller
/// (`service::uninstall`) handles the optional purge.
pub fn uninstall() -> Result<()> {
    // Enumerate every task matching our base name and remove each, so an
    // SID-namespaced task still goes even when the uninstall context can't
    // reproduce the SID used at install time. Fall back to the reconstructed
    // names if enumeration finds nothing (e.g. non-English `schtasks` output).
    let mut targets = all_matching_tasks();
    if targets.is_empty() {
        targets.push(task_name());
        if !targets.iter().any(|t| t == TASK_BASENAME) {
            targets.push(TASK_BASENAME.to_string());
        }
    }

    let mut removed = 0usize;
    for task in &targets {
        let _ = schtasks(&["/end", "/tn", task]); // stop a running instance
        let out = match schtasks(&["/delete", "/tn", task, "/f"]) {
            Ok(o) => o,
            Err(e) => {
                warn!(task = %task, error = %e, "schtasks /delete failed to invoke; continuing");
                continue;
            }
        };
        if out.status.success() {
            info!(task = %task, "removed scheduled task");
            removed += 1;
        } else {
            let stderr = String::from_utf8_lossy(&out.stderr);
            // Benign: the task doesn't exist (already uninstalled).
            let benign = stderr.contains("does not exist")
                || stderr.contains("cannot find")
                || stderr.to_lowercase().contains("the system cannot find");
            if benign {
                info!(task = %task, "no scheduled task to remove");
            } else {
                warn!(task = %task, stderr = %stderr, "schtasks /delete reported an error; continuing");
            }
        }
    }
    if removed == 0 {
        info!("no scheduled task to remove");
    }
    Ok(())
}

/// True iff the scheduled task exists.
pub fn is_installed() -> bool {
    schtasks(&["/query", "/tn", &task_name()])
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// True iff the task is currently executing. Parses `schtasks /query /v`'s
/// "Status:" field (English-locale), mirroring the macOS `launchctl print` parse.
pub fn is_running() -> bool {
    let Ok(out) = schtasks(&["/query", "/tn", &task_name(), "/fo", "LIST", "/v"]) else {
        return false;
    };
    if !out.status.success() {
        return false;
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    for line in stdout.lines() {
        if let Some(rest) = line.trim().strip_prefix("Status:") {
            return rest.trim().eq_ignore_ascii_case("Running");
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn render_task_xml_enforce_vs_report() {
        let e = render_task_xml(
            Path::new(r"C:\Apps\sealgate-detectord.exe"),
            r"WS\dimi",
            true,
        );
        assert!(e.contains(r"<Command>C:\Apps\sealgate-detectord.exe</Command>"));
        assert!(e.contains("<Arguments>daemon --enforce</Arguments>"));
        assert!(e.contains("<LogonTrigger>"));
        assert!(e.contains("<UserId>WS\\dimi</UserId>"));
        assert!(e.contains("<LogonType>InteractiveToken</LogonType>"));

        let r = render_task_xml(Path::new(r"C:\x.exe"), "u", false);
        assert!(r.contains("<Arguments>daemon --no-hooks</Arguments>"));
        assert!(r.contains("<Hidden>true</Hidden>"));
        assert!(r.contains("<RestartOnFailure>"));
        assert!(r.contains("<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>"));
    }

    #[test]
    fn xml_escape_escapes_markup() {
        assert_eq!(xml_escape("a&b<c>d"), "a&amp;b&lt;c&gt;d");
    }
}
