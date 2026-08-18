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

    // 3. Fallback: the crate version - the pinned workspace `0.0.1`, i.e. the
    //    exact value this stamping exists to avoid shipping. A release build
    //    should have hit one of the paths above (the build scripts export the
    //    override, and any in-tree build finds the package.json), so make the
    //    fallback loud rather than silently reintroducing the bug.
    let fallback = env!("CARGO_PKG_VERSION");
    println!(
        "cargo:warning=sealgate-stdiod: SEALGATE_DAEMON_VERSION unset and \
         packages/desktop/package.json not found; daemon will report crate \
         version {fallback}"
    );
    fallback.to_string()
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

/// Read the top-level `version` string from a package.json. Parses the whole
/// document so a nested `version` key (a tool pin, a dependency block) can't be
/// mistaken for the package's own.
fn read_json_version(path: &Path) -> Option<String> {
    let text = std::fs::read_to_string(path).ok()?;
    let json: serde_json::Value = serde_json::from_str(&text).ok()?;
    json.get("version")?.as_str().map(str::to_owned)
}
