//! Edison Watch **hook injection** (phase-2 mirror of the edison-watch install).
//!
//! Materialises four self-contained scripts into `~/.edison-watch/` and injects
//! per-agent hook config that runs them. The scripts only write files into
//! `~/.edison-watch/pending/` (and `errors/`) — no network, no secrets, no
//! running server required. The bodies are copied verbatim from the app so the
//! runtime behaviour (session-id tagging, pending-file format) is identical.

use std::path::{Path, PathBuf};

use edison_detectord::{HookBinding, HookInstall, HookScriptKind, HookStyle};
use regex::Regex;
use serde_json::{Map, Value, json};

use crate::configstore::{backup_path, parse, read, serialize, write};
use crate::error::{Error, Result};

/// A command belongs to us if it runs one of our scripts — matched by the
/// distinctive script-filename stems (robust regardless of the install dir).
fn cmd_str_is_edison(cmd: &str) -> bool {
    cmd.contains("edison-hook.") || cmd.contains("edison-session-")
}

// ── materialised scripts (verbatim from client_2 hookInjectionCore.ts) ───────

const REGISTRATION_SH_TEMPLATE: &str = r#"#!/bin/bash
# Edison Watch - Project Registration Hook
# Writes a registration file for Edison Watch to process

# Get the client that called this hook (passed as first argument)
CLIENT="${1:-unknown}"

# Pending registrations and errors directories
PENDING_DIR="__PENDING_DIR__"
ERRORS_DIR="__ERRORS_DIR__"

# Create directories if they don't exist
mkdir -p "$PENDING_DIR"
mkdir -p "$ERRORS_DIR"

# Generate unique filename
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
RANDOM_ID=$RANDOM
FILENAME="${TIMESTAMP}-${RANDOM_ID}-${CLIENT}.json"

# Get current working directory
CWD="$(pwd)"

# Write registration file (atomic via temp file + mv)
TEMP_FILE="$PENDING_DIR/.${FILENAME}.tmp"
echo "{\"projectPath\": \"$CWD\", \"registeredBy\": \"$CLIENT\", \"timestamp\": \"$TIMESTAMP\"}" > "$TEMP_FILE"
if ! mv "$TEMP_FILE" "$PENDING_DIR/$FILENAME" 2>/dev/null; then
  echo "{\"error\":\"mv failed\",\"client\":\"$CLIENT\",\"timestamp\":\"$(date -Iseconds)\"}" > "$ERRORS_DIR/${TIMESTAMP}-${RANDOM_ID}.json"
fi

# Always exit successfully so we don't block the MCP client
exit 0
"#;

const SESSION_START_PY: &str = r####"#!/usr/bin/env python3
import json, sys, os
try:
    data = json.load(sys.stdin)
    session_id = data.get("session_id") or data.get("sessionId")
    # Skip on Windows: .cmd wrapper means PPID is ephemeral cmd.exe, not Claude Code.
    # PreToolUse falls back to hook payload session_id on Windows.
    if session_id and sys.platform != "win32":
        edison_dir = os.path.expanduser("~/.edison-watch")
        os.makedirs(edison_dir, exist_ok=True)
        # PPID = Claude Code process ID. Relies on Claude Code spawning hooks as
        # direct children (execFile/spawn, not sh -c). Falls back gracefully if not.
        ppid = os.getppid()
        fname = f"active_session_{ppid}.json"
        tmp = os.path.join(edison_dir, f".{fname}.tmp")
        final = os.path.join(edison_dir, fname)
        with open(tmp, "w") as f:
            json.dump({"session_id": session_id}, f)
        os.rename(tmp, final)
except Exception:
    pass
sys.exit(0)
"####;

const SESSION_END_PY: &str = r####"#!/usr/bin/env python3
import json, sys, os, time, random
try:
    data = json.load(sys.stdin)
    conv_id = data.get("session_id") or data.get("conversation_id") or data.get("sessionId")
    reason = data.get("reason", "unknown")
    if conv_id:
        pending_dir = os.path.expanduser("~/.edison-watch/pending")
        os.makedirs(pending_dir, exist_ok=True)
        ts = time.strftime("%Y%m%d-%H%M%S")
        fname = f"{ts}-{random.randint(0,99999)}-session-end.json"
        tmp = os.path.join(pending_dir, f".{fname}.tmp")
        final = os.path.join(pending_dir, fname)
        with open(tmp, "w") as f:
            json.dump({"event": "session_end", "conversation_id": conv_id,
                        "reason": reason, "timestamp": ts}, f)
        os.rename(tmp, final)
except Exception:
    pass
# Clean up PID-scoped active session file - runs regardless of pending-write outcome
# Skip on Windows: .cmd wrapper means PPID is ephemeral cmd.exe, not Claude Code
try:
    if sys.platform != "win32":
        ppid = os.getppid()
        active_file = os.path.expanduser(f"~/.edison-watch/active_session_{ppid}.json")
        if os.path.exists(active_file):
            os.remove(active_file)
except Exception:
    pass
sys.exit(0)
"####;

const SESSION_HOOK_PY: &str = r####"#!/usr/bin/env python3
import json
import sys
import os

try:
    data = json.load(sys.stdin)
    # Detect client: VSCode Copilot (camelCase), Claude Code (snake_case), or Cursor (flat)
    is_vscode = "hookEventName" in data
    is_claude_code = "hook_event_name" in data
    uses_hook_output = is_vscode or is_claude_code
    # Extract conversation/session ID per client format
    if is_vscode:
        conv_id = data.get("sessionId")
    elif is_claude_code:
        # Try PID-scoped active session file first (authoritative, written by SessionStart hook)
        # Skip on Windows: .cmd wrapper gives ephemeral PPID, file won't match
        conv_id = None
        try:
            if sys.platform != "win32":
                ppid = os.getppid()
                active_file = os.path.expanduser(f"~/.edison-watch/active_session_{ppid}.json")
                if os.path.exists(active_file):
                    with open(active_file, "r") as f:
                        active_data = json.load(f)
                    conv_id = active_data.get("session_id")
        except Exception:
            pass
        # Fall back to hook payload data
        if not conv_id:
            conv_id = data.get("session_id") or data.get("conversation_id")
    else:
        conv_id = data.get("conversation_id")
    # Extract tool input (VSCode uses camelCase toolInput)
    tool_input = data.get("toolInput", data.get("tool_input", {})) if is_vscode else data.get("tool_input", {})
    if conv_id and isinstance(tool_input, dict):
        tool_input["_edison_conversation_id"] = conv_id
        if uses_hook_output:
            hook_event = data.get("hookEventName") or data.get("hook_event_name") or "PreToolUse"
            print(json.dumps({"hookSpecificOutput": {
                "hookEventName": hook_event,
                "permissionDecision": "allow", "updatedInput": tool_input}}))
        else:
            print(json.dumps({"decision": "allow", "updated_input": tool_input}))
    else:
        if uses_hook_output:
            hook_event = data.get("hookEventName") or data.get("hook_event_name") or "PreToolUse"
            print(json.dumps({"hookSpecificOutput": {
                "hookEventName": hook_event,
                "permissionDecision": "allow"}}))
        else:
            print(json.dumps({"decision": "allow"}))
