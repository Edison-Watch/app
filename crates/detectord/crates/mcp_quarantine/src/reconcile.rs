//! The level-triggered reconcile planner — the pure heart of quarantine.
//!
//! Given the currently-*observed* servers, a "known" oracle, and the policy, it
//! returns the [`Action`]s to take. It performs **no IO**: the daemon executes
//! the actions (mutating configs via the writer, emitting pending events over
//! IPC). Being pure and level-triggered, it is exhaustively unit-testable and
//! inherently tamper-resistant — a restored server simply reappears in
//! `observed` next pass and is actioned again (design §8).

use mcp_detector_lib::{DiscoveredServer, ServerConfig, fingerprint};

/// Our own injected entry — never quarantine it.
const EDISON_SERVER_NAME: &str = "edison-watch";

/// Org policy governing the reconcile loop.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Policy {
    /// When `false` the loop is inert: discovery/report only, no mutation.
    pub quarantine: bool,
}

/// Answers "is this fingerprint already known to the backend?" — i.e.
/// registered/requested for this org, or actioned locally. In the daemon this
/// is backed by the root-owned seen-store (fed by backend sync + local
/// decisions); in tests it is any in-memory set.
pub trait KnownOracle {
    fn is_known(&self, fingerprint: &str) -> bool;
}

/// A single action the daemon should carry out for one server.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Action {
    /// Already known to the backend → quarantine silently (no user prompt).
    SilentQuarantine {
        server: DiscoveredServer,
        fingerprint: String,
    },
    /// Unknown → quarantine **first** (neutralise now), then prompt the user
    /// for disposition (send-to-EW / skip).
    QuarantineAndPrompt {
        server: DiscoveredServer,
        fingerprint: String,
    },
    /// Opaque but **removable** — remove it locally. It has no launch config,
    /// so it can't be fingerprinted or sent to EW; there's no disposition, just
    /// neutralisation (Cursor plugins, VSCode extension entries).
    RemoveOpaque { server: DiscoveredServer },
}

impl Action {
    /// The fingerprint this action targets, if any (`None` for opaque removals).
    pub fn fingerprint(&self) -> Option<&str> {
        match self {
            Action::SilentQuarantine { fingerprint, .. }
            | Action::QuarantineAndPrompt { fingerprint, .. } => Some(fingerprint),
            Action::RemoveOpaque { .. } => None,
        }
    }
}

/// Compute the actions for one reconcile pass.
///
/// Quarantine-first: every *actionable* server is removed; an unknown
/// fingerprint-able one is additionally surfaced for disposition. When
/// `policy.quarantine` is false the pass is inert. Skipped: our own injected
/// entry, and *untouchable* opaque servers (`removable == false`). A
/// **removable** opaque server is removed with no disposition ([`Action::RemoveOpaque`]).
pub fn plan(
    observed: &[DiscoveredServer],
    oracle: &dyn KnownOracle,
    policy: Policy,
) -> Vec<Action> {
    if !policy.quarantine {
        return Vec::new();
    }

    let mut actions = Vec::new();
    for server in observed {
        if is_edison_entry(server) {
            continue;
        }
        match &server.config {
            // Removable-locally-only: remove, no EW disposition.
            ServerConfig::Opaque {
                removable: true, ..
            } => actions.push(Action::RemoveOpaque {
                server: server.clone(),
            }),
            // Untouchable: report-only, never enforced.
            ServerConfig::Opaque {
                removable: false, ..
            } => continue,
            // Fingerprint-able (stdio/http): known → silent, unknown → prompt.
            _ => {
                let Some(fp) = fingerprint(&server.name, &server.config) else {
                    continue; // malformed (empty command/url)
                };
                actions.push(if oracle.is_known(&fp) {
                    Action::SilentQuarantine {
                        server: server.clone(),
                        fingerprint: fp,
                    }
                } else {
                    Action::QuarantineAndPrompt {
                        server: server.clone(),
                        fingerprint: fp,
                    }
                });
            }
        }
    }
    actions
}

