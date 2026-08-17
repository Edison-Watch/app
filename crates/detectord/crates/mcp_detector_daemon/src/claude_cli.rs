//! Claude Code integration via its own `claude mcp` CLI. Claude Code misbehaves
//! if the sealgate entry is written directly rather than through the CLI, so
//! we shell out. Under root we drop to the target user first (setuid/setgid +
//! HOME) so `--scope user` writes *that user's* `~/.claude.json`, not root's.

use std::process::Command;

use anyhow::Context;

#[cfg(unix)]
use crate::{paths, platform};

/// `claude mcp add --transport http --scope user [--header …] sealgate <url>`.
pub fn install(user: &str, url: &str, secret: Option<&str>) -> anyhow::Result<()> {
    // `--header` is variadic, so it must come AFTER the <name> <url> positionals
    // or it greedily consumes them (matches the CLI's own help example).
    let mut args: Vec<String> = vec![
        "mcp".into(),
        "add".into(),
        "--transport".into(),
        "http".into(),
        "--scope".into(),
        "user".into(),
        "sealgate".into(),
        url.to_string(),
    ];
    if let Some(s) = secret {
        args.push("--header".into());
        args.push(format!("X-Edison-Secret-Key: {s}"));
    }
    run_as(user, &args)
}

/// Remove the sealgate entry from both user and project scope.
pub fn remove(user: &str) -> anyhow::Result<()> {
    let _ = run_as(
        user,
        &[
            "mcp".into(),
            "remove".into(),
            "sealgate".into(),
            "--scope".into(),
            "project".into(),
        ],
    );
    run_as(
        user,
        &[
            "mcp".into(),
            "remove".into(),
            "sealgate".into(),
            "--scope".into(),
            "user".into(),
        ],
    )
}

fn run_as(user: &str, args: &[String]) -> anyhow::Result<()> {
    let mut cmd = Command::new("claude");
    cmd.args(args);
    // The daemon is GUI-subsystem on Windows; suppress the console window a
    // console child (`claude`) would otherwise flash.
    no_window(&mut cmd);
    // When running as root, drop to the target user so the CLI writes into their
    // home. No-op in the user-mode dev build and on non-Unix (no root/setuid).
    drop_to_user(&mut cmd, user);

    let output = cmd.output().context("spawning `claude` CLI")?;
    if output.status.success() {
        Ok(())
    } else {
        anyhow::bail!(
            "`claude {}` failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr).trim()
        )
    }
}

/// Under root, set HOME/USER for the target user and `setuid`/`setgid` to them
/// in the child before exec, so the `claude` CLI writes into their home.
#[cfg(unix)]
fn drop_to_user(cmd: &mut Command, user: &str) {
    if paths::is_root()
        && let Some((uid, gid)) = platform::uid_gid_for(user)
    {
        if let Some(home) = platform::home_dir_for(user) {
            cmd.env("HOME", home);
        }
        cmd.env("USER", user);
        // SAFETY: pre_exec runs in the forked child before exec; only async-
        // signal-safe libc setgid/setuid calls, no allocation.
        unsafe {
            use std::os::unix::process::CommandExt;
            cmd.pre_exec(move || {
                if libc::setgid(gid) != 0 {
                    return Err(std::io::Error::last_os_error());
                }
                if libc::setuid(uid) != 0 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
    }
}

/// Non-Unix: the daemon already runs as the single logged-in user, so there is
/// nothing to drop to.
#[cfg(not(unix))]
fn drop_to_user(_cmd: &mut Command, _user: &str) {}

/// Windows: spawn the child with no console window (CREATE_NO_WINDOW), matching
/// the schtasks/whoami spawns and stdiod's behaviour.
#[cfg(windows)]
fn no_window(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn no_window(_cmd: &mut Command) {}
