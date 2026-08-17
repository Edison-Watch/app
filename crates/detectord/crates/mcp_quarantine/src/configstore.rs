//! Config mutation — removing a server from its agent's config (quarantine) and
//! putting it back (restore), dispatched on [`SourceKind`].
//!
//! The writers are **privilege-free file operations**: the daemon wraps them in
//! a privilege-drop when writing into a user's home. They are fully testable in
//! a tempdir.
//!
//! Safety control flow for [`FileConfigStore::quarantine`]:
//! 1. confirm the server is present in the original,
//! 2. back the original up,
//! 3. add the entry (plus restore metadata) to a `disabled_<config>` sidecar,
//! 4. remove the entry from the original and write it — rolling the sidecar
//!    back if that write fails, so the two files never disagree.
//!
//! ## v1 limitation
//!
//! The file writer round-trips through a JSON value, so comments and exact
//! formatting in the source are **not preserved** on edit (the key is removed
//! and the file re-serialised). This is structurally correct and never corrupts
//! the file; format-preserving surgical JSONC edits are a tracked follow-up.

use std::path::{Path, PathBuf};

use sealgate_detectord::{
    ConfigLocation, SealGateInstall, SealGateStyle, HttpKind, LocationExtra, ServerConfig, SourceKind,
    StateShape,
};
use serde_json::{Map, Value, json};

use crate::error::{Error, Result};
use crate::statedb::{read_row, write_row};

const QUARANTINED_BY: &str = "SealGate";
const META_ORIGINAL_FILE: &str = "_sealgateOriginalFile";
const META_KEY_PATH: &str = "_sealgateKeyPath";

/// What a [`ConfigStore`] needs to undo a quarantine.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct QuarantineRecord {
    pub kind: SourceKind,
    pub source_path: PathBuf,
    pub disabled_path: PathBuf,
    pub backup_path: PathBuf,
    pub key_path: Vec<String>,
    pub server_key: String,
    /// Mechanism-specific data needed to reverse the quarantine (e.g. the
    /// state.vscdb row + shape). Copied from the location.
    #[serde(default)]
    pub extra: LocationExtra,
}

/// Removes a server from its config (quarantine) and restores it.
pub trait ConfigStore: Send + Sync {
    fn quarantine(&self, loc: &ConfigLocation, cfg: &ServerConfig) -> Result<QuarantineRecord>;
    fn restore(&self, rec: &QuarantineRecord) -> Result<()>;
}

/// Writer covering every actionable [`SourceKind`]: JSON/JSONC files, Claude
/// Code project scope (nested edit of `~/.claude.json`), Codex TOML, marketplace
/// `state.vscdb` (SQLite), and Cursor plugin dirs (rename to `sg-disabled-*`).
#[derive(Default)]
pub struct FileConfigStore;

impl ConfigStore for FileConfigStore {
    fn quarantine(&self, loc: &ConfigLocation, cfg: &ServerConfig) -> Result<QuarantineRecord> {
        match loc.kind {
            // JSON-family, incl. Claude Code project scope (a nested edit of the
            // JSON `~/.claude.json` — see note below).
            SourceKind::Json | SourceKind::Jsonc | SourceKind::ClaudeCli => {
                quarantine_json(loc, cfg)
            }
            SourceKind::Toml => quarantine_toml(loc, cfg),
            SourceKind::SqliteState => quarantine_sqlite(loc),
            SourceKind::CursorPluginDir => quarantine_plugin_dir(loc),
        }
    }

    fn restore(&self, rec: &QuarantineRecord) -> Result<()> {
        match rec.kind {
            SourceKind::Toml => restore_toml(rec),
            SourceKind::SqliteState => restore_sqlite(rec),
            SourceKind::CursorPluginDir => restore_plugin_dir(rec),
            _ => restore_json(rec),
        }
    }
}

// ── JSON / JSONC writer ──────────────────────────────────────────────────────
//
// Note: `ClaudeCli` (project-scoped Claude Code servers in `~/.claude.json`) is
// handled here as a direct nested JSON edit rather than shelling out to
// `claude mcp remove`. Simpler and dependency-free; the CLI path can replace it
// later if Claude Code's management of that file demands it.

fn quarantine_json(loc: &ConfigLocation, cfg: &ServerConfig) -> Result<QuarantineRecord> {
    let raw = read(&loc.path)?;
    let mut root = parse(&raw, &loc.path)?;

    // 1. Confirm the server is present.
    {
        let map = nav_mut(&mut root, &loc.key_path)
            .ok_or_else(|| Error::NotAnObject(loc.key_path.clone()))?;
        if !map.contains_key(&loc.server_key) {
            return Err(Error::NotFound(loc.server_key.clone()));
        }
    }

    // 2. Back up the original verbatim — ONCE, so the backup captures the full
    //    original even when several servers are quarantined from the same file.
    let backup_path = backup_path(&loc.path);
    if !backup_path.exists() {
        write(&backup_path, &raw)?;
    }

    // 3. Add to the disabled sidecar (with restore metadata).
    let disabled_path = disabled_path(&loc.path);
    let mut disabled = read_disabled(&disabled_path)?;
    let entry = build_disabled_entry(cfg, &loc.path, &loc.key_path)?;
    disabled_servers(&mut disabled).insert(loc.server_key.clone(), entry);
    write(&disabled_path, &serialize(&disabled))?;

    // 4. Remove from the original; roll the sidecar back if the write fails.
    nav_mut(&mut root, &loc.key_path)
        .expect("key path validated above")
        .remove(&loc.server_key);
    if let Err(e) = write(&loc.path, &serialize(&root)) {
        let _ = rollback_sidecar(&disabled_path, &loc.server_key);
        return Err(e);
    }

    Ok(record(loc, disabled_path, backup_path))
}

