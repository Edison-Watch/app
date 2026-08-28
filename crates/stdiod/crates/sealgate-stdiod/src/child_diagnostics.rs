//! Per-child diagnostics: the stderr tail that turns a dead subprocess into
//! an actionable error, the one-shot latches that decide who reports it, and
//! the `state.json` write that marks the child crashed.
//!
//! Split out of `proc.rs` to keep that file within the repository's
//! file-size limit; `proc.rs` owns the process and its pumps, this module
//! owns what the daemon says about a child that has stopped working.

use std::collections::VecDeque;
use std::process::ExitStatus;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use sealgate_tunnel_protocol::TunnelError;
use tokio::sync::Notify;

use crate::state::{ServerEntry, ServerStatus, StateWriter};

const STDERR_TAIL_MAX_LINES: usize = 20;
const STDERR_TAIL_MAX_BYTES: usize = 8 * 1024;
const STDERR_LINE_MAX_CHARS: usize = 500;

#[derive(Clone, Default)]
pub(crate) struct ChildDiagnostics {
    stderr_tail: Arc<Mutex<VecDeque<String>>>,
    sensitive_values: Arc<Vec<String>>,
    /// "Terminal for MCP purposes": some path gave up on this child, so the
    /// backend has been told the server is offline and the supervisor should
    /// replace it. A child whose stdin broke while the process is still
    /// running counts, because nothing can be delivered to it any more.
    pub(crate) exited: Arc<AtomicBool>,
    /// The process itself was seen to be gone: a `try_wait` returned an exit
    /// status, or `shutdown` reaped it. This is the only thing that may be
    /// reported as `crashed`, so a live-but-unreachable child is never shown
    /// as crashed next to its own live PID.
    observed_exit: Arc<AtomicBool>,
    reported: Arc<AtomicBool>,
    /// Set once a terminal report has actually been queued on the outbound
    /// channel. `reported` says a path took ownership of the report;
    /// this says the wire has it. Nothing awaits between the send completing
    /// and this store, so a cancelled pump can never leave the pair
    /// disagreeing, which is what lets `shutdown` decide whether it has to
    /// send the report itself.
    pub(crate) report_sent: Arc<AtomicBool>,
    /// One-shot guard so a single death produces a single `crashed` write,
    /// whichever pump gets there first.
    crash_published: Arc<AtomicBool>,
    stderr_done: Arc<AtomicBool>,
    stderr_done_notify: Arc<Notify>,
    /// Where to mark this child `crashed` in `state.json` the moment a pump
    /// observes it die. The supervisor recomputes the whole `servers` array
    /// from [`ChildServer::has_exited`] on its next mutation anyway; this is
    /// what makes the transition visible to the tray *between* mutations,
    /// which are rare. `None` in tests and wherever no writer exists.
    state: Option<StateWriter>,
    /// The PID this child was spawned with, used to address the right
    /// `state.json` entry: a respawn reuses the server name, so the name
    /// alone would let a late report from a dead child mark its healthy
    /// replacement as crashed.
    pid: Option<u32>,
}

impl ChildDiagnostics {
    pub(crate) fn new(values: impl IntoIterator<Item = String>) -> Self {
        let mut sensitive_values: Vec<String> = values
            .into_iter()
            .filter(|value| value.len() >= 4)
            .collect();
        sensitive_values.sort();
        sensitive_values.dedup();
        sensitive_values.sort_by_key(|value| std::cmp::Reverse(value.len()));
        Self {
            sensitive_values: Arc::new(sensitive_values),
            ..Self::default()
        }
    }

    /// Attach the `state.json` writer and the spawned PID so a death is
    /// published as soon as it is observed.
    pub(crate) fn publishing_to(mut self, state: Option<StateWriter>, pid: Option<u32>) -> Self {
        self.state = state;
        self.pid = pid;
        self
    }

    /// Record that the process itself is gone. Only an exit status (or a
    /// reap in [`ChildServer::shutdown`]) may set this.
    pub(crate) fn mark_observed_exit(&self) {
        self.observed_exit.store(true, Ordering::Release);
    }

    pub(crate) fn has_observed_exit(&self) -> bool {
        self.observed_exit.load(Ordering::Acquire)
    }

    /// Whether a terminal report has reached the outbound channel.
    pub(crate) fn report_sent(&self) -> bool {
        self.report_sent.load(Ordering::Acquire)
    }