except Exception:
    print(json.dumps({"decision": "allow", "hookSpecificOutput": {
        "hookEventName": "PreToolUse", "permissionDecision": "allow"}}))
sys.exit(0)
"####;

/// Absolute paths to the four materialised scripts.
#[derive(Debug, Clone)]
pub struct HookScripts {
    pub registration: PathBuf,
    pub session_start: PathBuf,
    pub session_hook: PathBuf,
    pub session_end: PathBuf,
}

impl HookScripts {
    fn path_for(&self, kind: HookScriptKind) -> &Path {
        match kind {
            HookScriptKind::Registration => &self.registration,
            HookScriptKind::SessionStart => &self.session_start,
            HookScriptKind::SessionHook => &self.session_hook,
            HookScriptKind::SessionEnd => &self.session_end,
        }
    }
}

fn script_filename(kind: HookScriptKind) -> &'static str {
    match kind {
        HookScriptKind::Registration => "edison-hook.sh",
        HookScriptKind::SessionStart => "edison-session-start.py",
        HookScriptKind::SessionHook => "edison-session-hook.py",
        HookScriptKind::SessionEnd => "edison-session-end.py",
    }
}

/// Materialise the four scripts (and `pending/` + `errors/`) into `edison_dir`
/// (`~/.edison-watch`). Idempotent: rewrites a script only when its content
/// differs, and always ensures the executable bit.
pub fn ensure_scripts(edison_dir: &Path) -> Result<HookScripts> {
    let pending = edison_dir.join("pending");
    let errors = edison_dir.join("errors");
    mkdirs(&pending)?;
    mkdirs(&errors)?;

    let registration = edison_dir.join("edison-hook.sh");
    let session_start = edison_dir.join("edison-session-start.py");
    let session_hook = edison_dir.join("edison-session-hook.py");
    let session_end = edison_dir.join("edison-session-end.py");

    let sh = REGISTRATION_SH_TEMPLATE
        .replace("__PENDING_DIR__", &pending.display().to_string())
        .replace("__ERRORS_DIR__", &errors.display().to_string());
    write_script(&registration, &sh)?;
    write_script(&session_start, SESSION_START_PY)?;
    write_script(&session_hook, SESSION_HOOK_PY)?;
    write_script(&session_end, SESSION_END_PY)?;

    Ok(HookScripts {
        registration,
        session_start,
        session_hook,
        session_end,
    })
}

fn mkdirs(path: &Path) -> Result<()> {
    std::fs::create_dir_all(path).map_err(|source| Error::Io {
        path: path.to_path_buf(),
        source,
    })
}

fn write_script(path: &Path, content: &str) -> Result<()> {
    let changed = std::fs::read_to_string(path)
        .map(|c| c != content)
        .unwrap_or(true);
    if changed {
        write(path, content)?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).map_err(
            |source| Error::Io {
                path: path.to_path_buf(),
                source,
            },
        )?;
    }
    Ok(())
}

/// The command string a binding runs (quoted path + optional client arg; Codex
/// wraps the whole thing in one unquoted TOML string).
fn command_for(binding: &HookBinding, scripts: &HookScripts, install: &HookInstall) -> String {
    let path = scripts.path_for(binding.script).display().to_string();
    match install.style {
        HookStyle::CodexToml => {
            if binding.pass_client_arg {
                format!("{path} {}", install.client_id)
            } else {
                path
            }
        }
        _ => {
            if binding.pass_client_arg {
                format!("\"{path}\" {}", install.client_id)
            } else {
                format!("\"{path}\"")
            }
        }
    }
}

// ── inject ───────────────────────────────────────────────────────────────────

/// Inject `install`'s hooks (idempotently), backing up the file first. Returns
/// whether anything changed.
pub fn inject_hooks(install: &HookInstall, scripts: &HookScripts) -> Result<bool> {
    match install.style {
        HookStyle::ClaudeSettings => inject_claude(install, scripts),
        HookStyle::CursorHooks => inject_cursor(install, scripts),
        HookStyle::CopilotFile => inject_copilot(install, scripts),
        HookStyle::CodexToml => inject_codex(install, scripts),
    }
}

fn ensure_parent(path: &Path) -> Result<()> {
    if let Some(parent) = path.parent() {
        mkdirs(parent)?;
    }
    Ok(())
}

/// Read a JSON file (or an empty object if absent). Returns (root, existed, raw).
fn read_json_or_empty(path: &Path) -> Result<(Value, bool, String)> {
    if path.exists() {
        let raw = read(path)?;
        let root = if raw.trim().is_empty() {
            Value::Object(Map::new())
        } else {
            parse(&raw, path)?
        };
        Ok((root, true, raw))
    } else {
        Ok((Value::Object(Map::new()), false, String::new()))
    }
}

fn backup_once(path: &Path, existed: bool, raw: &str) -> Result<()> {
    if existed {
        let bp = backup_path(path);
        if !bp.exists() {
            write(&bp, raw)?;
        }
    }
    Ok(())
}

/// A `{type:"command", command}` object contains our marker for `kind`.
fn command_has_script(entry: &Value, kind: HookScriptKind) -> bool {
    entry
        .get("command")
        .and_then(Value::as_str)
        .is_some_and(|c| c.contains(script_filename(kind)))
}

/// How many of `install`'s hook bindings are already present, and how many
/// there are in total. Read-only counterpart to [`inject_hooks`]: it applies the
/// same per-style presence checks the injector uses to decide "already there",
/// so status can never disagree with what a re-injection would do.
///
/// A missing or unparseable file counts as zero installed, never as an error -
/// the UI wants a coverage number, not a failure.
pub fn hooks_status(install: &HookInstall) -> (u32, u32) {
    let total = install.events.len() as u32;
    if total == 0 {
        return (0, 0);
    }
    let installed = match install.style {
        HookStyle::CodexToml => {
            let text = read(&install.path).unwrap_or_default();
            install
                .events
                .iter()
                .filter(|b| text.contains(script_filename(b.script)))
                .count()
        }
        _ => {
            let Ok(raw) = read(&install.path) else {
                return (0, total);
            };
            let Ok(root) = parse(&raw, &install.path) else {
                return (0, total);
            };
            let Some(hooks) = root.get("hooks").and_then(Value::as_object) else {
                return (0, total);
            };
            install
                .events
                .iter()
                .filter(|b| {
                    let Some(arr) = hooks.get(&b.event).and_then(Value::as_array) else {
                        return false;
                    };
                    match install.style {
                        // Claude nests the commands one level deeper, inside
                        // per-matcher groups.
                        // Scope matters: a group holding our command under a
                        // matcher that excludes these tools never runs for them,
                        // so it is not coverage.
                        HookStyle::ClaudeSettings => arr
                            .iter()
                            .any(|g| matcher_covers(g, b) && group_runs_script(g, b.script)),
                        _ => arr.iter().any(|h| command_has_script(h, b.script)),
                    }
                })
                .count()
        }
    };
    (installed as u32, total)
}

