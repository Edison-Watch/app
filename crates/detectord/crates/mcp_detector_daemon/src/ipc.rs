//! Unix-domain-socket server. Accepts newline-delimited JSON requests and
//! pushes [`Message::Event`] notifications to every connected client.

use std::path::PathBuf;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::broadcast;
use tokio::task::JoinHandle;

use crate::app::SharedState;
use crate::protocol::{ErrorReply, Message, Request};

pub async fn serve(socket_path: PathBuf, shared: SharedState) -> std::io::Result<JoinHandle<()>> {
    if let Some(parent) = socket_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    // Best-effort cleanup of stale socket files.
    let _ = std::fs::remove_file(&socket_path);
    let listener = UnixListener::bind(&socket_path)?;
    set_socket_perms(&socket_path)?;
    tracing::info!(path = %socket_path.display(), "ipc listening");

    let handle = tokio::spawn(async move {
        loop {
            match listener.accept().await {
                Ok((stream, _addr)) => {
                    let shared = shared.clone();
                    tokio::spawn(async move {
                        if let Err(e) = handle_client(stream, shared).await {
                            tracing::debug!("client disconnected: {e}");
                        }
                    });
                }
                Err(e) => {
                    tracing::warn!("accept failed: {e}");
                    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                }
            }
        }
    });
    Ok(handle)
}

#[cfg(unix)]
fn set_socket_perms(path: &std::path::Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let perms = std::fs::Permissions::from_mode(0o600);
    std::fs::set_permissions(path, perms)
}

#[cfg(not(unix))]
fn set_socket_perms(_path: &std::path::Path) -> std::io::Result<()> {
    Ok(())
}

async fn handle_client(stream: UnixStream, shared: SharedState) -> std::io::Result<()> {
    let (read_half, write_half) = stream.into_split();
    let mut reader = BufReader::new(read_half);
    let writer = std::sync::Arc::new(tokio::sync::Mutex::new(write_half));

    let mut events_rx: broadcast::Receiver<Message> = shared.events.subscribe();
    let writer_for_pump = writer.clone();
    let pump = tokio::spawn(async move {
        loop {
            match events_rx.recv().await {
                Ok(msg) => {
                    if write_message(&writer_for_pump, &msg).await.is_err() {
                        break;
                    }
                }
                Err(broadcast::error::RecvError::Lagged(n)) => {
                    tracing::warn!("client lagged by {n} messages");
                }
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });

    let mut line = String::new();
    loop {
        line.clear();
        let n = reader.read_line(&mut line).await?;
        if n == 0 {
            break;
        }
        let trimmed = line.trim_end();
        if trimmed.is_empty() {
            continue;
        }
        let response = match serde_json::from_str::<Request>(trimmed) {
            Ok(req) => handle_request(req, &shared).await,
            Err(e) => Message::Error(ErrorReply {
                message: format!("bad request: {e}"),
            }),
        };
        write_message(&writer, &response).await?;
    }

    pump.abort();
    Ok(())
}

async fn handle_request(req: Request, shared: &SharedState) -> Message {
    match req {
        Request::Status => Message::Status(shared.snapshot_status().await),
        Request::RecheckFda => {
            // Non-blocking nudge to the supervisor.
            let _ = shared.recheck_tx.try_send(());
            Message::Ack
        }
    }
}

async fn write_message(
    writer: &std::sync::Arc<tokio::sync::Mutex<tokio::net::unix::OwnedWriteHalf>>,
    msg: &Message,
) -> std::io::Result<()> {
    let mut buf = serde_json::to_vec(msg).map_err(std::io::Error::other)?;
    buf.push(b'\n');
    let mut w = writer.lock().await;
    w.write_all(&buf).await?;
    w.flush().await
}
