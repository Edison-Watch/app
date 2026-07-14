//! Local record of what the dev daemon has quarantined, so `list` can show it
//! and `restore` can undo it across process invocations.

use serde::{Deserialize, Serialize};

use edison_detectord::ServerConfig;
use mcp_quarantine::QuarantineRecord;

use crate::paths;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuarantinedEntry {
    pub name: String,
    pub agent: String,
    pub fingerprint: String,
    pub record: QuarantineRecord,
    /// The server's launch config, kept so a post-quarantine "send to EW"
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

    /// Remove and return the entry matching `name` or `fingerprint`.
    pub fn take(&mut self, needle: &str) -> Option<QuarantinedEntry> {
        let idx = self
            .entries
            .iter()
            .position(|e| e.name == needle || e.fingerprint == needle)?;
        Some(self.entries.remove(idx))
    }
}