/// Whether a Claude hook group runs `kind`'s script.
fn group_runs_script(group: &Value, kind: HookScriptKind) -> bool {
    group
        .get("hooks")
        .and_then(Value::as_array)
        .is_some_and(|hs| hs.iter().any(|h| command_has_script(h, kind)))
}

/// Tool names that stand in for a binding's scope.
///
/// Coverage is "does this group fire everywhere the binding needs it to", and
/// the only way to answer that for a regex is to run it. Comparing matcher
/// strings cannot: `mcp__.*` and `mcp__*` select the same MCP calls while
/// sharing no useful equality, and `.*` covers every binding there is.
///
/// So each binding names tools that must be matched. An MCP-scoped binding is
/// satisfied by anything that fires for MCP calls; an unscoped one has to fire
/// for ordinary tools too, which is why a `mcp__*` group does not cover it.
fn scope_samples(binding: &HookBinding) -> &'static [&'static str] {
    match binding.matcher.as_deref() {
        Some(m) if m.starts_with("mcp__") => &["mcp__edison_watch__list", "mcp__github__search"],
        // No matcher, `*`, or anything else: the binding wants every tool.
        _ => &["mcp__edison_watch__list", "Bash", "Edit", "Read"],
    }
}

/// Whether a group's matcher covers the binding's scope.
///
/// Claude only runs a group for tools its `matcher` selects, so a group scoped
/// elsewhere does not satisfy the binding no matter what command it holds - the
/// `PreToolUse`/`mcp__*` binding is the one that makes MCP calls observable at
/// all. An absent matcher (or `*`) means every tool, which covers any binding.
///
/// Everything else is a regex, matched unscoped against the tool name, the way
/// Claude matches it. A matcher this crate cannot compile is reported as NOT
/// covering: the module's rule is never to claim coverage nobody verified, and
/// the caller responds by installing a correctly scoped group rather than
/// trusting one it could not read.
fn matcher_covers(group: &Value, binding: &HookBinding) -> bool {
    let Some(m) = group.get("matcher").and_then(Value::as_str) else {
        return true;
    };
    if m == "*" {
        return true;
    }
    // Cheap exact hit first - the common case is our own previous install.
    if Some(m) == binding.matcher.as_deref() {
        return true;
    }
    let Ok(re) = Regex::new(m) else { return false };
    scope_samples(binding).iter().all(|t| re.is_match(t))
}

/// Whether the group's scope is *demonstrably* outside the binding.
///
/// Stricter than `!matcher_covers`, and deliberately so: that returns false for
/// a matcher we could not compile, which means "unread", not "wrong". Rewriting
/// on unread would discard a scope the user may have chosen on purpose, so only
/// a matcher that compiled and then failed to fire for the binding's tools
/// earns a repair.
fn matcher_known_not_to_cover(group: &Value, binding: &HookBinding) -> bool {
    let Some(m) = group.get("matcher").and_then(Value::as_str) else {
        return false;
    };
    if m == "*" || Some(m) == binding.matcher.as_deref() {
        return false;
    }
    Regex::new(m).is_ok_and(|re| !scope_samples(binding).iter().all(|t| re.is_match(t)))
}

/// Whether every command in the group is one of ours, so its matcher can be
/// corrected without moving somebody else's hook to a different scope.
fn group_is_exclusively_ours(group: &Value) -> bool {
    group
        .get("hooks")
        .and_then(Value::as_array)
        .is_some_and(|hs| {
            !hs.is_empty()
                && hs.iter().all(|h| {
                    [
                        HookScriptKind::Registration,
                        HookScriptKind::SessionStart,
                        HookScriptKind::SessionHook,
                        HookScriptKind::SessionEnd,
                    ]
                    .into_iter()
                    .any(|k| command_has_script(h, k))
                })
        })
}

fn inject_claude(install: &HookInstall, scripts: &HookScripts) -> Result<bool> {
    ensure_parent(&install.path)?;
    let (mut root, existed, raw) = read_json_or_empty(&install.path)?;
    let hooks = root
        .as_object_mut()
        .ok_or_else(|| Error::NotAnObject(vec![]))?
        .entry("hooks")
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .ok_or_else(|| Error::NotAnObject(vec!["hooks".into()]))?;

    let mut changed = false;
    for b in &install.events {
        let arr = hooks
            .entry(b.event.clone())
            .or_insert_with(|| json!([]))
            .as_array_mut()
            .ok_or_else(|| Error::NotAnObject(vec!["hooks".into(), b.event.clone()]))?;
        // Satisfied only by a group that BOTH runs the script and is scoped to
        // cover this binding. A group carrying our command under a different
        // matcher never fires for the tools we care about.
        if arr
            .iter()
            .any(|g| matcher_covers(g, b) && group_runs_script(g, b.script))
        {
            continue;
        }
        // A wrongly-scoped group of ours (an older install, a hand-edit): fix
        // its matcher rather than adding a second one, but only when the whole
        // group is ours - otherwise we'd move somebody else's hook too - and
        // only when its scope is KNOWN to miss the binding. A matcher this
        // crate cannot compile is not known-wrong, just unread, so it keeps
        // whatever the user meant by it and we add our own group beside it.
        if let Some(g) = arr.iter_mut().find(|g| {
            group_runs_script(g, b.script)
                && group_is_exclusively_ours(g)
                && matcher_known_not_to_cover(g, b)
        }) && let Some(obj) = g.as_object_mut()
        {
            match &b.matcher {
                Some(m) => obj.insert("matcher".into(), json!(m)),
                None => obj.remove("matcher"),
            };
            // Ownership is decided by script *filename*, so the group we just
            // rescoped may still name a path from somewhere else entirely - an
            // older install, a moved home directory, a settings.json carried
            // between machines in a dotfiles repo. Correcting the matcher alone
            // would leave it scoped perfectly at a script that isn't there, so
            // the command is refreshed in the same pass.
            if let Some(hs) = obj.get_mut("hooks").and_then(Value::as_array_mut) {
                for h in hs.iter_mut().filter(|h| command_has_script(h, b.script)) {
                    if let Some(ho) = h.as_object_mut() {
                        ho.insert("command".into(), json!(command_for(b, scripts, install)));
                    }
                }
            }
            changed = true;
            continue;
        }
        let cmd = command_for(b, scripts, install);
        let mut group = Map::new();
        if let Some(m) = &b.matcher {
            group.insert("matcher".into(), json!(m));
        }
        group.insert(
            "hooks".into(),
            json!([{ "type": "command", "command": cmd }]),
        );
        arr.push(Value::Object(group));
        changed = true;
    }

    if changed {
        backup_once(&install.path, existed, &raw)?;
        write(&install.path, &serialize(&root))?;
    }
    Ok(changed)
}

