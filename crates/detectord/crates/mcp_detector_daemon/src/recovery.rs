//! Disk-based recovery: reverse quarantines by scanning the on-disk artifacts
//! (`disabled_<config>.json` sidecars and `ew-disabled-*` dirs) rather than the
//! tracked state. Idempotent; useful after any interrupted/untracked run.

use std::path::{Path, PathBuf};

use edison_detectord::{LocationExtra, SourceKind};
use mcp_quarantine::{ConfigStore, FileConfigStore, QuarantineRecord};

use crate::agents;

/// Restore everything quarantined on disk. Returns `(servers, plugin_dirs)`.
pub fn recover() -> (usize, usize) {
    // Scan every agent's watch locations (file parents + dirs) for artifacts.
    let mut roots: Vec<PathBuf> = Vec::new();
    for a in agents::build() {
        let wt = a.watch_targets();
        for f in wt.files {
            if let Some(p) = f.parent() {
                roots.push(p.to_path_buf());
            }
        }
        for d in wt.dirs {
            roots.push(d.path);
        }
    }
    roots.sort();
    roots.dedup();

    let mut sidecars = Vec::new();
    let mut disabled_dirs = Vec::new();
    for root in &roots {
        collect(root, 0, 6, &mut sidecars, &mut disabled_dirs);
    }
    sidecars.sort();
    sidecars.dedup();
    disabled_dirs.sort();
    disabled_dirs.dedup();

    let store = FileConfigStore;
    let servers = sidecars.iter().map(|s| restore_sidecar(&store, s)).sum();
    let dirs = disabled_dirs
        .iter()
        .filter(|d| restore_dir(&store, d))
        .count();
    (servers, dirs)
}

/// Recursively collect `disabled_*.json` files and `ew-disabled-*` dirs.
fn collect(
    dir: &Path,
    depth: usize,
    max: usize,
    sidecars: &mut Vec<PathBuf>,
    dirs: &mut Vec<PathBuf>,
) {
    if depth > max {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for e in entries.flatten() {
        let path = e.path();
        let name = e.file_name().to_string_lossy().into_owned();
        if path.is_dir() {
            if name.starts_with("ew-disabled-") {
                dirs.push(path.clone());
            }
            collect(&path, depth + 1, max, sidecars, dirs);
        } else if (name.starts_with("ewd-disabled_") || name.starts_with("disabled_"))
            && name.ends_with(".json")
        {
            // Both our current prefix and the legacy `disabled_`; the
            // `_edisonOriginalFile` metadata filter in restore_sidecar keeps us
            // from touching the Electron app's own entries.
            sidecars.push(path);
        }
    }
}

/// Restore every server recorded in one `disabled_<config>.json` sidecar, using
/// the `_edisonOriginalFile` / `_edisonKeyPath` metadata each entry carries.
fn restore_sidecar(store: &FileConfigStore, sidecar: &Path) -> usize {
    let Ok(text) = std::fs::read_to_string(sidecar) else {
        return 0;
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else {
        return 0;
    };
    let Some(servers) = value.get("servers").and_then(|s| s.as_object()) else {
        return 0;
    };

    // Collect targets first (restore mutates the sidecar file per call).
    let targets: Vec<(String, PathBuf, Vec<String>)> = servers
        .iter()
        .filter_map(|(key, entry)| {
            let orig = entry.get("_edisonOriginalFile")?.as_str()?;
            let key_path = entry
                .get("_edisonKeyPath")?
                .as_array()?
                .iter()
                .filter_map(|x| x.as_str().map(String::from))
                .collect();
            Some((key.clone(), PathBuf::from(orig), key_path))
        })
        .collect();

    targets
        .into_iter()
        .filter(|(server_key, source, key_path)| {
            let rec = QuarantineRecord {
                kind: SourceKind::Jsonc,
                source_path: source.clone(),
                disabled_path: sidecar.to_path_buf(),
                backup_path: sidecar.to_path_buf(),
                key_path: key_path.clone(),
                server_key: server_key.clone(),
                extra: LocationExtra::None,
            };
            store.restore(&rec).is_ok()
        })
        .count()
}

/// Restore one `ew-disabled-<name>` plugin dir (rename back, or drop if the live
/// dir already exists).
fn restore_dir(store: &FileConfigStore, disabled: &Path) -> bool {
    let Some(name) = disabled
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
    else {
        return false;
    };
    let orig = name.strip_prefix("ew-disabled-").unwrap_or(&name);
    let rec = QuarantineRecord {
        kind: SourceKind::CursorPluginDir,
        source_path: disabled.with_file_name(orig),
        disabled_path: disabled.to_path_buf(),
        backup_path: disabled.to_path_buf(),
        key_path: Vec::new(),
        server_key: orig.to_string(),
        extra: LocationExtra::None,
    };
    store.restore(&rec).is_ok()
}
