//! The IPC control server: a Unix-domain socket on Unix, a named pipe on
//! Windows.
//!
//! On Unix each connection's OS user is taken from the socket's **peer
//! credentials** (`SO_PEERCRED` / `getpeereid`, via tokio's `peer_cred`), not
//! from anything the client sends, so every request is scoped to the
//! kernel-reported uid. On Windows the daemon runs per-user (a logon Scheduled
//! Task), so the peer is always the daemon's own user.
//!
//! Requests/replies are newline-delimited JSON; the daemon also pushes
//! [`Event`](crate::protocol::Event)s to a connection when they match its user.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::sync::broadcast;

use crate::ops;
use crate::protocol::{Reply, Request};
use crate::runner::EventTx;

// ── socket / pipe address ──────────────────────────────────────────────────

/// Default IPC address. A socket file under base_dir on Unix; a per-user named
/// pipe on Windows (pipes are machine-global, so namespace by user).
#[cfg(not(windows))]
pub fn default_socket_path() -> PathBuf {
    crate::paths::base_dir().join("daemon.sock")
}

#[cfg(windows)]
pub fn default_socket_path() -> PathBuf {
    PathBuf::from(format!(
        r"\\.\pipe\edison-detectord.{}",
        crate::paths::current_username()
    ))
}

// ── serve loop (transport-specific) ─────────────────────────────────────────

/// Serve the IPC endpoint at `path` until the process is stopped. `events` feeds
/// per-user pushes to connected clients.
#[cfg(unix)]
pub async fn serve(path: &Path, events: EventTx) -> anyhow::Result<()> {
    use tokio::net::UnixListener;

    crate::paths::ensure_base_dir()?;
    let _ = std::fs::remove_file(path); // a stale socket file blocks bind
    let listener = UnixListener::bind(path)?;
    tracing::info!(socket = %path.display(), "IPC listening");

    loop {
        let (stream, _addr) = listener.accept().await?;
        // Identity comes from the kernel peer creds, not the client.
        let Some(user) = stream
            .peer_cred()
            .ok()
            .and_then(|c| crate::platform::username_for_uid(c.uid()))
        else {
            tracing::warn!("could not resolve connection's peer user; dropping it");
            continue;
        };
        spawn_conn(stream, user, events.clone());
    }
}

#[cfg(windows)]
pub async fn serve(path: &Path, events: EventTx) -> anyhow::Result<()> {
    use tokio::net::windows::named_pipe::ServerOptions;

    crate::paths::ensure_base_dir()?;
    let name = path
        .to_str()
        .ok_or_else(|| anyhow::anyhow!("pipe name is not valid UTF-8: {}", path.display()))?;
    tracing::info!(pipe = %name, "IPC listening");

    // Always keep one server instance listening: on each connect, hand off the
    // connected instance and immediately create the next. `first_pipe_instance`
    // on the very first server refuses to bind if another process already owns
    // the name (anti-squat).
    let mut server = ServerOptions::new().first_pipe_instance(true).create(name)?;
    loop {
        server.connect().await?;
        let connected = server;
        server = ServerOptions::new().create(name)?;
        // Per-user daemon: the peer is this daemon's own user.
        spawn_conn(connected, crate::paths::current_username(), events.clone());
    }
}

// ── connection handling (transport-agnostic) ────────────────────────────────

fn spawn_conn<S>(stream: S, user: String, events: EventTx)
where
    S: AsyncRead + AsyncWrite + Send + 'static,
{
    tokio::spawn(async move {
        if let Err(e) = handle_conn(stream, user, events).await {
            tracing::debug!(error = %e, "connection ended");
        }
    });
}

async fn handle_conn<S>(stream: S, user: String, events: EventTx) -> anyhow::Result<()>
where
    S: AsyncRead + AsyncWrite + Send + 'static,
{
    tracing::debug!(%user, "connection");

    let (rd, mut wr) = tokio::io::split(stream);
    let mut lines = BufReader::new(rd).lines();
    let mut rx = events.subscribe();

    loop {
        tokio::select! {
            line = lines.next_line() => {
                match line? {
                    None => break, // client hung up
                    Some(l) if l.trim().is_empty() => continue,
                    Some(l) => {
                        let reply = match serde_json::from_str::<Request>(&l) {
                            Ok(req) => dispatch(&user, req).await,
                            Err(e) => Reply::Error { message: format!("bad request: {e}") },
                        };
                        write_json(&mut wr, &reply).await?;
                    }
                }
            }
            evt = rx.recv() => {
                match evt {
                    Ok((u, e)) if u == user => write_json(&mut wr, &e).await?,
                    Ok(_) => {}                                   // another user's event
                    Err(broadcast::error::RecvError::Lagged(_)) => {} // dropped some; fine
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        }
    }
    Ok(())
}

async fn write_json<W, T>(wr: &mut W, val: &T) -> anyhow::Result<()>
where
    W: AsyncWrite + Unpin,
    T: Serialize,
{
    let mut buf = serde_json::to_vec(val)?;
    buf.push(b'\n');
    wr.write_all(&buf).await?;
    Ok(())
}

async fn dispatch(user: &str, req: Request) -> Reply {
    let result: anyhow::Result<Reply> = async {
        Ok(match req {
            Request::Enroll {
                url,
                key,
                mcp_url,
                agents,
                secret,
                install,
                armed,
            } => Reply::Status(
                ops::enroll(user, url, key, mcp_url, agents, secret, install, armed).await?,
            ),
            Request::Status { refresh } => Reply::Status(if refresh {
                ops::refresh_policy(user).await?
            } else {
                ops::status(user)?
            }),
            Request::RefreshPolicy => Reply::Status(ops::refresh_policy(user).await?),
            Request::VerifySecret { key } => {
                let r = ops::verify_secret(user, key).await?;
                Reply::Secret(crate::protocol::SecretOutcome {
                    valid: Some(r.valid),
                    expired: Some(r.expired),
                    deleted: None,
                })
            }
            Request::ResetSecret { key, confirm } => {
                if !confirm {
                    Reply::Error {
                        message: "reset requires confirm=true (destructive)".into(),
                    }
                } else {
                    let r = ops::reset_secret(user, key).await?;
                    Reply::Secret(crate::protocol::SecretOutcome {
                        valid: None,
                        expired: None,
                        deleted: Some(r.deleted),
                    })
                }
            }
            Request::ListAgents => Reply::Agents {
                agents: ops::list_agents(),
            },
            Request::ListServers => Reply::Servers {
                servers: ops::list_servers(user)?,
            },
            Request::Disposition {
                name,
                agent,
                choice,
                rename,
            } => {
                ops::disposition(user, &name, agent.as_deref(), choice, rename.as_deref()).await?;
                Reply::Ack
            }
            Request::Unenroll => {
                ops::unenroll(user)?;
                Reply::Ack
            }
        })
    }
    .await;

    result.unwrap_or_else(|e| Reply::Error {
        message: format!("{e:#}"),
    })
}
