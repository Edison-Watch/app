//! Stamp the daemon's reported version from the desktop app release version.
//!
//! The daemon announces `client_version` in its tunnel handshake (and in the
//! device-authorization request), which the dashboard's Devices page displays.
//! Historically this came from `env!("CARGO_PKG_VERSION")`, but the Rust
//! workspace version is pinned at `0.0.1` and never bumped per release, so
//! every shipped daemon reported `0.0.1` regardless of the actual release.
//!
//! The single source of truth for the shipped release is the desktop app's
//! `packages/desktop/package.json`. This build script resolves the version to
//! stamp, in order of precedence:
//!
//!   1. `SEALGATE_DAEMON_VERSION` env var (CI / reproducible release stamping).
//!   2. `packages/desktop/package.json` found by walking up from this crate.
//!   3. `CARGO_PKG_VERSION` (fallback for standalone crate builds).
//!
//! The result is exposed to the crate as `env!("SEALGATE_DAEMON_VERSION")`.

use std::path::{Path, PathBuf};

fn main() {
    // Re-run if the override changes; the package.json rerun hint is emitted
    // below only when we actually locate the file.
    println!("cargo:rerun-if-env-changed=SEALGATE_DAEMON_VERSION");

    let version = resolve_version();
    println!("cargo:rustc-env=SEALGATE_DAEMON_VERSION={version}");
}

fn resolve_version() -> String {
    // 1. Explicit override wins - lets CI stamp an exact release version even
    //    when the package.json isn't on disk next to the crate.
    if let Ok(v) = std::env::var("SEALGATE_DAEMON_VERSION") {
        let v = v.trim().to_string();
        if !v.is_empty() {
            return v;
        }
    }

    // 2. The desktop app's package.json is the source of truth for the release.
    let manifest_dir = PathBuf::from(
        std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR set by cargo"),
    );
    if let Some(pkg) = find_desktop_package_json(&manifest_dir) {
        println!("cargo:rerun-if-changed={}", pkg.display());
        if let Some(v) = read_json_version(&pkg) {
            return v;
        }
    }

    // 3. Fallback: the crate version (the historical behaviour).
    env!("CARGO_PKG_VERSION").to_string()
}

/// Walk up the ancestor directories of `start` looking for
/// `packages/desktop/package.json` (the monorepo layout).
fn find_desktop_package_json(start: &Path) -> Option<PathBuf> {
    for ancestor in start.ancestors() {
        let candidate = ancestor.join("packages/desktop/package.json");
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

/// Extract the first top-level `"version": "x.y.z"` string from a package.json
/// without pulling a JSON parser into the build dependencies. package.json
/// conventionally declares `version` near the top and never before it.
fn read_json_version(path: &Path) -> Option<String> {
    let text = std::fs::read_to_string(path).ok()?;
    let key = "\"version\"";
    let after_key = &text[text.find(key)? + key.len()..];
    let after_colon = &after_key[after_key.find(':')? + 1..];
    let start = after_colon.find('"')? + 1;
    let end = after_colon[start..].find('"')? + start;
    Some(after_colon[start..end].to_string())
}