fn restore_json(rec: &QuarantineRecord) -> Result<()> {
    let (disabled, mut entry) = take_disabled_entry(rec)?;

    let raw = read(&rec.source_path)?;
    let mut root = parse(&raw, &rec.source_path)?;
    if let Value::Object(m) = &mut entry {
        m.retain(|k, _| !k.starts_with("_sealgate"));
    }
    nav_create(&mut root, &rec.key_path)
        .ok_or_else(|| Error::NotAnObject(rec.key_path.clone()))?
        .insert(rec.server_key.clone(), entry);
    write(&rec.source_path, &serialize(&root))?;

    finalize_sidecar(rec, &disabled)?;
    Ok(())
}

// ── TOML writer (Codex) ──────────────────────────────────────────────────────

fn quarantine_toml(loc: &ConfigLocation, cfg: &ServerConfig) -> Result<QuarantineRecord> {
    let raw = read(&loc.path)?;
    let mut root: toml::Value = toml::from_str(&raw).map_err(|e| toml_err(&loc.path, e))?;

    {
        let tbl = toml_nav_mut(&mut root, &loc.key_path)
            .ok_or_else(|| Error::NotAnObject(loc.key_path.clone()))?;
        if !tbl.contains_key(&loc.server_key) {
            return Err(Error::NotFound(loc.server_key.clone()));
        }
    }

    let backup_path = backup_path(&loc.path);
    if !backup_path.exists() {
        write(&backup_path, &raw)?;
    }

    // Sidecar is JSON (built from the config), independent of the source format.
    let disabled_path = disabled_path(&loc.path);
    let mut disabled = read_disabled(&disabled_path)?;
    let entry = build_disabled_entry(cfg, &loc.path, &loc.key_path)?;
    disabled_servers(&mut disabled).insert(loc.server_key.clone(), entry);
    write(&disabled_path, &serialize(&disabled))?;

    toml_nav_mut(&mut root, &loc.key_path)
        .expect("key path validated above")
        .remove(&loc.server_key);
    let new_text = toml::to_string(&root).map_err(|e| Error::Json {
        path: loc.path.clone(),
        message: e.to_string(),
    })?;
    if let Err(e) = write(&loc.path, &new_text) {
        let _ = rollback_sidecar(&disabled_path, &loc.server_key);
        return Err(e);
    }

    Ok(record(loc, disabled_path, backup_path))
}

fn restore_toml(rec: &QuarantineRecord) -> Result<()> {
    let (disabled, mut entry) = take_disabled_entry(rec)?;
    if let Value::Object(m) = &mut entry {
        m.retain(|k, _| !k.starts_with("_sealgate"));
    }
    let toml_entry = toml::Value::try_from(&entry).map_err(|e| Error::Json {
        path: rec.source_path.clone(),
        message: e.to_string(),
    })?;

    let raw = read(&rec.source_path)?;
    let mut root: toml::Value = toml::from_str(&raw).map_err(|e| toml_err(&rec.source_path, e))?;
    toml_nav_create(&mut root, &rec.key_path)
        .ok_or_else(|| Error::NotAnObject(rec.key_path.clone()))?
        .insert(rec.server_key.clone(), toml_entry);
    let new_text = toml::to_string(&root).map_err(|e| Error::Json {
        path: rec.source_path.clone(),
        message: e.to_string(),
    })?;
    write(&rec.source_path, &new_text)?;

    finalize_sidecar(rec, &disabled)?;
    Ok(())
}

fn record(loc: &ConfigLocation, disabled_path: PathBuf, backup_path: PathBuf) -> QuarantineRecord {
    QuarantineRecord {
        kind: loc.kind,
        source_path: loc.path.clone(),
        disabled_path,
        backup_path,
        key_path: loc.key_path.clone(),
        server_key: loc.server_key.clone(),
        extra: loc.extra.clone(),
    }
}

// ── SQLite state.vscdb writer (Cursor marketplace, VSCode extensions) ─────────

fn quarantine_sqlite(loc: &ConfigLocation) -> Result<QuarantineRecord> {
    let LocationExtra::StateDb { item_key, shape } = &loc.extra else {
        return Err(Error::UnsupportedKind(loc.kind));
    };

    let raw =
        read_row(&loc.path, item_key)?.ok_or_else(|| Error::NotFound(loc.server_key.clone()))?;
    let mut blob: Value = serde_json::from_str(&raw).map_err(json_err(&loc.path))?;

    // Capture + remove the server's raw value (restore re-inserts it exactly).
    let captured = blob_remove(&mut blob, shape, &loc.server_key)?;

    // Back up the whole DB (binary copy) — once.
    let backup_path = backup_path(&loc.path);
    if !backup_path.exists() {
        std::fs::copy(&loc.path, &backup_path).map_err(|source| Error::Io {
            path: loc.path.clone(),
            source,
        })?;
    }

    let disabled_path = disabled_path(&loc.path);
    let mut disabled = read_disabled(&disabled_path)?;
    disabled_servers(&mut disabled).insert(loc.server_key.clone(), captured);
    write(&disabled_path, &serialize(&disabled))?;

    let new_blob = serde_json::to_string(&blob).map_err(json_err(&loc.path))?;
    if let Err(e) = write_row(&loc.path, item_key, &new_blob) {
        let _ = rollback_sidecar(&disabled_path, &loc.server_key);
        return Err(e);
    }

    Ok(record(loc, disabled_path, backup_path))
}

