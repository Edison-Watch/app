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
        /// For SendToEw: submit THIS config verbatim instead of the
        /// discovered/stored one. It is the client's authoritative
        /// credential-review result (already redacted per the user's choices, and
        /// NOT auto-templatized again — so a value the user left unmarked is sent
        /// as-is). `None` = auto-templatize the discovered/stored config. The
        /// locally retained raw config (for secret injection) is unaffected.
        #[serde(default)]
        submit_config: Option<ServerConfig>,
        /// For SendToEw: register directly (`Some(true)`) or leave the request
        /// pending approval (`Some(false)`), overriding the role-derived
        /// default. The UI offers an admin both, so their explicit choice has
        /// to survive the trip.
        #[serde(default)]
        register: Option<bool>,
    },
    /// Install the `edison-watch` entry + hooks for these agents (additive: the
    /// agents join the enrolled selection). The daemon is the only component
    /// that writes agent configs.
    ApplyIntegrations { agents: Vec<String> },
    /// Remove the `edison-watch` entry for these agents.
    RevertIntegrations { agents: Vec<String> },
    /// The text of an agent's user-scope config file, for display.
    ReadConfig { agent: String },
    /// Put quarantined servers back: one by name/fingerprint, or all of them.
    RestoreQuarantined {
        #[serde(default)]
        name: Option<String>,
    },
    /// Record a submit the CALLER performed against the backend, so the daemon's
    /// seen-store stays the single source of truth for what's known.
    MarkSeen {
        name: String,
        #[serde(default)]
        agent: Option<String>,
        /// `registered` | `requested` | `dismissed`.
        status: String,
    },
    /// Remove a discovered server from its local config, leaving seen-state
    /// alone. For callers that already submitted the server and marked it seen
    /// themselves and only need the local entry gone; `disposition` is the op
    /// that submits *and* records an outcome. Removal goes through the same
    /// writer, so Claude Code project scope, Cursor plugin dirs and the state
    /// DBs are all handled, and the entry stays restorable.
    RemoveLocal {
        name: String,
        #[serde(default)]
        agent: Option<String>,
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
    Agents {
        agents: Vec<AgentInfo>,
    },
    Servers {
        servers: Vec<ServerView>,
    },
    Secret(SecretOutcome),
    Integrations {
        changes: Vec<IntegrationChange>,
    },
    Config {
        path: String,
        content: Option<String>,
    },
    Restored {
        restored: u32,
        errors: Vec<String>,
    },
    Ack,
    Error {
        message: String,
    },
}

/// The outcome of installing or removing the `edison-watch` entry for one agent.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IntegrationChange {
    pub agent: String,
    /// The config file written, when there was one (Claude Code goes through
    /// its CLI, which owns the path).
    pub path: Option<String>,
    /// The backup taken before the first edit of that file, if any.
    pub backup_path: Option<String>,
    pub ok: bool,
    #[serde(default)]
    pub error: Option<String>,
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
    /// Hook bindings this agent has, and how many are already injected. The
    /// counts come from the same presence checks the injector uses, so the UI
    /// never has to open an agent's hook file to report coverage.
    #[serde(default)]
    pub hooks_total: u32,
    #[serde(default)]
    pub hooks_installed: u32,
    /// The URL of the installed `edison-watch` entry, or `None` when the agent
    /// has no entry. The UI compares it with the URL it expects instead of
    /// reading and parsing the agent's config itself.
    #[serde(default)]
    pub edison_url: Option<String>,
    /// The agent's user-scope config file, so the UI can name it (and ask for
    /// its contents via `read_config`) without resolving paths of its own.
    #[serde(default)]
    pub config_path: Option<String>,
    /// Workspace-level hook targets this agent has (e.g. one `.vscode/tasks.json`
    /// per enumerated VSCode workspace), and how many already carry the Edison
    /// Watch task. The UI renders hook coverage from these instead of walking
    /// the user's project directories itself. Zero for agents with no
    /// workspace hook surface.
    #[serde(default)]
    pub workspace_hooks_total: u32,
    #[serde(default)]
    pub workspace_hooks_installed: u32,
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
                submit_config,
                register,
            } => {
                assert_eq!(name, "foo");
                assert_eq!(agent.as_deref(), Some("cursor"));
                assert!(matches!(choice, Choice::SendToEw));
                assert_eq!(rename.as_deref(), Some("foo2"));
                assert!(submit_config.is_none());
                assert_eq!(register, None, "absent register defers to the role");
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

        // A client-supplied submit_config (credential-review override) parses.
        let r: Request = serde_json::from_str(
            r#"{"op":"disposition","name":"foo","choice":"send_to_ew","submit_config":{"Stdio":{"command":"npx","args":["-y","{TOKEN}"],"env":{}}}}"#,
        )
        .unwrap();
        match r {
            Request::Disposition { submit_config, .. } => {
                assert!(submit_config.is_some());
            }
            other => panic!("wrong variant: {other:?}"),
        }
    }
}
