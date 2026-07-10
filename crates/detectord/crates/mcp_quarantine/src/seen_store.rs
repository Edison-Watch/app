//! The persistent, org-scoped "known" oracle.
//!
//! Records which server fingerprints the daemon has already dealt with — either
//! because the backend reported them (`registered`/`requested`) or because the
//! user made a local decision (`requested`/`dismissed`/`registered`). The
//! [reconcile planner](crate::reconcile) consults it to choose *silent* removal
//! vs. *prompt*; a fingerprint it has never seen is unknown and gets prompted.
//!
//! Entries are keyed by `"<org_id>:<fingerprint>"` so the same server tracked
//! across org switches stays separate. In the daemon this file is root-owned
//! and tamper-resistant; in tests it is any path in a tempdir.
//!
//! The store is bound to a single `org_id` (the enrolled user's org); all reads
//! and writes are scoped to it.

use std::collections::HashSet;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::reconcile::KnownOracle;

/// How a fingerprint became known.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Action {
    /// Approved server (backend `registered`, or admin/owner added it).
    Registered,
    /// Pending admin review (user requested access).
    Requested,
    /// User skipped — stays quarantined, re-quarantined silently on reappearance.
    Dismissed,
    /// Auto-quarantined without an explicit user decision.
    Quarantined,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
struct SeenServer {
    org_id: String,
    fingerprint: String,
    name: String,
    action: Action,
    /// True when sourced from a backend sync (vs. a local decision). Governs
    /// pruning: only backend-sourced entries are pruned when they vanish from
    /// the backend; local decisions (e.g. `dismissed`) are preserved.
    from_backend: bool,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct StoreData {
    /// Keyed by `"<org_id>:<fingerprint>"`.
    servers: std::collections::BTreeMap<String, SeenServer>,
}

/// Persistent, org-scoped record of dealt-with fingerprints.
#[derive(Debug)]
pub struct SeenStore {
    path: PathBuf,
    org_id: String,
    data: StoreData,
}

impl SeenStore {
    /// Open (or initialise) the store at `path`, scoped to `org_id`. A missing
    /// file yields an empty store; a malformed one is an error.
    pub fn open(path: impl Into<PathBuf>, org_id: impl Into<String>) -> Result<Self> {
        let path = path.into();
        let data = if path.exists() {
            let raw = std::fs::read_to_string(&path).map_err(|source| Error::Io {
                path: path.clone(),
                source,
            })?;
            serde_json::from_str(&raw).map_err(|e| Error::Json {
                path: path.clone(),
                message: e.to_string(),
            })?
        } else {
            StoreData::default()
        };
        Ok(Self {
            path,
            org_id: org_id.into(),
            data,
        })
    }

    fn key(&self, fingerprint: &str) -> String {
        format!("{}:{}", self.org_id, fingerprint)
    }

    /// Record a *local* decision (from a user disposition).
    pub fn mark(&mut self, fingerprint: &str, name: &str, action: Action) -> Result<()> {
        self.upsert(fingerprint, name, action, false)
    }

    /// Record an entry learned from a *backend* sync.
    pub fn mark_from_backend(
        &mut self,
        fingerprint: &str,
        name: &str,
        action: Action,
    ) -> Result<()> {
        self.upsert(fingerprint, name, action, true)
    }

    fn upsert(
        &mut self,
        fingerprint: &str,
        name: &str,
        action: Action,
        from_backend: bool,
    ) -> Result<()> {
        self.data.servers.insert(
            self.key(fingerprint),
            SeenServer {
                org_id: self.org_id.clone(),
                fingerprint: fingerprint.to_string(),
                name: name.to_string(),
                action,
                from_backend,
            },
        );
        self.save()
    }

    /// Drop backend-sourced entries for this org whose fingerprint is no longer
    /// in `synced` (the latest backend set). **Local-only** entries (e.g. a
    /// `dismissed` skip) are preserved so skipped servers don't re-prompt.
    pub fn prune_backend(&mut self, synced: &HashSet<String>) -> Result<()> {
        let prefix = format!("{}:", self.org_id);
        self.data.servers.retain(|key, entry| {
            let ours = key.starts_with(&prefix);
            !(ours && entry.from_backend && !synced.contains(&entry.fingerprint))
        });
        self.save()
    }

    fn save(&self) -> Result<()> {
        let raw = serde_json::to_string_pretty(&self.data).map_err(|e| Error::Json {
            path: self.path.clone(),
            message: e.to_string(),
        })?;
        std::fs::write(&self.path, raw).map_err(|source| Error::Io {
            path: self.path.clone(),
            source,
        })
    }

    /// Whether this fingerprint is known for the bound org.
    pub fn contains(&self, fingerprint: &str) -> bool {
        self.data.servers.contains_key(&self.key(fingerprint))
    }

    /// Forget a fingerprint for the bound org (used by a dev restore so the
    /// server isn't immediately re-quarantined). No-op if absent.
    pub fn forget(&mut self, fingerprint: &str) -> Result<()> {
        let key = self.key(fingerprint);
        if self.data.servers.remove(&key).is_some() {
            self.save()?;
        }
        Ok(())
    }
}

impl KnownOracle for SeenStore {
    fn is_known(&self, fingerprint: &str) -> bool {
        self.contains(fingerprint)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn store(org: &str) -> (tempfile::TempDir, SeenStore) {
        let dir = tempdir().unwrap();
        let path = dir.path().join("seen.json");
        let s = SeenStore::open(path, org).unwrap();
        (dir, s)
    }

    #[test]
    fn unknown_fingerprint_is_not_known() {
        let (_d, s) = store("org1");
        assert!(!s.is_known("abc"));
    }

    #[test]
    fn marked_fingerprint_is_known_and_persists() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("seen.json");
        {
            let mut s = SeenStore::open(&path, "org1").unwrap();
            s.mark("abc", "evil", Action::Dismissed).unwrap();
            assert!(s.is_known("abc"));
        }
        // Reopen from disk.
        let s2 = SeenStore::open(&path, "org1").unwrap();
        assert!(s2.is_known("abc"));
    }

    #[test]
    fn org_scoping_isolates_entries() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("seen.json");
        {
            let mut s = SeenStore::open(&path, "org1").unwrap();
            s.mark("abc", "x", Action::Registered).unwrap();
        }
        let other = SeenStore::open(&path, "org2").unwrap();
        assert!(!other.is_known("abc")); // different org, same fingerprint
    }

    #[test]
    fn prune_drops_vanished_backend_entries_but_keeps_local() {
        let (_d, mut s) = store("org1");
        s.mark_from_backend("backend-gone", "g", Action::Registered)
            .unwrap();
        s.mark_from_backend("backend-kept", "k", Action::Requested)
            .unwrap();
        s.mark("local-dismissed", "d", Action::Dismissed).unwrap();

        let synced: HashSet<String> = ["backend-kept".to_string()].into_iter().collect();
        s.prune_backend(&synced).unwrap();

        assert!(!s.is_known("backend-gone")); // backend entry, gone from sync -> pruned
        assert!(s.is_known("backend-kept")); // still in sync -> kept
        assert!(s.is_known("local-dismissed")); // local decision -> preserved
    }
}
