//! Shared helpers for agent adapters: mapping a servers map to
//! [`DiscoveredServer`]s, reading strict JSON, and decoding `file://` URIs.
//!
//! Different agents use different subsets of these helpers, so in narrow
//! single-agent builds some go unused; they are all exercised in the default
//! (all-agents) build.
#![allow(dead_code)]

use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::clients::{detect_transport, server_config_from_value};
use crate::types::{ConfigLocation, DiscoveredServer, LocationExtra, Scope, SourceKind};

/// Map a servers object (found at `root[servers_key]`) into discovered servers.
///
/// `root` is already-parsed JSON (the caller chooses strict vs. lenient), so
/// this works for both plain-JSON and JSONC agents. Entries with no extractable
/// command/url are skipped (unsupported). Each server is tagged with a
/// [`ConfigLocation`] of `key_path = [servers_key]` and the given `kind`.
pub(crate) fn servers_from_map(
    root: &Value,
    servers_key: &str,
    client: &'static str,
    scope: Scope,
    kind: SourceKind,
    path: &Path,
) -> Vec<DiscoveredServer> {
    let Some(map) = root.get(servers_key).and_then(Value::as_object) else {
        return Vec::new();
    };
    map.iter()
        .filter_map(|(name, val)| {
            let config = server_config_from_value(val)?;
            Some(DiscoveredServer {
                client,
                transport: detect_transport(val),
                scope: scope.clone(),
                config,
                location: ConfigLocation {
                    kind,
                    path: path.to_path_buf(),
                    key_path: vec![servers_key.to_string()],
                    server_key: name.clone(),
                    extra: LocationExtra::None,
                },
                name: name.clone(),
            })
        })
        .collect()
}

/// Read and strict-parse a JSON file, tolerating missing/empty/malformed input
/// (logs at debug, returns `None`).
pub(crate) fn read_strict_json(path: &Path) -> Option<Value> {
    let text = match std::fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) => {
            tracing::debug!(file = %path.display(), error = %e, "read failed");
            return None;
        }
    };
    if text.trim().is_empty() {
        return None;
    }
    match serde_json::from_str(&text) {
        Ok(v) => Some(v),
        Err(e) => {
            tracing::debug!(file = %path.display(), error = %e, "parse failed");
            None
        }
    }
}

/// Convenience: read strict JSON and map a single top-level servers key.
pub(crate) fn parse_json_servers_map(
    path: &Path,
    servers_key: &str,
    client: &'static str,
    scope: Scope,
    kind: SourceKind,
) -> Vec<DiscoveredServer> {
    match read_strict_json(path) {
        Some(root) => servers_from_map(&root, servers_key, client, scope, kind, path),
        None => Vec::new(),
    }
}

/// Decode a `file://` URI to a filesystem path (percent-decoding the tail).
/// Returns `None` for non-`file://` URIs (SSH/remote workspaces).
pub(crate) fn file_uri_to_path(uri: &str) -> Option<PathBuf> {
    let stripped = uri.strip_prefix("file://")?;
    Some(PathBuf::from(percent_decode(stripped)))
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%'
            && i + 2 < bytes.len()
            && let (Some(h), Some(l)) = (hex(bytes[i + 1]), hex(bytes[i + 2]))
        {
            out.push((h << 4) | l);
            i += 3;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}