fn restore_sqlite(rec: &QuarantineRecord) -> Result<()> {
    let LocationExtra::StateDb { item_key, shape } = &rec.extra else {
        return Err(Error::UnsupportedKind(rec.kind));
    };

    let (disabled, captured) = take_disabled_entry(rec)?;
    let raw = read_row(&rec.source_path, item_key)?
        .ok_or_else(|| Error::NotFound(rec.server_key.clone()))?;
    let mut blob: Value = serde_json::from_str(&raw).map_err(json_err(&rec.source_path))?;
    blob_insert(&mut blob, shape, &rec.server_key, captured)?;

    let new_blob = serde_json::to_string(&blob).map_err(json_err(&rec.source_path))?;
    write_row(&rec.source_path, item_key, &new_blob)?;
    finalize_sidecar(rec, &disabled)?;
    Ok(())
}

/// Remove and return the server's value from a state-DB blob.
fn blob_remove(blob: &mut Value, shape: &StateShape, server_key: &str) -> Result<Value> {
    let missing = || Error::NotFound(server_key.to_string());
    match shape {
        StateShape::ObjectKey => blob
            .as_object_mut()
            .and_then(|o| o.remove(server_key))
            .ok_or_else(missing),
        StateShape::ArrayById { array_key } => {
            let arr = blob
                .get_mut(array_key)
                .and_then(Value::as_array_mut)
                .ok_or_else(missing)?;
            let pos = arr
                .iter()
                .position(|e| e.get("id").and_then(Value::as_str) == Some(server_key))
                .ok_or_else(missing)?;
            Ok(arr.remove(pos))
        }
    }
}

/// Re-insert a captured value back into a state-DB blob.
fn blob_insert(blob: &mut Value, shape: &StateShape, server_key: &str, value: Value) -> Result<()> {
    let root = blob
        .as_object_mut()
        .ok_or_else(|| Error::NotFound(server_key.to_string()))?;
    match shape {
        StateShape::ObjectKey => {
            root.insert(server_key.to_string(), value);
        }
        StateShape::ArrayById { array_key } => {
            root.entry(array_key.clone())
                .or_insert_with(|| Value::Array(Vec::new()))
                .as_array_mut()
                .ok_or_else(|| Error::NotFound(server_key.to_string()))?
                .push(value);
        }
    }
    Ok(())
}

// ── Cursor plugin-directory writer ───────────────────────────────────────────
//
// Neutralise a plugin by renaming its directory to `sg-disabled-<name>` (Cursor
// then ignores it; our discovery scan already skips `sg-disabled-*`). No sidecar
// or backup — the rename itself is the reversible state.

fn quarantine_plugin_dir(loc: &ConfigLocation) -> Result<QuarantineRecord> {
    let dir = &loc.path;
    let name = dir
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "plugin".into());
    let disabled = dir.with_file_name(format!("sg-disabled-{name}"));
    // A stale disabled copy from a prior quarantine blocks the rename
    // (ENOTEMPTY); the live dir is the one to neutralise now, so drop the stale
    // copy first.
    if disabled.exists() {
        let _ = std::fs::remove_dir_all(&disabled);
    }
    std::fs::rename(dir, &disabled).map_err(|source| Error::Io {
        path: dir.clone(),
        source,
    })?;
    Ok(QuarantineRecord {
        kind: loc.kind,
        source_path: dir.clone(),
        disabled_path: disabled,
        backup_path: dir.clone(), // unused for dir-rename
        key_path: loc.key_path.clone(),
        server_key: loc.server_key.clone(),
        extra: loc.extra.clone(),
    })
}

fn restore_plugin_dir(rec: &QuarantineRecord) -> Result<()> {
    // If the plugin dir already exists again (Cursor re-created it), the disabled
    // copy is redundant — drop it rather than fail the rename.
    if rec.source_path.exists() {
        let _ = std::fs::remove_dir_all(&rec.disabled_path);
        return Ok(());
    }
    std::fs::rename(&rec.disabled_path, &rec.source_path).map_err(|source| Error::Io {
        path: rec.disabled_path.clone(),
        source,
    })
}

fn json_err(path: &Path) -> impl Fn(serde_json::Error) -> Error + '_ {
    move |e| Error::Json {
        path: path.to_path_buf(),
        message: e.to_string(),
    }
}

/// Take the entry out of the sidecar; returns (sidecar-value, removed-entry).
fn take_disabled_entry(rec: &QuarantineRecord) -> Result<(Value, Value)> {
    let mut disabled = read_disabled(&rec.disabled_path)?;
    let entry = disabled_servers(&mut disabled)
        .remove(&rec.server_key)
        .ok_or_else(|| Error::NotFound(rec.server_key.clone()))?;
    Ok((disabled, entry))
}

// ── helpers ────────────────────────────────────────────────────────────────

pub(crate) fn read(path: &Path) -> Result<String> {
    std::fs::read_to_string(path).map_err(|source| Error::Io {
        path: path.to_path_buf(),
        source,
    })
}

pub(crate) fn write(path: &Path, contents: &str) -> Result<()> {
    std::fs::write(path, contents).map_err(|source| Error::Io {
        path: path.to_path_buf(),
        source,
    })
}

/// Parse JSON-with-comments into a value (lenient, matching how agents read).
pub(crate) fn parse(raw: &str, path: &Path) -> Result<Value> {
    serde_json_lenient::from_str(raw).map_err(|e| Error::Json {
        path: path.to_path_buf(),
        message: e.to_string(),
    })
}

pub(crate) fn serialize(value: &Value) -> String {
    let mut s = serde_json::to_string_pretty(value).expect("Value always serialises");
    s.push('\n');
    s
}

/// Navigate to the object map at `key_path` (read/modify; no creation).
fn nav_mut<'a>(root: &'a mut Value, key_path: &[String]) -> Option<&'a mut Map<String, Value>> {
    let mut cur = root.as_object_mut()?;
    for k in key_path {
        cur = cur.get_mut(k)?.as_object_mut()?;
    }
    Some(cur)
}

