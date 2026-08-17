//! Enrollment + last-known-good policy, keyed by OS user.
//!
//! Enrollment is performed online (the `enroll` flow validates against the
//! backend and seeds the cache), matching the design's "enrollment = online
//! handshake" so there is never an enrolled-but-never-fetched state. The store
//! is a map so one machine can serve several OS users (one dev user, or many
//! under root); the dev build simply operates on its own username.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::paths;

/// One user's enrollment record.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Enrollment {
    pub api_base_url: String,
    pub api_key: String,
    pub org_id: String,
    /// Human-readable org label (the caller's email domain, e.g. `gatlingx.com`).
    #[serde(default)]
    pub org_name: String,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub role: String,
    /// Last-known-good policy. Kept enforcing through backend outages
    /// (fail-closed): a failed refresh never flips this off.
    pub quarantine: bool,
    /// MCP gateway base URL (e.g. `http://localhost:3000`) — the `sealgate`
    /// proxy entry points here (distinct from `api_base_url`). Needed to install.
    #[serde(default)]
    pub mcp_base_url: Option<String>,
    /// Agents the UI selected for `sealgate` install. Governs install only;
    /// quarantine still acts on all agents.
    #[serde(default)]
    pub selected_agents: Vec<String>,
    /// The user's sealgate secret key (composite `user:<base64>`), provided by the
    /// UI/CLI. Carried in the `X-Edison-Secret-Key` header of the installed
    /// entry. `None` installs without the header.
    #[serde(default)]
    pub sealgate_secret_key: Option<String>,
    /// Whether automatic quarantine enforcement is armed for this user. The UI
    /// arms it only once onboarding is complete, so the daemon stays detect-only
    /// (list/report, no removal) while the user is still reviewing their servers
    /// during setup. Explicit dispositions (send-to-SG) act regardless.
    #[serde(default)]
    pub armed: bool,
}

impl Enrollment {
    /// Load this OS user's enrollment, if any.
    pub fn load_for(user: &str) -> anyhow::Result<Option<Enrollment>> {
        Ok(Enrollments::load()?.get(user).cloned())
    }

    /// Upsert this enrollment for `user`.
    pub fn save_for(&self, user: &str) -> anyhow::Result<()> {
        let mut store = Enrollments::load()?;
        store.set(user, self.clone());
        store.save()
    }

    /// Remove `user`'s enrollment, returning it if present.
    pub fn remove_for(user: &str) -> anyhow::Result<Option<Enrollment>> {
        let mut store = Enrollments::load()?;
        let removed = store.remove(user);
        store.save()?;
        Ok(removed)
    }
}

/// The on-disk enrollment map, keyed by OS user.
#[derive(Debug, Default, Serialize, Deserialize)]
pub struct Enrollments {
    #[serde(default)]
    users: BTreeMap<String, Enrollment>,
}

impl Enrollments {
    pub fn load() -> anyhow::Result<Self> {
        let path = paths::enrollments_path();
        if !path.exists() {
            return Ok(Self::default());
        }
        Ok(serde_json::from_str(&std::fs::read_to_string(&path)?)?)
    }

    pub fn save(&self) -> anyhow::Result<()> {
        paths::ensure_base_dir()?;
        std::fs::write(
            paths::enrollments_path(),
            serde_json::to_string_pretty(self)?,
        )?;
        Ok(())
    }

    pub fn get(&self, user: &str) -> Option<&Enrollment> {
        self.users.get(user)
    }

    pub fn set(&mut self, user: &str, e: Enrollment) {
        self.users.insert(user.to_string(), e);
    }

    pub fn remove(&mut self, user: &str) -> Option<Enrollment> {
        self.users.remove(user)
    }

    /// Every enrolled `(user, enrollment)` — used by the root daemon to spawn a
    /// worker per user.
    #[allow(dead_code)] // consumed by the root per-user supervisor (next sub-part)
    pub fn iter(&self) -> impl Iterator<Item = (&String, &Enrollment)> {
        self.users.iter()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn e(org: &str) -> Enrollment {
        Enrollment {
            api_base_url: "u".into(),
            api_key: "k".into(),
            org_id: org.into(),
            org_name: "o".into(),
            email: None,
            role: "user".into(),
            quarantine: true,
            mcp_base_url: None,
            selected_agents: Vec::new(),
            sealgate_secret_key: None,
            armed: false,
        }
    }

    #[test]
    fn set_get_remove_and_serde_round_trip() {
        let mut s = Enrollments::default();
        s.set("alice", e("org-a"));
        s.set("bob", e("org-b"));
        assert_eq!(s.get("alice").unwrap().org_id, "org-a");
        assert_eq!(s.iter().count(), 2);

        // Round-trips through JSON keyed by user.
        let json = serde_json::to_string(&s).unwrap();
        let back: Enrollments = serde_json::from_str(&json).unwrap();
        assert_eq!(back.get("bob").unwrap().org_id, "org-b");

        assert!(s.remove("alice").is_some());
        assert!(s.get("alice").is_none());
    }
}
