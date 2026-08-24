//! Stable per-machine identifier, used as a fallback `client_installation_id`
//! when config.toml has none.

/// Namespace so the value below is specific to this app, and so a raw machine
/// identifier is never what leaves the box.
const INSTALLATION_ID_NAMESPACE: &str = "sealgate-stdiod/client-installation-id/v1";

/// A stable per-machine `client_installation_id`, or `None` when the machine
/// has no usable identifier.
pub fn installation_id() -> Option<String> {
    let raw = raw_machine_id()?;
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(INSTALLATION_ID_NAMESPACE.as_bytes());
    hasher.update(b"\0");
    hasher.update(raw.trim().as_bytes());
    let digest = hasher.finalize();
    let h: Vec<String> = digest.iter().take(16).map(|b| format!("{b:02x}")).collect();
    let h = h.concat();
    Some(format!(
        "{}-{}-{}-{}-{}",
        &h[0..8],
        &h[8..12],
        &h[12..16],
        &h[16..20],
        &h[20..32]
    ))
}

/// Platform machine identifier, unhashed. Stable across reinstalls of this
/// tool; changes only if the OS is reinstalled or the hardware replaced.
#[cfg(target_os = "macos")]
fn raw_machine_id() -> Option<String> {
    let out = std::process::Command::new("ioreg")
        .args(["-rd1", "-c", "IOPlatformExpertDevice"])
        .output()
        .ok()?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    stdout.lines().find_map(|line| {
        let rest = line.trim().strip_prefix("\"IOPlatformUUID\"")?;
        let value = rest.split('=').nth(1)?.trim().trim_matches('"');
        (!value.is_empty()).then(|| value.to_owned())
    })
}

#[cfg(target_os = "linux")]
fn raw_machine_id() -> Option<String> {
    ["/etc/machine-id", "/var/lib/dbus/machine-id"]
        .iter()
        .find_map(|path| {
            let value = std::fs::read_to_string(path).ok()?;
            let value = value.trim().to_owned();
            (!value.is_empty()).then_some(value)
        })
}

#[cfg(target_os = "windows")]
fn raw_machine_id() -> Option<String> {
    let out = std::process::Command::new("reg")
        .args([
            "query",
            r"HKLM\SOFTWARE\Microsoft\Cryptography",
            "/v",
            "MachineGuid",
        ])
        .output()
        .ok()?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    stdout
        .split_whitespace()
        .last()
        .filter(|value| value.contains('-'))
        .map(|value| value.to_owned())
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
fn raw_machine_id() -> Option<String> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    // The whole point is stability: a wiped config must derive the same id.
    #[test]
    fn installation_id_is_stable_and_uuid_shaped() {
        let Some(a) = installation_id() else {
            return; // no machine id on this host; nothing to assert
        };
        assert_eq!(Some(&a), installation_id().as_ref());
        assert_eq!(a.len(), 36, "expected UUID shape, got {a:?}");
        let parts: Vec<&str> = a.split('-').collect();
        assert_eq!(
            parts.iter().map(|p| p.len()).collect::<Vec<_>>(),
            vec![8, 4, 4, 4, 12]
        );
        assert!(a.chars().all(|c| c.is_ascii_hexdigit() || c == '-'));
    }

    // The raw hardware id must never be what we send.
    #[test]
    fn installation_id_is_not_the_raw_machine_id() {
        let (Some(raw), Some(derived)) = (raw_machine_id(), installation_id()) else {
            return;
        };
        assert_ne!(raw.trim().to_lowercase(), derived.to_lowercase());
    }
}