/// Navigate to the object map at `key_path`, creating empty objects as needed.
fn nav_create<'a>(root: &'a mut Value, key_path: &[String]) -> Option<&'a mut Map<String, Value>> {
    let mut cur = root.as_object_mut()?;
    for k in key_path {
        cur = cur
            .entry(k.clone())
            .or_insert_with(|| Value::Object(Map::new()))
            .as_object_mut()?;
    }
    Some(cur)
}

fn toml_err(path: &Path, e: toml::de::Error) -> Error {
    Error::Json {
        path: path.to_path_buf(),
        message: e.to_string(),
    }
}

/// Navigate to the TOML table at `key_path` (read/modify; no creation).
fn toml_nav_mut<'a>(root: &'a mut toml::Value, key_path: &[String]) -> Option<&'a mut toml::Table> {
    let mut cur = root.as_table_mut()?;
    for k in key_path {
        cur = cur.get_mut(k)?.as_table_mut()?;
    }
    Some(cur)
}

/// Navigate to the TOML table at `key_path`, creating empty tables as needed.
fn toml_nav_create<'a>(
    root: &'a mut toml::Value,
    key_path: &[String],
) -> Option<&'a mut toml::Table> {
    let mut cur = root.as_table_mut()?;
    for k in key_path {
        cur = cur
            .entry(k.clone())
            .or_insert_with(|| toml::Value::Table(toml::Table::new()))
            .as_table_mut()?;
    }
    Some(cur)
}

fn disabled_path(path: &Path) -> PathBuf {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "config.json".into());
    // Daemon-distinct prefix (`ewd-` = sealgate daemon) so we never share the
    // Electron app's `disabled_<config>.json` sidecar — different schema, and
    // concurrent writes would race.
    path.with_file_name(format!("ewd-disabled_{name}"))
}

/// The one-time backup taken before SealGate first edits `path`. Public so the
/// daemon can report it to the UI, which offers "revert this config".
pub fn backup_path(path: &Path) -> PathBuf {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "config.json".into());
    path.with_file_name(format!("{name}.sg-backup"))
}

// ── sealgate install (the inverse of quarantine: ADD an entry) ───────────

const SEALGATE_SERVER_NAME: &str = "sealgate";
const SEALGATE_SECRET_HEADER: &str = "X-Edison-Secret-Key";

/// The sealgate proxy URL: `<mcp_base>/mcp/<api_key>/?client=<client_id>`.
pub fn sealgate_url(mcp_base: &str, api_key: &str, client_id: &str) -> String {
    format!(
        "{}/mcp/{}/?client={}",
        mcp_base.trim_end_matches('/'),
        api_key,
        client_id
    )
}

/// Install the `sealgate` proxy entry into `inst`'s config (creating the
/// file if needed, alongside existing servers, with a one-time backup). The URL
/// is `<mcp_base>/mcp/<api_key>/?client=<client_id>`; when `secret` is set it is
/// carried in the `X-Edison-Secret-Key` header.
pub fn install_sealgate(
    inst: &SealGateInstall,
    mcp_base: &str,
    api_key: &str,
    secret: Option<&str>,
) -> Result<()> {
    let url = sealgate_url(mcp_base, api_key, &inst.client_id);
    match inst.style {
        SealGateStyle::Http => install_json(inst, http_entry(&url, secret)),
        SealGateStyle::Toml => install_toml(inst, &url, secret),
    }
}

fn http_entry(url: &str, secret: Option<&str>) -> Value {
    let mut entry = json!({ "type": "http", "url": url });
    if let Some(s) = secret {
        entry["headers"] = json!({ SEALGATE_SECRET_HEADER: s });
    }
    entry
}

/// Remove the `sealgate` entry from `inst`'s config (no-op if absent).
pub fn uninstall_sealgate(inst: &SealGateInstall) -> Result<()> {
    match inst.style {
        SealGateStyle::Toml => uninstall_toml(inst),
        // Named rather than `_`, so a third style has to decide for itself
        // instead of silently inheriting JSON removal. `install_sealgate` is
        // exhaustive for the same reason; the pair should fail together.
        SealGateStyle::Http => uninstall_json(inst),
    }
}

fn uninstall_json(inst: &SealGateInstall) -> Result<()> {
    if !inst.path.exists() {
        return Ok(());
    }
    let raw = read(&inst.path)?;
    let mut root = parse(&raw, &inst.path)?;
    if let Some(map) = nav_mut(&mut root, &inst.key_path) {
        map.remove(SEALGATE_SERVER_NAME);
    }
    write(&inst.path, &serialize(&root))
}

fn ensure_parent(path: &Path) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|source| Error::Io {
            path: parent.to_path_buf(),
            source,
        })?;
    }
    Ok(())
}

fn install_json(inst: &SealGateInstall, entry: Value) -> Result<()> {
    ensure_parent(&inst.path)?;
    let existed = inst.path.exists();
    let raw = if existed {
        read(&inst.path)?
    } else {
        String::new()
    };
    let mut root = if raw.trim().is_empty() {
        Value::Object(Map::new())
    } else {
        parse(&raw, &inst.path)?
    };
    if existed {
        let bp = backup_path(&inst.path);
        if !bp.exists() {
            write(&bp, &raw)?;
        }
    }
    nav_create(&mut root, &inst.key_path)
        .ok_or_else(|| Error::NotAnObject(inst.key_path.clone()))?
        .insert(SEALGATE_SERVER_NAME.to_string(), entry);
    write(&inst.path, &serialize(&root))
}

