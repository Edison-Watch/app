//! Tests for `daemon.rs`.

use super::*;
use crate::power::{Effective, KeepAwakeStatus, LocalChoice};

fn current(backend: &str, device_id: &str) -> ResolvedRun {
    ResolvedRun {
        backend: backend.into(),
        credential: "key".into(),
        credential_kind: config::CredentialKind::LegacyApiKey,
        client_installation_id: None,
        device_id: device_id.into(),
        label: "Laptop".into(),
    }
}

fn saved(backend: &str, device_id: &str) -> State {
    State {
        backend_url: Some(backend.into()),
        device_id: Some(device_id.into()),
        keep_awake: Some(KeepAwakeStatus {
            local: LocalChoice::On,
            desired: true,
            effective: Effective::Active,
        }),
        ..State::default()
    }
}

#[test]
fn the_dashboard_value_is_kept_for_the_same_device_only() {
    let same = previous_keep_awake(
        saved("https://a.test", "dev-1"),
        Some(&current("https://A.test/", "dev-1")),
    )
    .unwrap();
    assert!(same.desired);

    for (backend, device) in [("https://b.test", "dev-1"), ("https://a.test", "dev-2")] {
        let other = previous_keep_awake(
            saved("https://a.test", "dev-1"),
            Some(&current(backend, device)),
        )
        .unwrap();
        assert!(!other.desired, "{backend} {device}");
        // The local choice belongs to the machine and is kept.
        assert_eq!(other.local, LocalChoice::On);
    }

    let logged_out = previous_keep_awake(saved("https://a.test", "dev-1"), None).unwrap();
    assert!(!logged_out.desired);
}
