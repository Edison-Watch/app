//! Snapshot + diff used internally by the watcher to turn a freshly-parsed
//! list of [`McpServer`]s into a stream of [`ChangeEvent`]s.

use std::collections::HashMap;
use std::path::PathBuf;

use crate::types::{ChangeEvent, McpServer, Scope};

/// Identity used to detect "is this the same server as before?". A server is
/// uniquely identified by `(source file, scope, name)` - that way the same
/// server name appearing in two different scopes (e.g. global *and* a
/// specific project) is treated as two distinct entries.
type Key = (PathBuf, PathBuf, String);

/// In-memory map of every currently-known server, keyed by `(source file,
/// scope, name)`. The watcher keeps one of these per client.
#[derive(Default)]
pub(crate) struct Snapshot {
    by_key: HashMap<Key, McpServer>,
}

impl Snapshot {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    /// Seed the snapshot without emitting events.
    pub(crate) fn prime(&mut self, current: &[McpServer]) {
        self.by_key = current.iter().map(|s| (key(s), s.clone())).collect();
    }

    /// Replace the snapshot with `current` and return `Added` / `Removed`
    /// events for any servers that appeared or disappeared. In-place edits
    /// (same key, different fields) are not reported yet.
    pub(crate) fn update(&mut self, current: &[McpServer]) -> Vec<ChangeEvent> {
        let new_map: HashMap<Key, McpServer> =
            current.iter().map(|s| (key(s), s.clone())).collect();

        let mut events = Vec::new();
        for (k, s) in &new_map {
            if !self.by_key.contains_key(k) {
                events.push(ChangeEvent::Added(s.clone()));
            }
        }
        for (k, s) in &self.by_key {
            if !new_map.contains_key(k) {
                events.push(ChangeEvent::Removed(s.clone()));
            }
        }

        self.by_key = new_map;
        events
    }
}

fn key(s: &McpServer) -> Key {
    let scope_tag = match &s.scope {
        Scope::Global => PathBuf::from("<global>"),
        Scope::Project(p) => p.clone(),
    };
    (s.source.clone(), scope_tag, s.name.clone())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{Scope, Transport};

    fn s(name: &str) -> McpServer {
        McpServer {
            client: "test",
            name: name.into(),
            transport: Transport::Stdio,
            scope: Scope::Global,
            source: PathBuf::from("/tmp/x.json"),
        }
    }

    #[test]
    fn prime_then_update_no_events_when_unchanged() {
        let mut snap = Snapshot::new();
        let a = vec![s("foo"), s("bar")];
        snap.prime(&a);
        assert!(snap.update(&a).is_empty());
    }

    #[test]
    fn update_emits_added_for_new_entries() {
        let mut snap = Snapshot::new();
        snap.prime(&[s("foo")]);
        let events = snap.update(&[s("foo"), s("bar")]);
        assert_eq!(events.len(), 1);
        match &events[0] {
            ChangeEvent::Added(srv) => assert_eq!(srv.name, "bar"),
            other => panic!("expected Added, got {other:?}"),
        }
    }

    #[test]
    fn update_emits_removed_for_disappeared_entries() {
        let mut snap = Snapshot::new();
        snap.prime(&[s("foo"), s("bar")]);
        let events = snap.update(&[s("foo")]);
        assert_eq!(events.len(), 1);
        match &events[0] {
            ChangeEvent::Removed(srv) => assert_eq!(srv.name, "bar"),
            other => panic!("expected Removed, got {other:?}"),
        }
    }

    #[test]
    fn update_emits_both_when_swap_happens() {
        let mut snap = Snapshot::new();
        snap.prime(&[s("foo")]);
        let events = snap.update(&[s("bar")]);
        assert_eq!(events.len(), 2);
        let kinds: Vec<_> = events
            .iter()
            .map(|e| match e {
                ChangeEvent::Added(s) => ("added", s.name.clone()),
                ChangeEvent::Removed(s) => ("removed", s.name.clone()),
            })
            .collect();
        assert!(kinds.contains(&("added", "bar".into())));
        assert!(kinds.contains(&("removed", "foo".into())));
    }
}