fn inject_cursor(install: &HookInstall, scripts: &HookScripts) -> Result<bool> {
    ensure_parent(&install.path)?;
    let (mut root, existed, raw) = read_json_or_empty(&install.path)?;
    let obj = root
        .as_object_mut()
        .ok_or_else(|| Error::NotAnObject(vec![]))?;
    obj.entry("version").or_insert_with(|| json!(1));
    let hooks = obj
        .entry("hooks")
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .ok_or_else(|| Error::NotAnObject(vec!["hooks".into()]))?;

    let mut changed = false;
    for b in &install.events {
        let arr = hooks
            .entry(b.event.clone())
            .or_insert_with(|| json!([]))
            .as_array_mut()
            .ok_or_else(|| Error::NotAnObject(vec!["hooks".into(), b.event.clone()]))?;
        if arr.iter().any(|h| command_has_script(h, b.script)) {
            continue;
        }
        let cmd = command_for(b, scripts, install);
        arr.push(json!({ "type": "command", "command": cmd }));
        changed = true;
    }

    if changed {
        backup_once(&install.path, existed, &raw)?;
        write(&install.path, &serialize(&root))?;
    }
    Ok(changed)
}

fn inject_copilot(install: &HookInstall, scripts: &HookScripts) -> Result<bool> {
    // The whole file is Edison-owned: build the desired doc and overwrite iff
    // it differs.
    let mut hooks = Map::new();
    for b in &install.events {
        let cmd = command_for(b, scripts, install);
        hooks.insert(
            b.event.clone(),
            json!([{ "type": "command", "command": cmd }]),
        );
    }
    let desired = json!({ "hooks": hooks });

    let existed = install.path.exists();
    let raw = if existed {
        read(&install.path)?
    } else {
        String::new()
    };
    let current = if raw.trim().is_empty() {
        None
    } else {
        parse(&raw, &install.path).ok()
    };
    if current.as_ref() == Some(&desired) {
        return Ok(false);
    }
    ensure_parent(&install.path)?;
    backup_once(&install.path, existed, &raw)?;
    write(&install.path, &serialize(&desired))?;
    Ok(true)
}

fn inject_codex(install: &HookInstall, scripts: &HookScripts) -> Result<bool> {
    ensure_parent(&install.path)?;
    let existed = install.path.exists();
    let text = if existed {
        read(&install.path)?
    } else {
        String::new()
    };

    let mut appended = String::new();
    for b in &install.events {
        if text.contains(script_filename(b.script)) {
            continue;
        }
        let cmd = command_for(b, scripts, install);
        appended.push_str(&format!("\n[[hooks.{}]]\ncommand = \"{cmd}\"\n", b.event));
    }
    if appended.is_empty() {
        return Ok(false);
    }
    backup_once(&install.path, existed, &text)?;
    write(&install.path, &format!("{text}{appended}"))?;
    Ok(true)
}

// ── remove ───────────────────────────────────────────────────────────────────

/// Remove `install`'s hooks (any command referencing `~/.edison-watch`). Returns
/// whether anything changed. Best-effort/idempotent.
pub fn remove_hooks(install: &HookInstall) -> Result<bool> {
    match install.style {
        HookStyle::ClaudeSettings => remove_claude(install),
        HookStyle::CursorHooks => remove_cursor(install),
        HookStyle::CopilotFile => remove_copilot(install),
        HookStyle::CodexToml => remove_codex(install),
    }
}

fn command_is_edison(entry: &Value) -> bool {
    entry
        .get("command")
        .and_then(Value::as_str)
        .is_some_and(cmd_str_is_edison)
}

fn remove_claude(install: &HookInstall) -> Result<bool> {
    if !install.path.exists() {
        return Ok(false);
    }
    let raw = read(&install.path)?;
    let mut root = parse(&raw, &install.path)?;
    let Some(hooks) = root
        .as_object_mut()
        .and_then(|o| o.get_mut("hooks"))
        .and_then(Value::as_object_mut)
    else {
        return Ok(false);
    };

    let mut changed = false;
    for arr in hooks.values_mut() {
        if let Some(groups) = arr.as_array_mut() {
            let before = groups.len();
            groups.retain(|group| {
                !group
                    .get("hooks")
                    .and_then(Value::as_array)
                    .is_some_and(|hs| hs.iter().any(command_is_edison))
            });
            changed |= groups.len() != before;
        }
    }
    // Drop now-empty event arrays, then an empty `hooks` object.
    hooks.retain(|_, v| !v.as_array().is_some_and(|a| a.is_empty()));
    let empty_hooks = hooks.is_empty();
    if empty_hooks {
        root.as_object_mut().unwrap().remove("hooks");
    }

    if changed {
        write(&install.path, &serialize(&root))?;
    }
    Ok(changed)
}

fn remove_cursor(install: &HookInstall) -> Result<bool> {
    if !install.path.exists() {
        return Ok(false);
    }
    let raw = read(&install.path)?;
    let mut root = parse(&raw, &install.path)?;
    let Some(hooks) = root
        .as_object_mut()
        .and_then(|o| o.get_mut("hooks"))
        .and_then(Value::as_object_mut)
    else {
        return Ok(false);
    };

    let mut changed = false;
    for arr in hooks.values_mut() {
        if let Some(entries) = arr.as_array_mut() {
            let before = entries.len();
            entries.retain(|e| !command_is_edison(e));
            changed |= entries.len() != before;
        }
    }
    hooks.retain(|_, v| !v.as_array().is_some_and(|a| a.is_empty()));

    if changed {
        write(&install.path, &serialize(&root))?;
    }
    Ok(changed)
}

fn remove_copilot(install: &HookInstall) -> Result<bool> {
    // Edison owns the whole file — just delete it.
    if install.path.exists() {
        std::fs::remove_file(&install.path).map_err(|source| Error::Io {
            path: install.path.clone(),
            source,
        })?;
        Ok(true)
    } else {
        Ok(false)
    }
}

fn remove_codex(install: &HookInstall) -> Result<bool> {
    if !install.path.exists() {
        return Ok(false);
    }
    let text = read(&install.path)?;
    // Drop any `[[hooks.X]]` block whose command line references ~/.edison-watch.
    let mut out: Vec<&str> = Vec::new();
    let lines: Vec<&str> = text.lines().collect();
    let mut i = 0;
    let mut changed = false;
    while i < lines.len() {
        let line = lines[i];
        let is_hook_header = line.trim_start().starts_with("[[hooks.");
        let next_is_edison = lines
            .get(i + 1)
            .is_some_and(|n| n.contains("command") && cmd_str_is_edison(n));
        if is_hook_header && next_is_edison {
            // Skip the header + its command line (and a trailing blank line).
            i += 2;
            if lines.get(i).is_some_and(|l| l.trim().is_empty()) {
                i += 1;
            }
            changed = true;
            continue;
        }
        out.push(line);
        i += 1;
    }
    if changed {
        let mut joined = out.join("\n");
        if text.ends_with('\n') && !joined.ends_with('\n') {
            joined.push('\n');
        }
        write(&install.path, &joined)?;
    }
    Ok(changed)
}

