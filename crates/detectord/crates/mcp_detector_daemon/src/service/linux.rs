//! Linux systemd **user** service integration for the detector daemon.
//!
//! The Linux analog of the macOS LaunchAgent and the Windows logon task: a
//! per-user unit at `~/.config/systemd/user/sealgate-detectord.service`, managed
//! with `systemctl --user` (no `sudo`, no system-level unit) so the daemon runs
//! as the logged-in user with their HOME, PATH, and MCP client configs - which
//! is exactly the per-user model the daemon needs (it reads the user's
//! `~/.claude.json` etc. and spawns their tools).
//!
//! Mirrors `sealgate-stdiod`'s Linux integration:
//!
//! - `Restart=on-failure`      - systemd restarts the binary on crash (the
//!   worker loop also self-heals, so only a full process exit needs this).
//! - `WantedBy=default.target` - start on login. We deliberately do **not**
//!   call `loginctl enable-linger`, so the daemon runs only while the user has
//!   a session - matching the macOS LaunchAgent and the Windows logon task.
//! - a PATH override so child spawns (`claude`, npx/uvx-wrapped servers)
//!   resolve; a user service otherwise inherits a minimal environment.
//!
//! ## systemd is not guaranteed
//!
//! Most distros use systemd, but Alpine (OpenRC), Void (runit), Artix/Devuan
//! and bare containers do not. We **detect** a reachable systemd user instance
//! and, when absent, return an actionable error rather than writing a unit that
//! never starts. The daemon itself still runs fine via `daemon` under any init
//! system or process manager.

use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{Context, Result, anyhow};
use tracing::{debug, info, warn};

use crate::{ipc, paths};

const UNIT_NAME: &str = "sealgate-detectord.service";
/// A user service inherits a minimal PATH, which breaks child MCP spawns
/// (`claude`, npx/uvx in ~/.local/bin or /usr/local/bin). The daemon augments
/// child PATH at spawn too, but seeding it here keeps the common case working.
const CHILD_PATH: &str =
    "%h/.local/bin:%h/bin:/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin";

/// `~/.config/systemd/user/sealgate-detectord.service`.
fn unit_path() -> Result<PathBuf> {
    let home = dirs::home_dir().ok_or_else(|| anyhow!("HOME not set"))?;
    let dir = home.join(".config/systemd/user");
    std::fs::create_dir_all(&dir).with_context(|| format!("creating {}", dir.display()))?;
    Ok(dir.join(UNIT_NAME))
}

/// Run `systemctl --user <args>`.
fn systemctl(args: &[&str]) -> Result<std::process::Output> {
    debug!(?args, "systemctl --user");
    Command::new("systemctl")
        .arg("--user")
        .args(args)
        .output()
        .context("failed to invoke systemctl (is it installed?)")
}

/// True iff a systemd **user** instance is reachable for this session. When
/// there is no user manager (OpenRC/runit distros, many containers) `systemctl
/// --user` fails to connect to the bus - we detect that distinct failure so
/// callers can degrade gracefully. `is-system-running` is read-only and answers
/// whenever the bus is up (it may report "degraded" with a non-zero exit, still
/// "available" - so we gate on the bus-connection error text, not the exit code).
fn systemd_user_available() -> bool {
    match systemctl(&["is-system-running"]) {
        Ok(out) => !String::from_utf8_lossy(&out.stderr).contains("Failed to connect to bus"),
        Err(_) => false,
    }
}

/// Quote a path as a single systemd `ExecStart` argument. systemd splits the
/// command line on whitespace unless the token is quoted, so a binary path
/// containing a space (e.g. the Linux run-path under a home dir with a space)
/// would otherwise be parsed as multiple arguments and fail to start
/// (`status=203/EXEC`). systemd accepts double-quote quoting with C-style
/// escapes, so escape `\` and `"`, then wrap. Only `ExecStart` needs this;
/// `StandardOutput=append:` / `Environment=` take the rest of the line verbatim.
fn systemd_quote(s: &str) -> String {
    format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
}

fn render_unit(binary: &Path, log: &Path, enforce: bool) -> String {
    // `enforce` selects the daemon's enforcing (quarantine + hooks) vs
    // report-only args, mirroring the macOS plist and Windows task.
    let args = if enforce {
        "daemon --enforce"
    } else {
        "daemon --no-hooks"
    };
    // StandardOutput/StandardError=append: route the daemon's console output
    // into the same logs dir the file-appender uses, so a user service's output
    // is visible without journald. `append:` needs systemd v240+ (2018); its
    // parent dir is created at install time.
    let bin = systemd_quote(&binary.display().to_string());
    let log = log.display();
    format!(
        "[Unit]\n\
         Description=SealGate MCP detector and quarantine daemon\n\
         Documentation=https://edison.watch\n\
         After=network-online.target\n\
         Wants=network-online.target\n\
         \n\
         [Service]\n\
         Type=simple\n\
         ExecStart={bin} {args}\n\
         Restart=on-failure\n\
         RestartSec=5\n\
         Environment=PATH={CHILD_PATH}\n\
         StandardOutput=append:{log}\n\
         StandardError=append:{log}\n\
         \n\
         [Install]\n\
         WantedBy=default.target\n",
    )
}

fn write_unit(path: &Path, body: &str) -> Result<()> {
    let tmp = path.with_extension("service.tmp");
    std::fs::write(&tmp, body).with_context(|| format!("writing {}", tmp.display()))?;
    std::fs::rename(&tmp, path).with_context(|| format!("renaming -> {}", path.display()))?;
    Ok(())
}