fn install_toml(inst: &SealGateInstall, url: &str, secret: Option<&str>) -> Result<()> {
    ensure_parent(&inst.path)?;
    let existed = inst.path.exists();
    let raw = if existed {
        read(&inst.path)?
    } else {
        String::new()
    };
    let mut root: toml::Value = if raw.trim().is_empty() {
        toml::Value::Table(toml::Table::new())
    } else {
        toml::from_str(&raw).map_err(|e| toml_err(&inst.path, e))?
    };
    if existed {
        let bp = backup_path(&inst.path);
        if !bp.exists() {
            write(&bp, &raw)?;
        }
    }
    let mut entry = toml::Table::new();
    entry.insert("url".into(), toml::Value::String(url.to_string()));
    if let Some(s) = secret {
        let mut headers = toml::Table::new();
        headers.insert(
            SEALGATE_SECRET_HEADER.into(),
            toml::Value::String(s.to_string()),
        );
        entry.insert("http_headers".into(), toml::Value::Table(headers));
    }

    let servers = root
        .as_table_mut()
        .ok_or_else(|| Error::NotAnObject(vec![]))?
        .entry(inst.key_path[0].clone())
        .or_insert_with(|| toml::Value::Table(toml::Table::new()))
        .as_table_mut()
        .ok_or_else(|| Error::NotAnObject(inst.key_path.clone()))?;
    servers.insert(SEALGATE_SERVER_NAME.to_string(), toml::Value::Table(entry));

    let text = toml::to_string(&root).map_err(|e| Error::Json {
        path: inst.path.clone(),
        message: e.to_string(),
    })?;
    write(&inst.path, &text)
}

fn uninstall_toml(inst: &SealGateInstall) -> Result<()> {
    if !inst.path.exists() {
        return Ok(());
    }
    let raw = read(&inst.path)?;
    let mut root: toml::Value = toml::from_str(&raw).map_err(|e| toml_err(&inst.path, e))?;
    if let Some(servers) = root
        .as_table_mut()
        .and_then(|t| t.get_mut(&inst.key_path[0]))
        .and_then(|v| v.as_table_mut())
    {
        servers.remove(SEALGATE_SERVER_NAME);
    }
    let text = toml::to_string(&root).map_err(|e| Error::Json {
        path: inst.path.clone(),
        message: e.to_string(),
    })?;
    write(&inst.path, &text)
}

fn read_disabled(path: &Path) -> Result<Value> {
    if path.exists() {
        parse(&read(path)?, path)
    } else {
        Ok(json!({ "quarantinedBy": QUARANTINED_BY, "servers": {} }))
    }
}

/// Get (creating if needed) the `servers` map of a disabled sidecar value.
fn disabled_servers(disabled: &mut Value) -> &mut Map<String, Value> {
    nav_create(disabled, &["servers".to_string()]).expect("disabled root is an object")
}

fn rollback_sidecar(disabled_path: &Path, server_key: &str) -> Result<()> {
    let mut disabled = read_disabled(disabled_path)?;
    disabled_servers(&mut disabled).remove(server_key);
    write(disabled_path, &serialize(&disabled))
}

/// After a restore, persist the sidecar: when it has no servers left, delete it
/// and the now-stale backup (the file is fully restored); otherwise write it
/// back with the remaining entries.
fn finalize_sidecar(rec: &QuarantineRecord, disabled: &Value) -> Result<()> {
    let empty = disabled
        .get("servers")
        .and_then(Value::as_object)
        .is_none_or(|m| m.is_empty());
    if empty {
        let _ = std::fs::remove_file(&rec.disabled_path);
        let _ = std::fs::remove_file(&rec.backup_path);
        Ok(())
    } else {
        write(&rec.disabled_path, &serialize(disabled))
    }
}

/// Serialise a server config plus restore metadata for the sidecar.
fn build_disabled_entry(cfg: &ServerConfig, original: &Path, key_path: &[String]) -> Result<Value> {
    let mut entry = config_to_value(cfg).ok_or(Error::NotActionable)?;
    if let Value::Object(m) = &mut entry {
        m.insert(META_ORIGINAL_FILE.into(), json!(original.to_string_lossy()));
        m.insert(META_KEY_PATH.into(), json!(key_path));
    }
    Ok(entry)
}