    /// Flip this child's `state.json` entry to `crashed`, once, and only for
    /// a process that was seen to exit.
    ///
    /// The `reported` latch is deliberately not reused as the guard here.
    /// It answers a different question ("has the backend been told this
    /// server is offline?") and a broken stdin consumes it while the process
    /// is still alive; a later, genuine exit still has to reach `state.json`.
    /// No-op when no writer is attached or the entry has already been
    /// replaced by a respawn.
    pub(crate) async fn publish_crashed(&self, server_id: &str) {
        if !self.has_observed_exit() {
            return;
        }
        if self.crash_published.swap(true, Ordering::AcqRel) {
            return;
        }
        let Some(state) = self.state.clone() else {
            return;
        };
        let pid = self.pid;
        let server_id = server_id.to_string();
        state
            .update(move |s| {
                mark_entry_crashed(&mut s.servers, &server_id, pid);
            })
            .await;
    }

    pub(crate) fn record_stderr(&self, line: &str) -> Option<String> {
        let mut line = line.to_string();
        for sensitive in self.sensitive_values.iter() {
            line = line.replace(sensitive, "[redacted]");
        }
        let line = sanitize_diagnostic_line(&line)?;
        let mut tail = self
            .stderr_tail
            .lock()
            .expect("child diagnostics mutex poisoned");
        tail.push_back(line.clone());
        while tail.len() > STDERR_TAIL_MAX_LINES
            || tail.iter().map(String::len).sum::<usize>() > STDERR_TAIL_MAX_BYTES
        {
            tail.pop_front();
        }
        Some(line)
    }

    pub(crate) fn mark_stderr_done(&self) {
        self.stderr_done.store(true, Ordering::Release);
        self.stderr_done_notify.notify_waiters();
    }

    pub(crate) async fn wait_for_stderr(&self) {
        let notified = self.stderr_done_notify.notified();
        if self.stderr_done.load(Ordering::Acquire) {
            return;
        }
        let _ = tokio::time::timeout(Duration::from_millis(100), notified).await;
    }

    pub(crate) fn terminal_error(
        &self,
        server_id: &str,
        status: Option<&ExitStatus>,
    ) -> TunnelError {
        self.exited.store(true, Ordering::Release);
        let mut message = match status.and_then(ExitStatus::code) {
            Some(code) => format!("Local MCP process exited with code {code}."),
            None => "Local MCP process exited.".to_string(),
        };
        let tail = self
            .stderr_tail
            .lock()
            .expect("child diagnostics mutex poisoned");
        if !tail.is_empty() {
            message.push_str("\nLast output:\n");
            message.push_str(&tail.iter().cloned().collect::<Vec<_>>().join("\n"));
        }
        TunnelError {
            server_id: Some(server_id.to_string()),
            related_jsonrpc_id: None,
            code: "server_offline".into(),
            message,
        }
    }

    pub(crate) fn take_terminal_error(
        &self,
        server_id: &str,
        status: Option<&ExitStatus>,
    ) -> Option<TunnelError> {
        if self.reported.swap(true, Ordering::AcqRel) {
            self.exited.store(true, Ordering::Release);
            return None;
        }
        Some(self.terminal_error(server_id, status))
    }
}

/// Mark the `state.json` entry for `server_id` as crashed, but only while it
/// still describes the process that died. A child that has been respawned
/// under the same name carries a different PID, and its entry MUST be left
/// alone. Returns whether an entry was updated.
pub(crate) fn mark_entry_crashed(
    servers: &mut [ServerEntry],
    server_id: &str,
    pid: Option<u32>,
) -> bool {
    let Some(entry) = servers
        .iter_mut()
        .find(|entry| entry.name == server_id && entry.pid == pid)
    else {
        return false;
    };
    entry.state = ServerStatus::Crashed;
    true
}

pub(crate) fn sanitize_diagnostic_line(line: &str) -> Option<String> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }
    let lower = trimmed.to_ascii_lowercase();
    let has_credential = [
        "authorization",
        "bearer ",
        "token",
        "secret",
        "password",
        "api_key",
        "apikey",
        "api-key",
        "cookie",
        "credential",
        "private key",
        "access_key",
        "access-key",
        "session_key",
        "ghp_",
        "github_pat_",
        "sk-proj-",
        "xoxb-",
        "xoxp-",
    ]
    .iter()
    .any(|marker| lower.contains(marker));
    if has_credential {
        return Some("[redacted potentially sensitive output]".into());
    }
    let has_url_userinfo = trimmed.find("://").is_some_and(|scheme_end| {
        trimmed[scheme_end + 3..]
            .split(['/', ' ', '\t'])
            .next()
            .is_some_and(|authority| authority.contains('@'))
    });
    let looks_like_jwt = trimmed.contains("eyJ") && trimmed.matches('.').count() >= 2;
    if has_url_userinfo || looks_like_jwt {
        return Some("[redacted potentially sensitive output]".into());
    }
    if trimmed.contains("://") && trimmed.contains('?') {
        return Some("[redacted URL containing query parameters]".into());
    }
    Some(trimmed.chars().take(STDERR_LINE_MAX_CHARS).collect())
}