/// Whether this is our own injected `edison-watch` entry (never quarantined).
pub fn is_edison_entry(server: &DiscoveredServer) -> bool {
    server.name == EDISON_SERVER_NAME
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use std::collections::HashSet;
    use std::path::PathBuf;

    use mcp_detector_lib::{
        ConfigLocation, LocationExtra, OpaqueReason, Scope, ServerConfig, SourceKind, Transport,
    };

    fn opaque(removable: bool) -> ServerConfig {
        ServerConfig::Opaque {
            removable,
            reason: OpaqueReason::CursorPlugin,
        }
    }

    struct Known(HashSet<String>);
    impl KnownOracle for Known {
        fn is_known(&self, fingerprint: &str) -> bool {
            self.0.contains(fingerprint)
        }
    }

    fn known(fps: &[&str]) -> Known {
        Known(fps.iter().map(|s| s.to_string()).collect())
    }

    fn server(name: &str, config: ServerConfig) -> DiscoveredServer {
        DiscoveredServer {
            client: "test",
            name: name.into(),
            transport: Transport::Stdio,
            scope: Scope::Global,
            config,
            location: ConfigLocation {
                kind: SourceKind::Jsonc,
                path: PathBuf::from("/tmp/x.json"),
                key_path: vec!["mcpServers".into()],
                server_key: name.into(),
                extra: LocationExtra::None,
            },
        }
    }

    fn stdio(command: &str, args: &[&str]) -> ServerConfig {
        ServerConfig::Stdio {
            command: command.into(),
            args: args.iter().map(|s| s.to_string()).collect(),
            env: BTreeMap::new(),
        }
    }

    const ON: Policy = Policy { quarantine: true };
    const OFF: Policy = Policy { quarantine: false };

    #[test]
    fn off_policy_is_inert() {
        let obs = vec![server("a", stdio("x", &[]))];
        assert!(plan(&obs, &known(&[]), OFF).is_empty());
    }

    #[test]
    fn unknown_server_is_quarantined_and_prompted() {
        let obs = vec![server("a", stdio("x", &[]))];
        let actions = plan(&obs, &known(&[]), ON);
        assert!(matches!(actions[..], [Action::QuarantineAndPrompt { .. }]));
    }

    #[test]
    fn known_server_is_silently_quarantined() {
        let s = server("a", stdio("x", &[]));
        let fp = fingerprint(&s.name, &s.config).unwrap();
        let actions = plan(&[s], &known(&[&fp]), ON);
        assert!(matches!(actions[..], [Action::SilentQuarantine { .. }]));
    }

    #[test]
    fn edison_entry_is_skipped() {
        let obs = vec![server("edison-watch", stdio("x", &[]))];
        assert!(plan(&obs, &known(&[]), ON).is_empty());
    }

    #[test]
    fn untouchable_opaque_server_is_skipped() {
        let obs = vec![server("ext", opaque(false))];
        assert!(plan(&obs, &known(&[]), ON).is_empty());
    }

    #[test]
    fn removable_opaque_server_is_removed() {
        let obs = vec![server("plugin", opaque(true))];
        let actions = plan(&obs, &known(&[]), ON);
        assert!(matches!(actions[..], [Action::RemoveOpaque { .. }]));
    }

    #[test]
    fn mixed_batch_routes_each_server() {
        let unknown = server("u", stdio("a", &[]));
        let known_srv = server("k", stdio("b", &[]));
        let kfp = fingerprint(&known_srv.name, &known_srv.config).unwrap();
        let actions = plan(&[unknown, known_srv], &known(&[&kfp]), ON);
        assert_eq!(actions.len(), 2);
        assert!(matches!(actions[0], Action::QuarantineAndPrompt { .. }));
        assert!(matches!(actions[1], Action::SilentQuarantine { .. }));
    }
}
