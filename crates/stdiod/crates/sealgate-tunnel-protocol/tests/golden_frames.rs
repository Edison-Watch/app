//! Round-trip every golden frame fixture through [`TunnelFrame`].
//!
//! Fixtures live in `schema/golden-frames/` and are shared with the backend
//! and with any future client (see `schema/golden-frames/README.md`). This
//! test is the Rust half of the compatibility contract:
//!
//! - every fixture parses (a fixture naming an unknown variant fails here,
//!   because `TunnelFrame` has no catch-all arm);
//! - parse → serialize → parse is semantically stable, ignoring
//!   null-versus-absent differences on optional fields;
//! - the `type` tag survives the round trip;
//! - every enum variant has at least one fixture.

use std::collections::BTreeMap;
use std::path::PathBuf;

use sealgate_tunnel_protocol::TunnelFrame;

/// Every `type` tag in the `TunnelFrame` enum.
///
/// MAINTAINERS: this list is hand-maintained. When you add a variant to
/// `TunnelFrame` in `src/lib.rs`, add its snake_case tag here and add a
/// fixture under `schema/golden-frames/`. The test fails if a tag listed
/// here has no fixture, and a fixture with an unlisted tag fails to parse.
const EXPECTED_VARIANTS: &[&str] = &[
    "client_hello",
    "server_hello",
    "desired_state_update",
    "mcp_frame",
    "tunnel_error",
    "server_env_update",
    "server_spec_update",
    "server_spawn_result",
    "ping",
    "pong",
];

fn golden_dir() -> PathBuf {
    // <crate>/tests/../../../schema/golden-frames
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("schema")
        .join("golden-frames")
}

/// Read every `*.json` fixture as (file name, parsed JSON), sorted by name.
fn load_fixtures() -> Vec<(String, serde_json::Value)> {
    let dir = golden_dir();
    let entries =
        std::fs::read_dir(&dir).unwrap_or_else(|e| panic!("cannot read {}: {e}", dir.display()));
    let mut out = Vec::new();
    for entry in entries {
        let path = entry.expect("directory entry").path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .expect("fixture file name")
            .to_string();
        let body = std::fs::read_to_string(&path)
            .unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()));
        let value: serde_json::Value =
            serde_json::from_str(&body).unwrap_or_else(|e| panic!("{name} is not valid JSON: {e}"));
        out.push((name, value));
    }
    out.sort_by(|a, b| a.0.cmp(&b.0));
    assert!(!out.is_empty(), "no fixtures found in {}", dir.display());
    out
}

/// Drop null-valued object members recursively so `null` and absent compare
/// equal, matching the wire rule that optional fields may arrive either way.
fn normalize(value: &serde_json::Value) -> serde_json::Value {
    match value {
        serde_json::Value::Object(map) => {
            let kept: BTreeMap<String, serde_json::Value> = map
                .iter()
                .filter(|(_, v)| !v.is_null())
                .map(|(k, v)| (k.clone(), normalize(v)))
                .collect();
            serde_json::Value::Object(kept.into_iter().collect())
        }
        serde_json::Value::Array(items) => {
            serde_json::Value::Array(items.iter().map(normalize).collect())
        }
        other => other.clone(),
    }
}

fn tag_of(value: &serde_json::Value, name: &str) -> String {
    value
        .get("type")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_else(|| panic!("{name} has no string `type` discriminator"))
        .to_string()
}

#[test]
fn every_fixture_round_trips() {
    for (name, raw) in load_fixtures() {
        let tag = tag_of(&raw, &name);

        let frame = TunnelFrame::from_json(raw.clone())
            .unwrap_or_else(|e| panic!("{name}: does not parse as TunnelFrame: {e}"));
        let reserialized = frame.to_json();
        assert_eq!(
            tag_of(&reserialized, &name),
            tag,
            "{name}: `type` tag changed across serialization",
        );

        let reparsed = TunnelFrame::from_json(reserialized.clone())
            .unwrap_or_else(|e| panic!("{name}: reserialized form does not reparse: {e}"));
        let round_tripped = reparsed.to_json();

        assert_eq!(
            normalize(&reserialized),
            normalize(&round_tripped),
            "{name}: serialization is not stable across a second round trip",
        );
        assert_eq!(
            normalize(&raw),
            normalize(&reserialized),
            "{name}: round trip changed the frame (ignoring null-versus-absent)",
        );
    }
}

#[test]
fn every_variant_has_a_fixture() {
    let mut covered: Vec<String> = load_fixtures()
        .iter()
        .map(|(name, raw)| tag_of(raw, name))
        .collect();
    covered.sort();
    covered.dedup();

    let missing: Vec<&str> = EXPECTED_VARIANTS
        .iter()
        .copied()
        .filter(|tag| !covered.iter().any(|c| c == tag))
        .collect();
    assert!(
        missing.is_empty(),
        "TunnelFrame variants with no golden fixture: {missing:?}. \
         Add one under schema/golden-frames/ (see its README).",
    );

    let unexpected: Vec<&String> = covered
        .iter()
        .filter(|tag| !EXPECTED_VARIANTS.contains(&tag.as_str()))
        .collect();
    assert!(
        unexpected.is_empty(),
        "fixtures cover tags missing from EXPECTED_VARIANTS: {unexpected:?}. \
         Update the list in this test alongside the TunnelFrame enum.",
    );
}

/// Guards the rule that an unknown `type` is a hard parse failure rather than
/// something a client can shrug off at the deserialization layer.
#[test]
fn unknown_variant_is_a_parse_error() {
    let raw = serde_json::json!({ "type": "announce_server", "name": "fs" });
    assert!(TunnelFrame::from_json(raw).is_err());
}