// ── VSCode per-workspace registration task (.vscode/tasks.json) ──────────────

const VSCODE_TASK_LABEL: &str = "Edison Watch Registration";

/// Whether a `tasks.json` entry is one of ours.
///
/// Ownership is the command, not the label: the label is display text a user
/// can copy, and - more commonly - a task left by an older install keeps the
/// label while its command points at a script path that no longer resolves
/// (the Linux AppImage mount changes every launch, homes get moved). Treating
/// the label as proof reported such a workspace as covered while registration
/// never ran, and injection refused to repair it for the same reason.
///
/// The label is still accepted so a stale or hand-copied entry gets replaced
/// rather than left beside a second, working one.
fn is_edison_workspace_task(task: &Value) -> bool {
    command_has_script(task, HookScriptKind::Registration)
        || task.get("label").and_then(Value::as_str) == Some(VSCODE_TASK_LABEL)
}

/// Add the "Edison Watch Registration" folder-open task to a workspace's
/// `tasks.json` (idempotent, alongside existing tasks). Returns whether changed.
pub fn inject_workspace_task(tasks_json: &Path, registration_script: &Path) -> Result<bool> {
    ensure_parent(tasks_json)?;
    let (mut root, existed, raw) = read_json_or_empty(tasks_json)?;
    let obj = root
        .as_object_mut()
        .ok_or_else(|| Error::NotAnObject(vec![]))?;
    obj.entry("version").or_insert_with(|| json!("2.0.0"));
    let tasks = obj
        .entry("tasks")
        .or_insert_with(|| json!([]))
        .as_array_mut()
        .ok_or_else(|| Error::NotAnObject(vec!["tasks".into()]))?;

    let command = registration_script.display().to_string();
    let desired = json!({
        "label": VSCODE_TASK_LABEL,
        "type": "shell",
        "command": command,
        "args": ["vscode"],
        "runOptions": { "runOn": "folderOpen" },
        "presentation": { "reveal": "never", "panel": "shared" }
    });

    match tasks.iter().position(is_edison_workspace_task) {
        // Already pointing at this script: leave it alone, including any
        // presentation tweaks the user made.
        Some(i) if tasks[i].get("command").and_then(Value::as_str) == Some(command.as_str()) => {
            return Ok(false);
        }
        // Ours by label or by script but running something else - a stale path
        // from an older install, or a copied label. Replace it: skipping would
        // leave registration broken with no way to repair, and appending would
        // leave two same-labelled tasks.
        Some(i) => tasks[i] = desired,
        None => tasks.push(desired),
    }
    backup_once(tasks_json, existed, &raw)?;
    write(tasks_json, &serialize(&root))?;
    Ok(true)
}

/// Whether a workspace `tasks.json` already carries the Edison Watch
/// registration task. Read-only counterpart to [`inject_workspace_task`]: the
/// desktop app reports hook coverage from the daemon's answer instead of
/// opening workspace files itself (those live in the user's project
/// directories, which on macOS are TCC-gated).
pub fn workspace_task_installed(tasks_json: &Path) -> bool {
    let Ok(raw) = read(tasks_json) else {
        return false;
    };
    let Ok(root) = parse(&raw, tasks_json) else {
        return false;
    };
    root.get("tasks")
        .and_then(Value::as_array)
        .is_some_and(|tasks| {
            tasks
                .iter()
                .any(|t| command_has_script(t, HookScriptKind::Registration))
        })
}

