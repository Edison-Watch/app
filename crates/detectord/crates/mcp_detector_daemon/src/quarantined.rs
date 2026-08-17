//! Local record of what the dev daemon has quarantined, so `list` can show it
//! and `restore` can undo it across process invocations.

use serde::{Deserialize, Serialize};

use mcp_quarantine::QuarantineRecord;
use sealgate_detectord::ServerConfig;

use crate::paths;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuarantinedEntry {
    pub name: String,
    pub agent: String,
    pub fingerprint: String,
    pub record: QuarantineRecord,
    /// The server's launch config, kept so a post-quarantine "send to SG"
    /// disposition can submit it. `None` for older entries / opaque servers.
    #[serde(default)]
    pub config: Option<ServerConfig>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct QuarantinedState {
    pub entries: Vec<QuarantinedEntry>,
}

impl QuarantinedState {
    pub fn load_for(user: &str) -> anyhow::Result<Self> {
        let path = paths::quarantined_path(user);
        if !path.exists() {
            return Ok(Self::default());
        }
        Ok(serde_json::from_str(&std::fs::read_to_string(&path)?)?)
    }

    pub fn save_for(&self, user: &str) -> anyhow::Result<()> {
        paths::ensure_user_dir(user)?;
        std::fs::write(
            paths::quarantined_path(user),
            serde_json::to_string_pretty(self)?,
        )?;
        Ok(())
    }

    /// Add (or replace) a quarantined entry, keyed by its **physical location**
    /// (source file + nested key + server key). Keying by fingerprint would
    /// collapse a server that lives in several configs into one record, so only
    /// one would be restorable.
    pub fn upsert(&mut self, entry: QuarantinedEntry) {
        let loc = |e: &QuarantinedEntry| {
            (
                e.record.source_path.clone(),
                e.record.key_path.clone(),
                e.record.server_key.clone(),
            )
        };
        let key = loc(&entry);
        self.entries.retain(|e| loc(e) != key);
        self.entries.push(entry);
    }

    /// The entry matching `name` or `fingerprint`, left in place.
    ///
    /// Use this to select a target for an operation that can fail; `take`
    /// removes on selection, which would drop the record even when the
    /// operation didn't happen.
    pub fn find(&self, needle: &str) -> Option<&QuarantinedEntry> {
        self.entries
            .iter()
            .find(|e| e.name == needle || e.fingerprint == needle)
    }

    /// Remove and return the entry matching `name` or `fingerprint`.
    pub fn take(&mut self, needle: &str) -> Option<QuarantinedEntry> {
        let idx = self
            .entries
            .iter()
            .position(|e| e.name == needle || e.fingerprint == needle)?;
        Some(self.entries.remove(idx))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mcp_quarantine::QuarantineRecord;
    use std::path::PathBuf;

    fn entry(name: &str, fingerprint: &str) -> QuarantinedEntry {
        QuarantinedEntry {
            name: name.into(),
            agent: "cursor".into(),
            fingerprint: fingerprint.into(),
            config: None,
            record: QuarantineRecord {
                kind: sealgate_detectord::SourceKind::Json,
                source_path: PathBuf::from("/home/u/.cursor/mcp.json"),
                disabled_path: PathBuf::from("/home/u/.cursor/ewd-disabled_mcp.json"),
                backup_path: PathBuf::from("/home/u/.cursor/mcp.json.sg-backup"),
                key_path: vec!["mcpServers".into()],
                server_key: name.into(),
                extra: Default::default(),
            },
        }
    }

    fn state() -> QuarantinedState {
        QuarantinedState {
            entries: vec![entry("sqlite", "fp-sqlite"), entry("github", "fp-github")],
        }
    }

    /// `find` is what a fallible operation selects with: losing the record on a
    /// failed restore leaves the server quarantined and unrecoverable.
    #[test]
    fn find_matches_by_name_or_fingerprint_and_keeps_the_entry() {
        let q = state();
        assert_eq!(
            q.find("sqlite").map(|e| e.fingerprint.as_str()),
            Some("fp-sqlite")
        );
        assert_eq!(q.find("fp-github").map(|e| e.name.as_str()), Some("github"));
        assert!(q.find("absent").is_none());
        assert_eq!(q.entries.len(), 2, "find must not consume");
    }

    #[test]
    fn take_removes_the_matched_entry_only() {
        let mut q = state();
        assert_eq!(
            q.take("fp-sqlite").map(|e| e.name),
            Some("sqlite".to_string())
        );
        assert_eq!(q.entries.len(), 1);
        assert_eq!(q.entries[0].name, "github");
        assert!(q.take("fp-sqlite").is_none(), "already taken");
    }
}
