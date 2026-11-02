//! `setup approve`: get Beeper's "Allow" for SealGate.
//!
//! Spawns Beeper's proxy the way the daemon will, sends one MCP `initialize`,
//! and waits for the reply, which only comes once the person has clicked Allow
//! in Beeper's pop-up. Beeper caches the grant per user, so the daemon's own
//! child reuses it. The daemon is then restarted: a child it started while the
//! approval was pending defers to ours and freezes once ours exits.

use std::process::Stdio;
use std::time::{Duration, Instant};

use anyhow::{anyhow, Result};
use serde_json::json;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::mpsc;

use super::report::Reporter;
use super::{beeper, EXIT_NOT_YET, EXIT_OK};

const INITIALIZE: &str = r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"sealgate-stdiod-setup","version":"1.0.0"}}}"#;

enum Line {
    Out(String),
    Err(String),
}

pub async fn run(rep: &Reporter, timeout: Duration) -> Result<i32> {
    let Some(base) = beeper::api_base().await else {
        rep.warn("Beeper is not answering on this computer yet, so there is nothing to allow");
        rep.action("open Beeper, sign in, and turn on Settings > Developers > MCP");
        rep.result(json!({ "approved": false, "beeper_running": false }));
        return Ok(EXIT_NOT_YET);
    };
    let mut args = vec!["-y".to_string(), beeper::MCP_PKG.to_string()];
    if let Some(endpoint) = beeper::mcp_endpoint(&base) {
        args.push(endpoint);
    }
    let mut cmd = crate::proc::build_child_command("npx", &args);
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(unix)]
    cmd.process_group(0);
    let mut child = cmd
        .spawn()
        .map_err(|e| anyhow!("could not start npx (is Node installed?): {e}"))?;
    let pid = child.id();

    let mut stdin = child.stdin.take().ok_or_else(|| anyhow!("no stdin"))?;
    stdin
        .write_all(format!("{INITIALIZE}\n").as_bytes())
        .await?;
    stdin.flush().await?;
    // stdin stays open while waiting: closing it would wind the proxy down.

    let (tx, mut rx) = mpsc::unbounded_channel();
    if let Some(out) = child.stdout.take() {
        let tx = tx.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(out).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = tx.send(Line::Out(line));
            }
        });
    }
    if let Some(err) = child.stderr.take() {
        tokio::spawn(async move {
            let mut lines = BufReader::new(err).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = tx.send(Line::Err(line));
            }
        });
    }

    rep.action("Beeper is opening a pop-up asking you to allow access. Click Allow.");
    rep.info(
        "if you don't see the Beeper approval pop-up, check whether it is behind other windows",
    );
    let started = Instant::now();
    let deadline = started + timeout;
    let mut approved = false;
    let mut auth_url_shown = false;
    let mut last_errors: Vec<String> = Vec::new();
    let mut tick = tokio::time::interval(Duration::from_secs(30));
    tick.tick().await;
    loop {
        tokio::select! {
            line = rx.recv() => match line {
                Some(Line::Out(l)) if l.contains("\"result\"") => { approved = true; break; }
                Some(Line::Out(_)) => {}
                Some(Line::Err(l)) => {
                    if !auth_url_shown {
                        if let Some(url) = authorize_url(&l) {
                            auth_url_shown = true;
                            rep.action(&format!("no pop-up? open this link in a browser to allow access: {url}"));
                        }
                    }
                    if is_error_line(&l) {
                        last_errors.push(l);
                        if last_errors.len() > 2 { last_errors.remove(0); }
                    }
                }
                // Both pipes closed: the proxy exited without answering.
                None => break,
            },
            _ = tick.tick() => {
                let left = deadline.saturating_duration_since(Instant::now()).as_secs();
                rep.info(&format!("still waiting for you to click Allow in the Beeper pop-up ({left}s left)"));
            }
            _ = tokio::time::sleep_until(deadline.into()) => break,
        }
    }

    drop(stdin);
    stop_tree(&mut child, pid).await;

    if !approved {
        rep.warn(&format!(
            "you didn't allow access in Beeper within {}s, so SealGate can't read your Beeper chats yet",
            timeout.as_secs()
        ));
        rep.info("the pop-up was probably hidden behind your other windows");
        if !last_errors.is_empty() {
            rep.info(&format!("technical detail: {}", last_errors.join(" ")));
        }
        rep.result(json!({ "approved": false, "beeper_running": true }));
        return Ok(EXIT_NOT_YET);
    }
    if started.elapsed() <= Duration::from_secs(3) {
        rep.ok("Beeper had already allowed SealGate");
    } else {
        rep.ok("Beeper allowed SealGate");
    }
    let restarted = restart_daemon(rep);
    rep.result(json!({ "approved": true, "daemon_restarted": restarted }));
    Ok(EXIT_OK)
}

/// Restart the daemon when its supervisor unit exists, so its Beeper child
/// starts over with the approval in place.
fn restart_daemon(rep: &Reporter) -> bool {
    if !crate::platform::is_installed().unwrap_or(false) {
        return false;
    }
    match crate::platform::restart() {
        Ok(()) => {
            rep.ok("restarted the daemon so it connects to Beeper with the approval");
            true
        }
        Err(e) => {
            rep.warn(&format!("could not restart the daemon: {e}"));
            rep.action("run: sealgate-stdiod restart");
            false
        }
    }
}

/// Stop the proxy and everything it started (cmd, npx, node).
async fn stop_tree(child: &mut tokio::process::Child, pid: Option<u32>) {
    if let Some(pid) = pid {
        #[cfg(windows)]
        {
            let _ = tokio::process::Command::new("taskkill")
                .args(["/pid", &pid.to_string(), "/t", "/f"])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .await;
        }
        #[cfg(unix)]
        {
            // The child leads its own process group (process_group(0)).
            let _ = tokio::process::Command::new("kill")
                .args(["-TERM", &format!("-{pid}")])
                .status()
                .await;
        }
    }
    if tokio::time::timeout(Duration::from_secs(3), child.wait())
        .await
        .is_err()
    {
        let _ = child.kill().await;
    }
}

/// The OAuth authorize URL the proxy prints when it cannot open a browser.
fn authorize_url(line: &str) -> Option<&str> {
    let start = line.find("http://").or_else(|| line.find("https://"))?;
    let url = line[start..]
        .split(|c: char| c.is_whitespace() || c == '"' || c == '\'')
        .next()?;
    url.contains("authorize").then_some(url)
}

/// The proxy's stderr ends in a stack trace; keep its error lines, not frames.
fn is_error_line(line: &str) -> bool {
    let t = line.trim();
    !t.is_empty() && !t.starts_with("at ") && !t.starts_with('{') && !t.starts_with('}')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_authorize_url() {
        assert_eq!(
            authorize_url("Please authorize: http://127.0.0.1:23373/oauth/authorize?x=1 now"),
            Some("http://127.0.0.1:23373/oauth/authorize?x=1")
        );
        assert_eq!(
            authorize_url("connected to http://127.0.0.1:23373/v0/mcp"),
            None
        );
        assert_eq!(authorize_url("no url here"), None);
    }

    #[test]
    fn stack_frames_are_not_error_lines() {
        assert!(is_error_line("Error: connect ECONNREFUSED 127.0.0.1:23373"));
        assert!(!is_error_line(
            "    at TCPConnectWrap.afterConnect (node:net:1555:16)"
        ));
        assert!(!is_error_line("  {"));
        assert!(!is_error_line(""));
    }
}