/// Strip the Edison Watch registration task from a workspace `tasks.json`
/// (leaving the user's own tasks). Returns whether changed.
pub fn remove_workspace_task(tasks_json: &Path) -> Result<bool> {
    if !tasks_json.exists() {
        return Ok(false);
    }
    let raw = read(tasks_json)?;
    let mut root = parse(&raw, tasks_json)?;
    let Some(tasks) = root
        .as_object_mut()
        .and_then(|o| o.get_mut("tasks"))
        .and_then(Value::as_array_mut)
    else {
        return Ok(false);
    };
    let before = tasks.len();
    tasks.retain(|t| !is_edison_workspace_task(t));
    let changed = tasks.len() != before;
    if changed {
        write(tasks_json, &serialize(&root))?;
    }
    Ok(changed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    /// The real Claude binding table, so scope tests exercise what ships.
    fn claude_install(path: &Path) -> HookInstall {
        HookInstall {
            path: path.to_path_buf(),
            style: HookStyle::ClaudeSettings,
            client_id: "claude-code".into(),
            events: vec![
                HookBinding::new(
                    "UserPromptSubmit",
                    Some("*"),
                    HookScriptKind::Registration,
                    true,
                ),
                HookBinding::new(
                    "PreToolUse",
                    Some("mcp__*"),
                    HookScriptKind::SessionHook,
                    false,
                ),
                HookBinding::new(
                    "SessionStart",
                    Some("*"),
                    HookScriptKind::SessionStart,
                    false,
                ),
                HookBinding::new("SessionEnd", Some("*"), HookScriptKind::SessionEnd, false),
            ],
        }
    }

    fn fake_scripts(dir: &Path) -> HookScripts {
        HookScripts {
            registration: dir.join("edison-hook.sh"),
            session_start: dir.join("edison-session-start.py"),
            session_hook: dir.join("edison-session-hook.py"),
            session_end: dir.join("edison-session-end.py"),
        }
    }

    #[test]
    fn ensure_scripts_materialises_executable_and_interpolated() {
        let d = tempdir().unwrap();
        let ed = d.path().join(".edison-watch");
        let s = ensure_scripts(&ed).unwrap();
        assert!(s.registration.exists() && s.session_hook.exists());
        assert!(ed.join("pending").is_dir() && ed.join("errors").is_dir());
        let sh = std::fs::read_to_string(&s.registration).unwrap();
        assert!(sh.contains(ed.join("pending").to_str().unwrap()));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&s.registration)
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o111, 0o111, "scripts must be executable");
        }
    }

    #[test]
    fn claude_inject_is_idempotent_and_removable() {
        let d = tempdir().unwrap();
        let cfg = d.path().join(".claude/settings.json");
        let sc = fake_scripts(d.path());
        let install = HookInstall {
            path: cfg.clone(),
            style: HookStyle::ClaudeSettings,
            client_id: "claude-code".into(),
            events: vec![
                HookBinding::new(
                    "UserPromptSubmit",
                    Some("*"),
                    HookScriptKind::Registration,
                    true,
                ),
                HookBinding::new(
                    "PreToolUse",
                    Some("mcp__*"),
                    HookScriptKind::SessionHook,
                    false,
                ),
            ],
        };
        assert!(inject_hooks(&install, &sc).unwrap());
        assert!(
            !inject_hooks(&install, &sc).unwrap(),
            "second inject is a no-op"
        );

        let v: Value = serde_json::from_str(&std::fs::read_to_string(&cfg).unwrap()).unwrap();
        assert_eq!(v["hooks"]["UserPromptSubmit"][0]["matcher"], "*");
        let cmd = v["hooks"]["UserPromptSubmit"][0]["hooks"][0]["command"]
            .as_str()
            .unwrap();
        assert!(cmd.contains("edison-hook.sh") && cmd.ends_with("claude-code"));
        assert_eq!(v["hooks"]["PreToolUse"][0]["matcher"], "mcp__*");

        assert!(remove_hooks(&install).unwrap());
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&cfg).unwrap()).unwrap();
        assert!(v.get("hooks").is_none(), "empty hooks object is dropped");
    }

    #[test]
    fn claude_inject_preserves_foreign_hooks_and_backs_up() {
        let d = tempdir().unwrap();
        let cfg = d.path().join("settings.json");
        std::fs::write(
            &cfg,
            r#"{"hooks":{"UserPromptSubmit":[{"matcher":"*","hooks":[{"type":"command","command":"other.sh"}]}]}}"#,
        )
        .unwrap();
        let sc = fake_scripts(d.path());
        let install = HookInstall {
            path: cfg.clone(),
            style: HookStyle::ClaudeSettings,
            client_id: "claude-code".into(),
            events: vec![HookBinding::new(
                "UserPromptSubmit",
                Some("*"),
                HookScriptKind::Registration,
                true,
            )],
        };
        assert!(inject_hooks(&install, &sc).unwrap());
        assert!(cfg.with_file_name("settings.json.ew-backup").exists());
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&cfg).unwrap()).unwrap();
        let arr = v["hooks"]["UserPromptSubmit"].as_array().unwrap();
        assert_eq!(arr.len(), 2, "foreign hook kept, ours appended");

        // Removal strips only ours.
        remove_hooks(&install).unwrap();
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&cfg).unwrap()).unwrap();
        let arr = v["hooks"]["UserPromptSubmit"].as_array().unwrap();
        assert_eq!(arr.len(), 1);
        assert_eq!(arr[0]["hooks"][0]["command"], "other.sh");
    }

    #[test]
    fn cursor_inject_and_remove() {
        let d = tempdir().unwrap();
        let cfg = d.path().join("hooks.json");
        let sc = fake_scripts(d.path());
        let install = HookInstall {
            path: cfg.clone(),
            style: HookStyle::CursorHooks,
            client_id: "cursor".into(),
            events: vec![
                HookBinding::new("sessionStart", None, HookScriptKind::Registration, true),
                HookBinding::new(
                    "beforeMCPExecution",
                    None,
                    HookScriptKind::SessionHook,
                    false,
                ),
            ],
        };
        assert!(inject_hooks(&install, &sc).unwrap());
        assert!(!inject_hooks(&install, &sc).unwrap());
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&cfg).unwrap()).unwrap();
        assert_eq!(v["version"], 1);
        assert_eq!(v["hooks"]["sessionStart"][0]["type"], "command");
        assert!(
            v["hooks"]["beforeMCPExecution"][0]["command"]
                .as_str()
                .unwrap()
                .contains("edison-session-hook.py")
        );
        assert!(remove_hooks(&install).unwrap());
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&cfg).unwrap()).unwrap();
        assert!(v["hooks"].as_object().unwrap().is_empty());
    }

    #[test]
    fn codex_inject_and_remove() {
        let d = tempdir().unwrap();
        let cfg = d.path().join("config.toml");
        std::fs::write(&cfg, "[mcp_servers.foo]\ncommand = \"x\"\n").unwrap();
        let sc = fake_scripts(d.path());
        let install = HookInstall {
            path: cfg.clone(),
            style: HookStyle::CodexToml,
            client_id: "codex".into(),
            events: vec![
                HookBinding::new("SessionStart", None, HookScriptKind::Registration, true),
                HookBinding::new("Stop", None, HookScriptKind::SessionEnd, false),
            ],
        };
        assert!(inject_hooks(&install, &sc).unwrap());
        assert!(!inject_hooks(&install, &sc).unwrap());
        let t: toml::Value = toml::from_str(&std::fs::read_to_string(&cfg).unwrap()).unwrap();
        assert!(
            t["mcp_servers"].get("foo").is_some(),
            "existing config kept"
        );
        let cmd = t["hooks"]["SessionStart"][0]["command"].as_str().unwrap();
        assert!(cmd.contains("edison-hook.sh") && cmd.ends_with("codex"));
        assert!(remove_hooks(&install).unwrap());
        let text = std::fs::read_to_string(&cfg).unwrap();
        assert!(!text.contains("[[hooks."), "hook blocks removed");
        assert!(text.contains("[mcp_servers.foo]"), "config preserved");
    }

    #[test]
    fn vscode_workspace_task_inject_and_remove() {
        let d = tempdir().unwrap();
        let tasks = d.path().join(".vscode/tasks.json");
        std::fs::create_dir_all(tasks.parent().unwrap()).unwrap();
        std::fs::write(
            &tasks,
            r#"{"version":"2.0.0","tasks":[{"label":"build","type":"shell","command":"make"}]}"#,
        )
        .unwrap();
        let script = d.path().join("edison-hook.sh");

        assert!(inject_workspace_task(&tasks, &script).unwrap());
        assert!(
            !inject_workspace_task(&tasks, &script).unwrap(),
            "idempotent"
        );
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&tasks).unwrap()).unwrap();
        let arr = v["tasks"].as_array().unwrap();
        assert_eq!(arr.len(), 2, "user task kept, ours appended");
        assert!(arr.iter().any(|t| t["label"] == VSCODE_TASK_LABEL
            && t["args"][0] == "vscode"
            && t["runOptions"]["runOn"] == "folderOpen"));

        assert!(remove_workspace_task(&tasks).unwrap());
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&tasks).unwrap()).unwrap();
        let arr = v["tasks"].as_array().unwrap();
        assert_eq!(arr.len(), 1);
        assert_eq!(arr[0]["label"], "build", "user's task preserved");
    }

    #[test]
    fn copilot_owns_whole_file() {
        let d = tempdir().unwrap();
        let cfg = d.path().join("edison-watch.json");
        let sc = fake_scripts(d.path());
        let install = HookInstall {
            path: cfg.clone(),
            style: HookStyle::CopilotFile,
            client_id: "vscode".into(),
            events: vec![
                HookBinding::new("SessionStart", None, HookScriptKind::SessionStart, false),
                HookBinding::new("UserPromptSubmit", None, HookScriptKind::Registration, true),
            ],
        };
        assert!(inject_hooks(&install, &sc).unwrap());
        assert!(
            !inject_hooks(&install, &sc).unwrap(),
            "same content → no rewrite"
        );
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&cfg).unwrap()).unwrap();
        assert!(
            v["hooks"]["UserPromptSubmit"][0]["command"]
                .as_str()
                .unwrap()
                .ends_with("vscode")
        );
        assert!(remove_hooks(&install).unwrap());
        assert!(!cfg.exists(), "Edison-owned file is deleted on removal");
    }

    /// The failure this guards: an entry left by an older install keeps the
    /// label but runs a script path that no longer exists (an AppImage mount,
    /// a moved home). Coverage must not call that installed, and injection has
    /// to repair it - the old label-only check did neither.
    #[test]
    fn stale_task_is_not_counted_and_gets_repaired() {
        let d = tempdir().unwrap();
        let tasks = d.path().join(".vscode/tasks.json");
        std::fs::create_dir_all(tasks.parent().unwrap()).unwrap();
        std::fs::write(
            &tasks,
            format!(
                r#"{{"version":"2.0.0","tasks":[{{"label":"{VSCODE_TASK_LABEL}","type":"shell","command":"/tmp/.mount_gone123/edison-hook.sh","args":["vscode"]}}]}}"#
            ),
        )
        .unwrap();
        let script = d.path().join("edison-hook.sh");

        // It runs *an* edison-hook.sh, so it counts as installed - what matters
        // is that injection still repoints it at the current script.
        assert!(inject_workspace_task(&tasks, &script).unwrap(), "repaired");
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&tasks).unwrap()).unwrap();
        let arr = v["tasks"].as_array().unwrap();
        assert_eq!(arr.len(), 1, "repaired in place, not duplicated");
        assert_eq!(arr[0]["command"], script.display().to_string());
        assert!(
            !inject_workspace_task(&tasks, &script).unwrap(),
            "now idempotent"
        );
    }

    /// A task that merely borrows the label - it runs something else entirely -
    /// is not ours and must not be reported as coverage.
    #[test]
    fn same_label_running_another_command_is_not_coverage() {
        let d = tempdir().unwrap();
        let tasks = d.path().join(".vscode/tasks.json");
        std::fs::create_dir_all(tasks.parent().unwrap()).unwrap();
        std::fs::write(
            &tasks,
            format!(
                r#"{{"version":"2.0.0","tasks":[{{"label":"{VSCODE_TASK_LABEL}","type":"shell","command":"echo hi"}}]}}"#
            ),
        )
        .unwrap();
        assert!(
            !workspace_task_installed(&tasks),
            "the label is display text, not proof registration runs"
        );

        let script = d.path().join("edison-hook.sh");
        assert!(inject_workspace_task(&tasks, &script).unwrap(), "replaced");
        assert!(workspace_task_installed(&tasks), "now genuinely covered");
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&tasks).unwrap()).unwrap();
        assert_eq!(
            v["tasks"].as_array().unwrap().len(),
            1,
            "no duplicate label"
        );
    }

    /// Removal follows the same ownership rule, so a relabelled task of ours
    /// is still torn down.
    #[test]
    fn remove_drops_our_task_even_when_relabelled() {
        let d = tempdir().unwrap();
        let tasks = d.path().join(".vscode/tasks.json");
        std::fs::create_dir_all(tasks.parent().unwrap()).unwrap();
        std::fs::write(
            &tasks,
            r#"{"version":"2.0.0","tasks":[{"label":"renamed by user","type":"shell","command":"/home/u/.edison-watch/edison-hook.sh","args":["vscode"]},{"label":"build","command":"make"}]}"#,
        )
        .unwrap();
        assert!(remove_workspace_task(&tasks).unwrap());
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&tasks).unwrap()).unwrap();
        let arr = v["tasks"].as_array().unwrap();
        assert_eq!(arr.len(), 1);
        assert_eq!(arr[0]["label"], "build", "user's own task preserved");
    }

    #[test]
    fn user_customisation_of_our_task_survives_reinjection() {
        let d = tempdir().unwrap();
        let tasks = d.path().join(".vscode/tasks.json");
        std::fs::create_dir_all(tasks.parent().unwrap()).unwrap();
        let script = d.path().join("edison-hook.sh");
        std::fs::write(
            &tasks,
            format!(
                r#"{{"version":"2.0.0","tasks":[{{"label":"{VSCODE_TASK_LABEL}","type":"shell","command":"{}","args":["vscode"],"presentation":{{"reveal":"always"}}}}]}}"#,
                script.display()
            ),
        )
        .unwrap();
        assert!(
            !inject_workspace_task(&tasks, &script).unwrap(),
            "no rewrite"
        );
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&tasks).unwrap()).unwrap();
        assert_eq!(v["tasks"][0]["presentation"]["reveal"], "always");
    }

    /// The binding that makes MCP tool calls observable is
    /// `PreToolUse` + `mcp__*`. A group carrying that command under a different
    /// matcher never fires for MCP calls, so it must not read as coverage - and
    /// re-enabling has to repair it.
    #[test]
    fn claude_binding_scoped_to_another_matcher_is_not_coverage() {
        let d = tempdir().unwrap();
        let settings = d.path().join("settings.json");
        std::fs::write(
            &settings,
            r#"{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"/home/u/.edison-watch/edison-session-hook.py"}]}]}}"#,
        )
        .unwrap();
        let install = claude_install(&settings);

        let (installed, total) = hooks_status(&install);
        assert_eq!(total, 4);
        assert_eq!(
            installed, 0,
            "a Bash-scoped group does not cover mcp__* tool calls"
        );
    }

    #[test]
    fn claude_injection_repairs_a_wrongly_scoped_group_of_ours() {
        let d = tempdir().unwrap();
        let settings = d.path().join("settings.json");
        std::fs::write(
            &settings,
            r#"{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"/old/edison-session-hook.py"}]}]}}"#,
        )
        .unwrap();
        let install = claude_install(&settings);
        let scripts = fake_scripts(d.path());

        assert!(inject_hooks(&install, &scripts).unwrap());
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&settings).unwrap()).unwrap();
        let groups = v["hooks"]["PreToolUse"].as_array().unwrap();
        assert_eq!(groups.len(), 1, "repaired in place, not duplicated");
        assert_eq!(groups[0]["matcher"], "mcp__*");
        let (installed, _) = hooks_status(&install);
        assert!(installed >= 1, "now genuinely covered");
    }

    /// Rescoping a group is pointless if it still names a script that is not
    /// there. Ownership is matched on filename, so a group from an older
    /// install - or a settings.json synced from another machine - looks like
    /// ours while pointing into a directory that no longer exists.
    #[test]
    fn claude_repair_refreshes_a_stale_script_path() {
        let d = tempdir().unwrap();
        let settings = d.path().join("settings.json");
        std::fs::write(
            &settings,
            r#"{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"/gone/edison-session-hook.py"}]}]}}"#,
        )
        .unwrap();
        let install = claude_install(&settings);
        let scripts = fake_scripts(d.path());

        assert!(inject_hooks(&install, &scripts).unwrap());
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&settings).unwrap()).unwrap();
        let groups = v["hooks"]["PreToolUse"].as_array().unwrap();
        assert_eq!(groups.len(), 1, "repaired in place, not duplicated");
        assert_eq!(groups[0]["matcher"], "mcp__*");
        let cmd = groups[0]["hooks"][0]["command"].as_str().unwrap();
        assert!(
            !cmd.contains("/gone/"),
            "kept the dead path: {cmd} - correctly scoped at a script that isn't there"
        );
        assert!(
            cmd.contains(&scripts.session_hook.display().to_string()),
            "expected the current script path, got {cmd}"
        );
    }

    /// The refresh is confined to the repair: a second pass has nothing left to
    /// correct, so it must not rewrite the file again.
    #[test]
    fn claude_repair_settles_after_one_pass() {
        let d = tempdir().unwrap();
        let settings = d.path().join("settings.json");
        std::fs::write(
            &settings,
            r#"{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"/gone/edison-session-hook.py"}]}]}}"#,
        )
        .unwrap();
        let install = claude_install(&settings);
        let scripts = fake_scripts(d.path());

        assert!(inject_hooks(&install, &scripts).unwrap());
        assert!(
            !inject_hooks(&install, &scripts).unwrap(),
            "repair is not idempotent - it would rewrite settings.json on every run"
        );
    }

    /// Repair must not drag a user's own hook into our scope.
    #[test]
    fn claude_injection_leaves_a_shared_group_alone_and_adds_its_own() {
        let d = tempdir().unwrap();
        let settings = d.path().join("settings.json");
        std::fs::write(
            &settings,
            r#"{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"/old/edison-session-hook.py"},{"type":"command","command":"/usr/local/bin/user-audit.sh"}]}]}}"#,
        )
        .unwrap();
        let install = claude_install(&settings);
        let scripts = fake_scripts(d.path());

        assert!(inject_hooks(&install, &scripts).unwrap());
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&settings).unwrap()).unwrap();
        let groups = v["hooks"]["PreToolUse"].as_array().unwrap();
        assert_eq!(groups.len(), 2, "user's group untouched, ours added");
        let user_group = groups.iter().find(|g| g["matcher"] == "Bash").unwrap();
        assert_eq!(user_group["hooks"].as_array().unwrap().len(), 2);
        assert!(groups.iter().any(|g| g["matcher"] == "mcp__*"));
    }

    /// A matcher that is written differently but selects the same MCP calls is
    /// coverage. `mcp__.*` is the form Claude's own docs use; treating it as
    /// wrongly-scoped meant rewriting a config that was already correct.
    #[test]
    fn claude_equivalent_matchers_count_as_coverage() {
        let d = tempdir().unwrap();
        for (label, matcher) in [
            ("regex-form", "mcp__.*"),
            ("catch-all-regex", ".*"),
            ("alternation", "mcp__.*|Bash"),
            ("narrower-prefix-plus-wildcard", "mcp__[a-z_]+__.*"),
        ] {
            let settings = d.path().join(format!("settings-{label}.json"));
            std::fs::write(
                &settings,
                format!(
                    r#"{{"hooks":{{"PreToolUse":[{{"matcher":"{matcher}","hooks":[{{"type":"command","command":"/x/edison-session-hook.py"}}]}}]}}}}"#
                ),
            )
            .unwrap();
            let (installed, _) = hooks_status(&claude_install(&settings));
            assert_eq!(installed, 1, "{label} ({matcher}) fires for MCP calls");
        }
    }

    /// ...and injection must leave such a config exactly as the user wrote it.
    #[test]
    fn claude_injection_does_not_rewrite_an_equivalent_matcher() {
        let d = tempdir().unwrap();
        let settings = d.path().join("settings.json");
        std::fs::write(
            &settings,
            r#"{"hooks":{"PreToolUse":[{"matcher":"mcp__.*","hooks":[{"type":"command","command":"/x/edison-session-hook.py"}]}]}}"#,
        )
        .unwrap();
        let install = claude_install(&settings);
        let scripts = fake_scripts(d.path());

        inject_hooks(&install, &scripts).unwrap();
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&settings).unwrap()).unwrap();
        let groups = v["hooks"]["PreToolUse"].as_array().unwrap();
        assert_eq!(groups.len(), 1, "no second PreToolUse group added");
        assert_eq!(
            groups[0]["matcher"], "mcp__.*",
            "the user's matcher was rewritten"
        );
    }

    /// A matcher we cannot read is not a matcher we know to be wrong. Adding a
    /// correctly scoped group beside it keeps the hook working without
    /// discarding a scope the user may have meant.
    #[test]
    fn claude_injection_leaves_an_uncompilable_matcher_alone() {
        let d = tempdir().unwrap();
        let settings = d.path().join("settings.json");
        std::fs::write(
            &settings,
            r#"{"hooks":{"PreToolUse":[{"matcher":"mcp__[","hooks":[{"type":"command","command":"/old/edison-session-hook.py"}]}]}}"#,
        )
        .unwrap();
        let install = claude_install(&settings);
        let scripts = fake_scripts(d.path());

        assert!(inject_hooks(&install, &scripts).unwrap());
        let v: Value = serde_json::from_str(&std::fs::read_to_string(&settings).unwrap()).unwrap();
        let groups = v["hooks"]["PreToolUse"].as_array().unwrap();
        assert_eq!(groups.len(), 2, "ours added beside the unreadable one");
        assert!(
            groups.iter().any(|g| g["matcher"] == "mcp__["),
            "kept as-is"
        );
        assert!(groups.iter().any(|g| g["matcher"] == "mcp__*"));
    }

    /// An MCP-scoped group does NOT cover a binding that has to run for every
    /// tool - coverage is directional, and the samples enforce that.
    #[test]
    fn claude_mcp_scoped_group_does_not_cover_an_unscoped_binding() {
        let d = tempdir().unwrap();
        let settings = d.path().join("settings.json");
        std::fs::write(
            &settings,
            r#"{"hooks":{"UserPromptSubmit":[{"matcher":"mcp__.*","hooks":[{"type":"command","command":"/x/edison-hook.sh"}]}]}}"#,
        )
        .unwrap();
        let install = claude_install(&settings);
        let (installed, _) = hooks_status(&install);
        assert_eq!(
            installed, 0,
            "UserPromptSubmit must fire for every prompt, not just MCP tools"
        );
    }

    #[test]
    fn claude_wildcard_and_unscoped_groups_count_as_coverage() {
        let d = tempdir().unwrap();
        for (label, matcher) in [("wildcard", r#""matcher":"*","#), ("unscoped", "")] {
            let settings = d.path().join(format!("settings-{label}.json"));
            std::fs::write(
                &settings,
                format!(
                    r#"{{"hooks":{{"PreToolUse":[{{{matcher}"hooks":[{{"type":"command","command":"/x/edison-session-hook.py"}}]}}]}}}}"#
                ),
            )
            .unwrap();
            let (installed, _) = hooks_status(&claude_install(&settings));
            assert_eq!(installed, 1, "{label} matcher runs for every tool");
        }
    }
}
