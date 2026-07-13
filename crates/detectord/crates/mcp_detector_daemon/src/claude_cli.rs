//! Claude Code integration via its own `claude mcp` CLI. Claude Code misbehaves
//! if the edison-watch entry is written directly rather than through the CLI, so
//! we shell out. Under root we drop to the target user first (setuid/setgid +
//! HOME) so `--scope user` writes *that user's* `~/.claude.json`, not root's.

use std::process::Command;

use anyhow::Context;

use crate::{paths, platform};

/// `claude mcp add --transport http --scope user [--header …] edison-watch <url>`.
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
        "edison-watch".into(),
        url.to_string(),
    ];
    if let Some(s) = secret {
        args.push("--header".into());
        args.push(format!("X-Edison-Secret-Key: {s}"));
    }
    run_as(user, &args)
}

/// Remove the edison-watch entry from both user and project scope.
pub fn remove(user: &str) -> anyhow::Result<()> {
    let _ = run_as(
        user,
        &[
            "mcp".into(),
            "remove".into(),
            "edison-watch".into(),
            "--scope".into(),
            "project".into(),
        ],
    );
    run_as(
        user,
        &[
            "mcp".into(),
            "remove".into(),
            "edison-watch".into(),
            "--scope".into(),
            "user".into(),
        ],
    )
}

fn run_as(user: &str, args: &[String]) -> anyhow::Result<()> {
    let mut cmd = Command::new("claude");
    cmd.args(args);

    // When running as root, drop to the target user so the CLI writes into their
    // home. In the user-mode dev build this branch is skipped.
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
