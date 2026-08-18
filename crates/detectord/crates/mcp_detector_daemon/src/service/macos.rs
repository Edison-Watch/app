//! macOS LaunchAgent install for the detector daemon: a per-user agent (no
//! sudo, no root LaunchDaemon), mirroring `sealgate-stdiod` so the desktop client
//! installs and launches us exactly the way it installs stdiod:
//!
//! - plist at `~/Library/LaunchAgents/com.sealgate.detectord.plist`
//! - loaded via `launchctl bootstrap gui/$uid ...` (modern flow, not `load`)
//! - `RunAtLoad` + `KeepAlive` so launchd starts it now/at login and restarts
//!   it on crash. The daemon serves its socket for the client to connect to.
//! - a PATH override so child spawns (the `claude` CLI, npx-wrapped servers)
//!   resolve; launchd's default PATH omits Homebrew / `/usr/local/bin`.
//!
//! Install is idempotent: it always boots-out any existing unit before
//! bootstrapping the fresh plist, so re-running picks up a moved binary or a
//! flag change.

use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{Context, Result, anyhow, bail};

use crate::{ipc, paths};

const LABEL: &str = "com.sealgate.detectord";
const PLIST_FILENAME: &str = "com.sealgate.detectord.plist";
/// launchd's per-user default PATH omits Homebrew and /usr/local/bin; without
/// this every child spawn (`claude`, `npx`, ...) fails to resolve.
const CHILD_PATH: &str = "/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/local/sbin:/usr/bin:/bin:/usr/sbin:/sbin";

fn plist_path() -> Result<PathBuf> {
    let home = dirs::home_dir().ok_or_else(|| anyhow!("HOME not set"))?;
    let dir = home.join("Library/LaunchAgents");
    std::fs::create_dir_all(&dir)?;
    Ok(dir.join(PLIST_FILENAME))
}

fn user_domain() -> String {
    // SAFETY: getuid is infallible.
    let uid = unsafe { libc::getuid() };
    format!("gui/{uid}")
}

fn service_target() -> String {
    format!("{}/{}", user_domain(), LABEL)
}

fn launchd_log() -> Result<PathBuf> {
    let dir = paths::base_dir().join("logs");
    std::fs::create_dir_all(&dir)?;
    Ok(dir.join("launchd.log"))
}

fn render_plist(binary: &Path, log: &Path, enforce: bool) -> String {
    let mut prog = vec![binary.display().to_string(), "daemon".to_string()];
    if enforce {
        // Full mode: quarantine + own the hooks (consumer runs).
        prog.push("--enforce".to_string());
    } else {
        // Report-only / shadow: no hook consumer, so we don't fight a client's
        // own hook monitor over ~/.sealgate.
        prog.push("--no-hooks".to_string());
    }
    let args = prog
        .iter()
        .map(|a| format!("    <string>{a}</string>"))
        .collect::<Vec<_>>()
        .join("\n");
    let log = log.display();
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
{args}
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
    <string>{CHILD_PATH}</string>
  </dict>
  <key>StandardOutPath</key>
  <string>{log}</string>
  <key>StandardErrorPath</key>
  <string>{log}</string>
</dict>
</plist>
"#
    )
}

fn write_plist(path: &Path, body: &str) -> Result<()> {
    let tmp = path.with_extension("plist.tmp");
    std::fs::write(&tmp, body).with_context(|| format!("writing {}", tmp.display()))?;
    std::fs::rename(&tmp, path).with_context(|| format!("renaming -> {}", path.display()))?;
    Ok(())
}

fn launchctl(args: &[&str]) -> Result<std::process::Output> {
    Command::new("launchctl")
        .args(args)
        .output()
        .context("failed to invoke launchctl")
}

/// `bootout` the current unit if loaded; ignore "not loaded".
fn bootout_quiet() -> Result<()> {
    let out = launchctl(&["bootout", &service_target()])?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        let benign = stderr.contains("Could not find specified service")
            || stderr.contains("No such process")
            || out.status.code() == Some(113);
        if !benign {
            tracing::warn!(stderr = %stderr, "launchctl bootout reported an error; continuing");
        }
    }
    Ok(())
}

/// Write the plist and `launchctl bootstrap` it. Idempotent. `enforce` decides
/// whether the running daemon actually quarantines (still gated by org policy)
/// or runs report-only; default off is safe for first-time install.
pub fn install(enforce: bool) -> Result<()> {
    let binary = std::env::current_exe().context("could not resolve current exe path")?;
    let log = launchd_log()?;
    let plist = plist_path()?;
    write_plist(&plist, &render_plist(&binary, &log, enforce))?;
    tracing::info!(path = %plist.display(), enforce, "wrote LaunchAgent plist");

    bootout_quiet()?; // pick up a moved binary / changed flags
    let out = launchctl(&[
        "bootstrap",
        &user_domain(),
        plist.to_string_lossy().as_ref(),
    ])?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
        bail!("launchctl bootstrap failed: {}", stderr.trim());
    }
    println!("Installed LaunchAgent: {}", plist.display());
    println!(
        "Daemon running{}; socket: {}",
        if enforce {
            " (enforcing)"
        } else {
            " (report-only)"
        },
        ipc::default_socket_path().display()
    );
    Ok(())
}

/// `launchctl bootout` + remove the plist. Idempotent. Leaves state/logs; the
/// caller (`service::uninstall`) handles the optional data purge.
pub fn uninstall() -> Result<()> {
    bootout_quiet()?;
    let plist = plist_path()?;
    match std::fs::remove_file(&plist) {
        Ok(()) => tracing::info!(path = %plist.display(), "removed LaunchAgent plist"),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(e).with_context(|| format!("removing {}", plist.display())),
    }
    Ok(())
}

/// The plist exists on disk.
pub fn is_installed() -> bool {
    plist_path().map(|p| p.exists()).unwrap_or(false)
}

/// `launchctl print` reports a running PID.
pub fn is_running() -> bool {
    let Ok(out) = launchctl(&["print", &service_target()]) else {
        return false;
    };
    if !out.status.success() {
        return false;
    }
    String::from_utf8_lossy(&out.stdout).lines().any(|l| {
        l.trim()
            .strip_prefix("pid =")
            .is_some_and(|rest| rest.trim().parse::<u32>().is_ok())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plist_has_label_program_and_path() {
        let body = render_plist(
            Path::new("/opt/sealgate/detectord"),
            Path::new("/tmp/l.log"),
            true,
        );
        assert!(body.contains("<string>com.sealgate.detectord</string>"));
        assert!(body.contains("<string>/opt/sealgate/detectord</string>"));
        assert!(body.contains("<string>daemon</string>"));
        assert!(body.contains("<string>--enforce</string>"));
        assert!(body.contains("<key>RunAtLoad</key>"));
        assert!(body.contains("<key>KeepAlive</key>"));
        assert!(body.contains("/opt/homebrew/bin"));
    }

    #[test]
    fn plist_report_only_uses_no_hooks_not_enforce() {
        let body = render_plist(Path::new("/bin/x"), Path::new("/tmp/l.log"), false);
        assert!(!body.contains("--enforce"));
        assert!(body.contains("<string>--no-hooks</string>"));
        assert!(body.trim_end().ends_with("</plist>"));
    }
}
