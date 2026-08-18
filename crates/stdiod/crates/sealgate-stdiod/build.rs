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
    if let Some(v) = find_desktop_package_json(&manifest_dir).and_then(|pkg| read_json_version(&pkg))
    {
        return v;
    }

    // 3. Fallback: the crate version - the pinned workspace `0.0.1`, i.e. the
    //    exact value this stamping exists to avoid shipping. A release build
    //    should have hit one of the paths above (the build scripts export the
    //    override, and any in-tree build finds the package.json), so make the
    //    fallback loud rather than silently reintroducing the bug.
    let fallback = env!("CARGO_PKG_VERSION");
    println!(
        "cargo:warning=sealgate-stdiod: SEALGATE_DAEMON_VERSION unset and no usable version \
         in packages/desktop/package.json; daemon will report crate version {fallback}"
    );
    fallback.to_string()
}

/// Locate the desktop app's `packages/desktop/package.json` for an in-tree
/// build by walking a bounded number of parents up from `start`.
///
/// The daemon crate sits a fixed depth below the monorepo root
/// (`crates/stdiod/crates/sealgate-stdiod`, i.e. the root is 4 parents up), so
/// the search is capped rather than walking to the filesystem root. A build
/// vendored under an unrelated project therefore falls through to the
/// crate-version fallback and its warning instead of silently adopting some
/// far-off project's `packages/desktop/package.json`.
///
/// Every candidate path is registered with `cargo:rerun-if-changed`, including
/// ones that don't exist yet, so a build that runs before the package.json is
/// present re-stamps once it appears rather than Cargo reusing a stale fallback.
fn find_desktop_package_json(start: &Path) -> Option<PathBuf> {
    // 4 parents reach the monorepo root; allow a little slack for layout
    // changes without an unbounded walk. `ancestors()` yields `start` first.
    const MAX_ANCESTORS: usize = 6;
    let mut found = None;
    for ancestor in start.ancestors().take(MAX_ANCESTORS) {
        let candidate = ancestor.join("packages/desktop/package.json");
        // Register the watch even when the file is absent, and keep scanning
        // after a hit so a closer package.json added later also re-triggers.
        println!("cargo:rerun-if-changed={}", candidate.display());
        if found.is_none() && candidate.is_file() {
            found = Some(candidate);
        }
    }
    found
}

/// Read the top-level `version` string from a package.json. Parses the whole
/// document so a nested `version` key (a tool pin, a dependency block) can't be
/// mistaken for the package's own. An empty string is treated as no version, so
/// it falls through to the loud crate-version fallback rather than stamping an
/// empty `client_version`.
fn read_json_version(path: &Path) -> Option<String> {
    let text = std::fs::read_to_string(path).ok()?;
    let json: serde_json::Value = serde_json::from_str(&text).ok()?;
    json.get("version")?
        .as_str()
        .filter(|v| !v.is_empty())
        .map(str::to_owned)
}
