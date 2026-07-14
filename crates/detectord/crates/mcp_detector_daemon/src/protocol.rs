//! The daemon↔UI wire protocol: newline-delimited JSON over a Unix socket.
//!
//! The connecting OS user is derived from the socket's peer credentials
//! (`getpeereid`), never from the message — so a request is always scoped to
//! the uid the kernel reports, which the UI cannot spoof.

use serde::{Deserialize, Serialize};

use edison_detectord::ServerConfig;

fn default_true() -> bool {
    true
}

/// UI → daemon requests.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Request {
    /// Enroll this user (online handshake: validate key, cache policy + known set).
    Enroll {
        url: String,
        key: String,
        #[serde(default)]
        mcp_url: Option<String>,
        /// `None` keeps the previous selection; `Some` replaces it.
        #[serde(default)]
        agents: Option<Vec<String>>,
        /// `None` keeps the previous secret.
        #[serde(default)]
        secret: Option<String>,
        /// Apply the edison-watch install + hooks (default). Set false for a
        /// detect-only enrollment (caller does its own install).
        #[serde(default = "default_true")]
        install: bool,
        /// Arm automatic quarantine enforcement. `None` keeps the prior state;
        /// the UI sets `true` once onboarding completes so the daemon stays
        /// detect-only while the user is still reviewing during setup.
        #[serde(default)]
        armed: Option<bool>,
    },
    /// Enrollment + cached policy. `refresh` re-fetches the policy first.
    Status {
        #[serde(default)]
        refresh: bool,
    },
    /// Which agents (host apps) are present.
    ListAgents,
    /// Discovered servers, classified.
    ListServers,
    /// Dispose of a discovered server.
    Disposition {
        name: String,
        #[serde(default)]
        agent: Option<String>,
        choice: Choice,
        /// For SendToEw: submit under this name instead (rename-on-conflict).
        #[serde(default)]
        rename: Option<String>,
    },
    /// Force a policy + known-set refresh.
    RefreshPolicy,
    /// Verify an existing secret key; adopt (install) it if valid.
    VerifySecret { key: String },
    /// Destructively reset to a new secret key (deletes encrypted personal
    /// values), then install it. `confirm` must be true.
    ResetSecret {
        key: String,
        #[serde(default)]
        confirm: bool,
    },
    /// Remove this user's enrollment.
    Unenroll,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Choice {
    /// Submit to Edison Watch (register/request) + remove locally.
    SendToEw,
    /// Leave quarantined; don't re-prompt.
    Skip,
}

/// daemon → UI replies (a direct answer to a [`Request`]).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "reply", rename_all = "snake_case")]
pub enum Reply {
    Status(Status),
    // Struct-shaped (not `Vec` newtypes): an internally-tagged enum can't hold a
    // bare sequence.
    Agents { agents: Vec<AgentInfo> },
    Servers { servers: Vec<ServerView> },
    Secret(SecretOutcome),
    Ack,
    Error { message: String },
}

/// Outcome of a verify (`valid`/`expired` set) or reset (`deleted` set).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecretOutcome {
    #[serde(default)]
    pub valid: Option<bool>,
    #[serde(default)]
    pub expired: Option<bool>,
    #[serde(default)]
    pub deleted: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Status {
    pub user: String,
    pub enrolled: bool,
    pub org_id: Option<String>,
    pub org_name: Option<String>,
    pub email: Option<String>,
    pub role: Option<String>,
    pub quarantine: bool,
    pub quarantined_count: usize,
    /// Whether automatic quarantine enforcement is armed (onboarding complete).
    #[serde(default)]
    pub armed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentInfo {
    pub name: String,
    pub installed: bool,
}

/// One discovered server instance (not deduped — carries its source path).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerView {
    pub name: String,
    pub agent: String,
    /// `stdio` | `http` | `opaque`.
    pub kind: String,
    /// `edison` | `known` | `new` | `opaque` | `report`.
    pub state: String,
    pub fingerprint: Option<String>,
    pub path: String,
    /// The server's launch config, so a UI (e.g. onboarding) can render and act
    /// on it without re-discovering locally. `None` on older/omitted views.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub config: Option<ServerConfig>,
}

/// daemon → UI unsolicited pushes. (Delivery is wired with the supervisor;
/// defined here so the contract is fixed.)
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum Event {
    Quarantined(ServerView),
    Discovered(ServerView),
    PolicyChanged { quarantine: bool },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enroll_armed_defaults_to_none_and_parses() {
        // Onboarding completion arms enforcement.
        let r: Request =
            serde_json::from_str(r#"{"op":"enroll","url":"u","key":"k","armed":true}"#).unwrap();
        match r {
            Request::Enroll { armed, install, .. } => {
                assert_eq!(armed, Some(true));
                assert!(install, "install still defaults true");
            }
            other => panic!("wrong variant: {other:?}"),
        }
        // A base enroll (onboarding not complete) can omit it → None (keep prior).
        let r: Request = serde_json::from_str(r#"{"op":"enroll","url":"u","key":"k"}"#).unwrap();
        match r {
            Request::Enroll { armed, .. } => assert_eq!(armed, None),
            other => panic!("wrong variant: {other:?}"),
        }
    }

    #[test]
    fn disposition_parses_with_and_without_rename() {
        // Client sends a rename on conflict resubmit.
        let r: Request = serde_json::from_str(
            r#"{"op":"disposition","name":"foo","agent":"cursor","choice":"send_to_ew","rename":"foo2"}"#,
        )
        .unwrap();
        match r {
            Request::Disposition {
                name,
                agent,
                choice,
                rename,
            } => {
                assert_eq!(name, "foo");
                assert_eq!(agent.as_deref(), Some("cursor"));
                assert!(matches!(choice, Choice::SendToEw));
                assert_eq!(rename.as_deref(), Some("foo2"));
            }
            other => panic!("wrong variant: {other:?}"),
        }

        // Older / no-rename clients still parse (serde default).
        let r: Request =
            serde_json::from_str(r#"{"op":"disposition","name":"bar","choice":"skip"}"#).unwrap();
        match r {
            Request::Disposition { rename, choice, .. } => {
                assert!(rename.is_none());
                assert!(matches!(choice, Choice::Skip));
            }
            other => panic!("wrong variant: {other:?}"),
        }
    }
}