/// Write the unit + `systemctl --user enable --now`. Idempotent. `enforce`
/// selects enforcing vs report-only mode.
pub fn install(enforce: bool) -> Result<()> {
    if !systemd_user_available() {
        return Err(anyhow!(
            "no systemd user instance is available on this system.\n\
             The daemon still runs fine without it - start it under your init\n\
             system or process manager instead, e.g.:\n\
             \n    sealgate-detectord daemon{}\n\n\
             (OpenRC/runit/s6 service files and containers should exec that\n\
             command directly.)",
            if enforce { " --enforce" } else { " --no-hooks" },
        ));
    }

    let binary = std::env::current_exe().context("could not resolve current exe path")?;
    let log = paths::base_dir().join("logs").join("detectord.log");
    // `StandardError=append:` writes to the file but does not create its parent
    // directory - do that here so the first start doesn't fail.
    if let Some(parent) = log.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("creating log dir {}", parent.display()))?;
    }
    let unit = unit_path()?;
    write_unit(&unit, &render_unit(&binary, &log, enforce))?;
    info!(path = %unit.display(), enforce, "wrote systemd user unit");

    // daemon-reload so a re-install picks up a moved binary or edited unit.
    let reload = systemctl(&["daemon-reload"])?;
    if !reload.status.success() {
        warn!(
            stderr = %String::from_utf8_lossy(&reload.stderr),
            "systemctl --user daemon-reload reported an error; continuing"
        );
    }

    // enable = start on login; --now = start immediately.
    let out = systemctl(&["enable", "--now", UNIT_NAME])?;
    if !out.status.success() {
        return Err(anyhow!(
            "systemctl --user enable --now {UNIT_NAME} failed: {}",
            String::from_utf8_lossy(&out.stderr).trim(),
        ));
    }
    info!(unit = UNIT_NAME, "systemd user service enabled and started");
    println!("Installed systemd user service: {}", unit.display());
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

/// `systemctl --user disable --now` + remove the unit. Idempotent. Leaves
/// state/logs; the caller (`service::uninstall`) handles the optional purge.
pub fn uninstall() -> Result<()> {
    // disable --now even if the unit file is already gone; ignore failures
    // (e.g. "not loaded") so the call is safe to repeat. Only attempt it when a
    // user bus exists - otherwise there is nothing to talk to.
    if systemd_user_available()
        && let Ok(out) = systemctl(&["disable", "--now", UNIT_NAME])
        && !out.status.success()
    {
        debug!(
            stderr = %String::from_utf8_lossy(&out.stderr),
            "systemctl --user disable reported an error; continuing"
        );
    }

    let unit = unit_path()?;
    match std::fs::remove_file(&unit) {
        Ok(()) => info!(path = %unit.display(), "removed systemd user unit"),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            info!("no systemd user unit to remove");
        }
        Err(e) => return Err(e).with_context(|| format!("removing {}", unit.display())),
    }

    if systemd_user_available() {
        let _ = systemctl(&["daemon-reload"]);
    }
    Ok(())
}

/// The unit file exists on disk - the canonical "did install run" signal
/// (cheap, no bus round-trip).
pub fn is_installed() -> bool {
    dirs::home_dir()
        .map(|h| h.join(".config/systemd/user").join(UNIT_NAME).exists())
        .unwrap_or(false)
}

/// `systemctl --user is-active` reports the unit active. The text is
/// locale-independent (an enum serialisation), unlike the launchctl/schtasks
/// parses on the other platforms.
pub fn is_running() -> bool {
    if !systemd_user_available() {
        return false;
    }
    let Ok(out) = systemctl(&["is-active", UNIT_NAME]) else {
        return false;
    };
    String::from_utf8_lossy(&out.stdout).trim() == "active"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn render_unit_enforce_vs_report() {
        let e = render_unit(
            Path::new("/usr/local/bin/sealgate-detectord"),
            Path::new("/home/me/.config/sealgate-detectord/logs/detectord.log"),
            true,
        );
        // The binary is quoted as one systemd argument (see systemd_quote).
        assert!(e.contains("ExecStart=\"/usr/local/bin/sealgate-detectord\" daemon --enforce"));
        assert!(e.contains("Restart=on-failure"));
        assert!(e.contains("WantedBy=default.target"));
        assert!(e.contains("[Service]"));

        let r = render_unit(Path::new("/bin/x"), Path::new("/tmp/x.log"), false);
        assert!(r.contains("ExecStart=\"/bin/x\" daemon --no-hooks"));
        assert!(!r.contains("--enforce"));
    }

    #[test]
    fn render_unit_quotes_binary_path_with_spaces() {
        // A run-path under a home dir with a space must stay a single ExecStart
        // argument, or systemd splits it and the daemon fails (status=203/EXEC).
        let body = render_unit(
            Path::new("/home/John Doe/.local/share/sealgate/bin/sealgate-detectord"),
            Path::new("/home/John Doe/.config/sealgate-detectord/logs/detectord.log"),
            true,
        );
        assert!(body.contains(
            "ExecStart=\"/home/John Doe/.local/share/sealgate/bin/sealgate-detectord\" daemon --enforce"
        ));
    }

    #[test]
    fn render_unit_seeds_path_and_routes_logs() {
        let body = render_unit(Path::new("/bin/x"), Path::new("/tmp/x.log"), true);
        assert!(body.contains("Environment=PATH="));
        assert!(body.contains("%h/.local/bin"));
        assert!(body.contains("/usr/local/bin"));
        assert!(body.contains("StandardOutput=append:/tmp/x.log"));
        assert!(body.contains("StandardError=append:/tmp/x.log"));
    }

    #[test]
    fn render_unit_has_no_linger_directive() {
        // We intentionally rely on the default (run-while-logged-in) semantics;
        // lingering would change that and must not creep in.
        let body = render_unit(Path::new("/bin/x"), Path::new("/tmp/x.log"), true);
        assert!(!body.to_lowercase().contains("linger"));
    }
}
