//! The Unix-socket IPC server.
//!
//! Each connection's OS user is taken from the socket's **peer credentials**
//! (`SO_PEERCRED` / `getpeereid`, via tokio's `peer_cred`), not from anything
//! the client sends — so every request is scoped to the kernel-reported uid.
//! Requests/replies are newline-delimited JSON; the daemon also pushes
//! [`Event`]s to a connection when they match its peer user.

use std::path::{Path, PathBuf};

use serde::Serialize;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream, unix::OwnedWriteHalf};
use tokio::sync::broadcast;

use crate::ops;
use crate::platform;
use crate::protocol::{Reply, Request};
use crate::runner::EventTx;

/// Default socket path (dev). The root build will use `/var/run/...`.
pub fn default_socket_path() -> PathBuf {
    crate::paths::base_dir().join("daemon.sock")
}

/// Serve the IPC socket at `path` until the process is stopped. `events` feeds
/// per-user pushes to connected clients.
pub async fn serve(path: &Path, events: EventTx) -> anyhow::Result<()> {
    crate::paths::ensure_base_dir()?;
    let _ = std::fs::remove_file(path); // a stale socket file blocks bind
    let listener = UnixListener::bind(path)?;
    tracing::info!(socket = %path.display(), "IPC listening");

    loop {
        let (stream, _addr) = listener.accept().await?;
        let events = events.clone();
        tokio::spawn(async move {
            if let Err(e) = handle_conn(stream, events).await {
                tracing::debug!(error = %e, "connection ended");
            }
        });
    }
}

async fn handle_conn(stream: UnixStream, events: EventTx) -> anyhow::Result<()> {
    // Identity comes from the kernel, not the client.
    let uid = stream.peer_cred()?.uid();
    let user =
        platform::username_for_uid(uid).ok_or_else(|| anyhow::anyhow!("unknown uid {uid}"))?;
    tracing::debug!(uid, %user, "connection");

    let (rd, mut wr) = stream.into_split();
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

async fn write_json<T: Serialize>(wr: &mut OwnedWriteHalf, val: &T) -> anyhow::Result<()> {
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