/// Render a [`ServerConfig`] back to its on-disk JSON shape.
fn config_to_value(cfg: &ServerConfig) -> Option<Value> {
    match cfg {
        ServerConfig::Stdio { command, args, env } => {
            let mut m = Map::new();
            m.insert("command".into(), json!(command));
            if !args.is_empty() {
                m.insert("args".into(), json!(args));
            }
            if !env.is_empty() {
                m.insert("env".into(), json!(env));
            }
            Some(Value::Object(m))
        }
        ServerConfig::Http { url, headers, kind } => {
            let ty = match kind {
                HttpKind::Http => "http",
                HttpKind::Sse => "sse",
                HttpKind::StreamableHttp => "streamable-http",
            };
            let mut m = Map::new();
            m.insert("type".into(), json!(ty));
            m.insert("url".into(), json!(url));
            if !headers.is_empty() {
                m.insert("headers".into(), json!(headers));
            }
            Some(Value::Object(m))
        }
        ServerConfig::Opaque { .. } => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use tempfile::tempdir;

    fn loc(path: &Path, key_path: &[&str], server_key: &str) -> ConfigLocation {
        ConfigLocation {
            kind: SourceKind::Jsonc,
            path: path.to_path_buf(),
            key_path: key_path.iter().map(|s| s.to_string()).collect(),
            server_key: server_key.into(),
            extra: sealgate_detectord::LocationExtra::None,
        }
    }

    fn stdio(command: &str, args: &[&str]) -> ServerConfig {
        ServerConfig::Stdio {
            command: command.into(),
            args: args.iter().map(|s| s.to_string()).collect(),
            env: BTreeMap::new(),
        }
    }

    fn servers_in(path: &Path, key_path: &[&str]) -> Vec<String> {
        let mut root: Value =
            serde_json_lenient::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        let kp: Vec<String> = key_path.iter().map(|s| s.to_string()).collect();
        nav_mut(&mut root, &kp)
            .map(|m| m.keys().cloned().collect())
            .unwrap_or_default()
    }

    #[test]
    fn quarantine_removes_from_original_and_writes_sidecar_and_backup() {
        let dir = tempdir().unwrap();
        let cfg = dir.path().join("mcp.json");
        std::fs::write(
            &cfg,
            r#"{"servers":{"keep":{"command":"a"},"evil":{"command":"x","args":["--bad"]}}}"#,
        )
        .unwrap();

        let store = FileConfigStore;
        let rec = store
            .quarantine(&loc(&cfg, &["servers"], "evil"), &stdio("x", &["--bad"]))
            .unwrap();

        // Original keeps "keep", loses "evil".
        assert_eq!(servers_in(&cfg, &["servers"]), vec!["keep".to_string()]);
        // Backup is the verbatim original (still has evil).
        assert!(rec.backup_path.exists());
        assert!(
            std::fs::read_to_string(&rec.backup_path)
                .unwrap()
                .contains("evil")
        );
        // Sidecar holds evil + restore metadata.
        let disabled: Value =
            serde_json::from_str(&std::fs::read_to_string(&rec.disabled_path).unwrap()).unwrap();
        let entry = &disabled["servers"]["evil"];
        assert_eq!(entry["command"], "x");
        assert_eq!(entry[META_KEY_PATH], json!(["servers"]));
    }

    fn sealgate(
        path: &std::path::Path,
        key: &[&str],
        style: SealGateStyle,
        client: &str,
    ) -> SealGateInstall {
        SealGateInstall {
            path: path.to_path_buf(),
            key_path: key.iter().map(|s| s.to_string()).collect(),
            style,
            client_id: client.to_string(),
            prefer_cli: false,
        }
    }

    #[test]
    fn install_sealgate_http_adds_alongside_and_uninstall_removes() {
        let dir = tempdir().unwrap();
        let cfg = dir.path().join("mcp.json");
        std::fs::write(&cfg, r#"{"mcpServers":{"keep":{"command":"x"}}}"#).unwrap();
        let inst = sealgate(&cfg, &["mcpServers"], SealGateStyle::Http, "cursor");

        install_sealgate(&inst, "http://localhost:3000/", "sealgate_KEY", None).unwrap();
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&cfg).unwrap()).unwrap();
        assert_eq!(v["mcpServers"]["sealgate"]["type"], "http");
        assert_eq!(
            v["mcpServers"]["sealgate"]["url"],
            "http://localhost:3000/mcp/sealgate_KEY/?client=cursor"
        );
        assert!(v["mcpServers"]["keep"].is_object()); // existing preserved
        assert!(cfg.with_file_name("mcp.json.sg-backup").exists());

        uninstall_sealgate(&inst).unwrap();
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&cfg).unwrap()).unwrap();
        assert!(v["mcpServers"].get("sealgate").is_none());
        assert!(v["mcpServers"]["keep"].is_object());
    }

    #[test]
    fn install_sealgate_with_secret_adds_header() {
        let dir = tempdir().unwrap();
        let cfg = dir.path().join("mcp.json");
        let inst = sealgate(&cfg, &["mcpServers"], SealGateStyle::Http, "cursor");
        install_sealgate(&inst, "http://localhost:3000", "K", Some("user:SEKRET")).unwrap();
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&cfg).unwrap()).unwrap();
        assert_eq!(
            v["mcpServers"]["sealgate"]["headers"]["X-Edison-Secret-Key"],
            "user:SEKRET"
        );

        // TOML variant carries it under http_headers.
        let tcfg = dir.path().join("config.toml");
        let tinst = sealgate(&tcfg, &["mcp_servers"], SealGateStyle::Toml, "codex");
        install_sealgate(&tinst, "http://localhost:3000", "K", Some("user:SEKRET")).unwrap();
        let t: toml::Value = toml::from_str(&std::fs::read_to_string(&tcfg).unwrap()).unwrap();
        assert_eq!(
            t["mcp_servers"]["sealgate"]["http_headers"]["X-Edison-Secret-Key"]
                .as_str()
                .unwrap(),
            "user:SEKRET"
        );
    }

    #[test]
    fn edits_preserve_existing_server_order() {
        let dir = tempdir().unwrap();
        let cfg = dir.path().join("mcp.json");
        std::fs::write(
            &cfg,
            r#"{"mcpServers":{"zebra":{"command":"z"},"apple":{"command":"a"},"mango":{"command":"m"}}}"#,
        )
        .unwrap();
        install_sealgate(
            &sealgate(&cfg, &["mcpServers"], SealGateStyle::Http, "cursor"),
            "http://h",
            "K",
            None,
        )
        .unwrap();
        let text = std::fs::read_to_string(&cfg).unwrap();
        let (z, a, m, e) = (
            text.find("zebra").unwrap(),
            text.find("apple").unwrap(),
            text.find("mango").unwrap(),
            text.find("sealgate").unwrap(),
        );
        assert!(
            z < a && a < m && m < e,
            "original order kept, sealgate appended:\n{text}"
        );
    }

    #[test]
    fn install_sealgate_creates_missing_file_and_dirs() {
        let dir = tempdir().unwrap();
        let cfg = dir.path().join("nested/mcp.json"); // parent absent
        let inst = sealgate(&cfg, &["mcpServers"], SealGateStyle::Http, "cursor");
        install_sealgate(&inst, "http://localhost:3000", "K", None).unwrap();
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&cfg).unwrap()).unwrap();
        assert_eq!(
            v["mcpServers"]["sealgate"]["url"],
            "http://localhost:3000/mcp/K/?client=cursor"
        );
    }

    #[test]
    fn uninstall_sealgate_leaves_the_user_servers_alone() {
        let dir = tempdir().unwrap();
        let cfg = dir.path().join("mcp.json");
        std::fs::write(
            &cfg,
            r#"{"mcpServers":{"sealgate":{"type":"http","url":"https://x"},"mine":{"command":"x"}}}"#,
        )
        .unwrap();

        uninstall_sealgate(&sealgate(&cfg, &["mcpServers"], SealGateStyle::Http, "cursor")).unwrap();

        let v: Value = serde_json::from_str(&std::fs::read_to_string(&cfg).unwrap()).unwrap();
        assert!(v["mcpServers"].get("sealgate").is_none());
        assert!(v["mcpServers"].get("mine").is_some());
    }

    #[test]
    fn install_sealgate_toml() {
        let dir = tempdir().unwrap();
        let cfg = dir.path().join("config.toml");
        std::fs::write(&cfg, "[mcp_servers.keep]\ncommand = \"x\"\n").unwrap();
        let inst = sealgate(&cfg, &["mcp_servers"], SealGateStyle::Toml, "codex");
        install_sealgate(&inst, "http://localhost:3000", "K", None).unwrap();
        let t: toml::Value = toml::from_str(&std::fs::read_to_string(&cfg).unwrap()).unwrap();
        assert_eq!(
            t["mcp_servers"]["sealgate"]["url"].as_str().unwrap(),
            "http://localhost:3000/mcp/K/?client=codex"
        );
        assert!(t["mcp_servers"].get("keep").is_some());
        uninstall_sealgate(&inst).unwrap();
        let t: toml::Value = toml::from_str(&std::fs::read_to_string(&cfg).unwrap()).unwrap();
        assert!(t["mcp_servers"].get("sealgate").is_none());
    }

    #[test]
    fn backup_captures_full_original_and_is_cleaned_on_restore() {
        let dir = tempdir().unwrap();
        let cfg = dir.path().join("mcp.json");
        std::fs::write(
            &cfg,
            r#"{"servers":{"a":{"command":"x"},"b":{"command":"y"}}}"#,
        )
        .unwrap();
        let store = FileConfigStore;

        // Quarantine both servers from the same file, one after the other.
        let ra = store
            .quarantine(&loc(&cfg, &["servers"], "a"), &stdio("x", &[]))
            .unwrap();
        let rb = store
            .quarantine(&loc(&cfg, &["servers"], "b"), &stdio("y", &[]))
            .unwrap();

        // The backup is a single file capturing the FULL original (both servers),
        // not the partially-emptied state at the second quarantine.
        let backup: Value =
            serde_json::from_str(&std::fs::read_to_string(&ra.backup_path).unwrap()).unwrap();
        assert!(backup["servers"].get("a").is_some());
        assert!(backup["servers"].get("b").is_some());

        // Restoring the last one empties the sidecar → sidecar + backup removed.
        store.restore(&ra).unwrap();
        assert!(rb.disabled_path.exists()); // still has "b"
        store.restore(&rb).unwrap();
        assert!(!rb.disabled_path.exists());
        assert!(!rb.backup_path.exists());
    }

    #[test]
    fn restore_round_trips() {
        let dir = tempdir().unwrap();
        let cfg = dir.path().join("mcp.json");
        std::fs::write(
            &cfg,
            r#"{"servers":{"evil":{"command":"x","args":["--bad"]}}}"#,
        )
        .unwrap();

        let store = FileConfigStore;
        let rec = store
            .quarantine(&loc(&cfg, &["servers"], "evil"), &stdio("x", &["--bad"]))
            .unwrap();
        assert!(servers_in(&cfg, &["servers"]).is_empty());

        store.restore(&rec).unwrap();
        assert_eq!(servers_in(&cfg, &["servers"]), vec!["evil".to_string()]);
        // Sidecar was the only entry → it (and the backup) are cleaned up.
        assert!(!rec.disabled_path.exists());
        // Restored entry is clean (no metadata leaked in).
        let mut root: Value =
            serde_json_lenient::from_str(&std::fs::read_to_string(&cfg).unwrap()).unwrap();
        let entry = nav_mut(&mut root, &["servers".into()]).unwrap()["evil"].clone();
        assert!(entry.get(META_ORIGINAL_FILE).is_none());
        assert_eq!(entry["command"], "x");
    }

    #[test]
    fn quarantine_nested_key_path() {
        let dir = tempdir().unwrap();
        let cfg = dir.path().join(".claude.json");
        std::fs::write(
            &cfg,
            r#"{"projects":{"/p":{"mcpServers":{"evil":{"command":"x"}}}}}"#,
        )
        .unwrap();

        let store = FileConfigStore;
        store
            .quarantine(
                &loc(&cfg, &["projects", "/p", "mcpServers"], "evil"),
                &stdio("x", &[]),
            )
            .unwrap();
        assert!(servers_in(&cfg, &["projects", "/p", "mcpServers"]).is_empty());
    }

    #[test]
    fn quarantine_jsonc_with_comments_succeeds() {
        let dir = tempdir().unwrap();
        let cfg = dir.path().join("mcp.json");
        std::fs::write(
            &cfg,
            "{\n  // my servers\n  \"servers\": { \"evil\": { \"command\": \"x\" } }\n}",
        )
        .unwrap();

        let store = FileConfigStore;
        store
            .quarantine(&loc(&cfg, &["servers"], "evil"), &stdio("x", &[]))
            .unwrap();
        assert!(servers_in(&cfg, &["servers"]).is_empty());
    }

    #[test]
    fn missing_server_is_not_found() {
        let dir = tempdir().unwrap();
        let cfg = dir.path().join("mcp.json");
        std::fs::write(&cfg, r#"{"servers":{"other":{"command":"a"}}}"#).unwrap();
        let store = FileConfigStore;
        let err = store
            .quarantine(&loc(&cfg, &["servers"], "evil"), &stdio("x", &[]))
            .unwrap_err();
        assert!(matches!(err, Error::NotFound(_)));
    }

    #[test]
    fn quarantine_and_restore_toml() {
        let dir = tempdir().unwrap();
        let cfg = dir.path().join("config.toml");
        std::fs::write(
            &cfg,
            "model = \"x\"\n\n[mcp_servers.evil]\ncommand = \"run\"\nargs = [\"--bad\"]\n",
        )
        .unwrap();

        let store = FileConfigStore;
        let loc = ConfigLocation {
            kind: SourceKind::Toml,
            path: cfg.clone(),
            key_path: vec!["mcp_servers".into()],
            server_key: "evil".into(),
            extra: sealgate_detectord::LocationExtra::None,
        };

        let rec = store.quarantine(&loc, &stdio("run", &["--bad"])).unwrap();
        let after = std::fs::read_to_string(&cfg).unwrap();
        assert!(!after.contains("evil"));
        assert!(after.contains("model")); // unrelated content preserved

        store.restore(&rec).unwrap();
        let restored = std::fs::read_to_string(&cfg).unwrap();
        // Re-parse to confirm the server is back under [mcp_servers].
        let root: toml::Value = toml::from_str(&restored).unwrap();
        assert!(root["mcp_servers"].as_table().unwrap().contains_key("evil"));
    }

    fn make_state_db(db: &std::path::Path, key: &str, value: &Value) {
        let conn = rusqlite::Connection::open(db).unwrap();
        conn.execute(
            "CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value BLOB)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO ItemTable (key, value) VALUES (?1, ?2)",
            rusqlite::params![key, value.to_string()],
        )
        .unwrap();
    }

    fn read_row(db: &std::path::Path, key: &str) -> Value {
        let conn = rusqlite::Connection::open(db).unwrap();
        let raw: String = conn
            .query_row("SELECT value FROM ItemTable WHERE key = ?1", [key], |r| {
                r.get(0)
            })
            .unwrap();
        serde_json::from_str(&raw).unwrap()
    }

    #[test]
    fn sqlite_object_key_round_trip() {
        let dir = tempdir().unwrap();
        let db = dir.path().join("state.vscdb");
        make_state_db(
            &db,
            "anysphere.cursor-mcp",
            &json!({"[user-notion] mcp_server_url": "https://x", "other": "keep"}),
        );

        let loc = ConfigLocation {
            kind: SourceKind::SqliteState,
            path: db.clone(),
            key_path: vec![],
            server_key: "[user-notion] mcp_server_url".into(),
            extra: LocationExtra::StateDb {
                item_key: "anysphere.cursor-mcp".into(),
                shape: StateShape::ObjectKey,
            },
        };

        let store = FileConfigStore;
        let rec = store.quarantine(&loc, &stdio("unused", &[])).unwrap();
        let row = read_row(&db, "anysphere.cursor-mcp");
        assert!(row.get("[user-notion] mcp_server_url").is_none());
        assert!(row.get("other").is_some());
        assert!(rec.backup_path.exists());

        store.restore(&rec).unwrap();
        let row = read_row(&db, "anysphere.cursor-mcp");
        assert_eq!(row["[user-notion] mcp_server_url"], "https://x");
    }

    #[test]
    fn sqlite_array_by_id_round_trip() {
        let dir = tempdir().unwrap();
        let db = dir.path().join("state.vscdb");
        make_state_db(
            &db,
            "mcpToolCache",
            &json!({"extensionServers": [
                {"id": "ext.a", "serverUrl": "https://a"},
                {"id": "ext.b", "serverUrl": "https://b"}
            ]}),
        );

        let loc = ConfigLocation {
            kind: SourceKind::SqliteState,
            path: db.clone(),
            key_path: vec![],
            server_key: "ext.a".into(),
            extra: LocationExtra::StateDb {
                item_key: "mcpToolCache".into(),
                shape: StateShape::ArrayById {
                    array_key: "extensionServers".into(),
                },
            },
        };

        let store = FileConfigStore;
        let rec = store.quarantine(&loc, &stdio("unused", &[])).unwrap();
        let ids: Vec<String> = read_row(&db, "mcpToolCache")["extensionServers"]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| e["id"].as_str().unwrap().to_string())
            .collect();
        assert_eq!(ids, vec!["ext.b".to_string()]);

        store.restore(&rec).unwrap();
        let ids: Vec<String> = read_row(&db, "mcpToolCache")["extensionServers"]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| e["id"].as_str().unwrap().to_string())
            .collect();
        assert!(ids.contains(&"ext.a".to_string()));
        assert!(ids.contains(&"ext.b".to_string()));
    }

    #[test]
    fn plugin_dir_round_trip() {
        let dir = tempdir().unwrap();
        let plugin = dir.path().join("my-plugin");
        std::fs::create_dir_all(plugin.join("inner")).unwrap();
        std::fs::write(plugin.join("mcp.json"), "{}").unwrap();

        let loc = ConfigLocation {
            kind: SourceKind::CursorPluginDir,
            path: plugin.clone(),
            key_path: vec![],
            server_key: "my-plugin".into(),
            extra: LocationExtra::None,
        };

        let store = FileConfigStore;
        let rec = store.quarantine(&loc, &stdio("unused", &[])).unwrap();
        assert!(!plugin.exists());
        assert!(rec.disabled_path.exists());
        assert!(
            rec.disabled_path
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("sg-disabled-")
        );

        store.restore(&rec).unwrap();
        assert!(plugin.exists());
        assert!(plugin.join("mcp.json").exists());
        assert!(!rec.disabled_path.exists());
    }
}
