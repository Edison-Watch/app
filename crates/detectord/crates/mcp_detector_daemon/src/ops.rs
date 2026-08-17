//! Operations behind both the CLI and the IPC server, each scoped to an OS
//! user. Returning protocol DTOs keeps the two front-ends in sync.

use std::path::PathBuf;
use std::sync::LazyLock;

use anyhow::Context;
use mcp_backend::{BackendClient, Error as BackendError, KnownStatus, SubmitRequest};
use mcp_quarantine::{
    Action as SeenAction, ConfigStore, FileConfigStore, QuarantineRecord, SeenStore,
    is_sealgate_entry,
};
use sealgate_detectord::{DiscoveredServer, SealGateInstall, ServerConfig, fingerprint};

use crate::agents;
use crate::enrollment::Enrollment;
use crate::paths;
use crate::platform;
use crate::protocol::{AgentInfo, Choice, IntegrationChange, ServerView, Status};
use crate::quarantined::{QuarantinedEntry, QuarantinedState};

/// Agent names this build cannot manage, computed once.
///
/// `is_manageable()` is declared per agent type, so unlike the rest of what
/// `agents::build()` reports it cannot change while the process runs - no
/// filesystem state feeds it. Deriving it on every selection filter meant
/// `apply_integrations` alone rebuilt the whole agent set twice more per
/// request, re-running each constructor's discovery and re-emitting any
/// "discover failed" warning with it.
static UNMANAGEABLE: LazyLock<Vec<&'static str>> = LazyLock::new(|| {
    agents::build()
        .iter()
        .filter(|a| !a.is_manageable())
        .map(|a| a.name())
        .collect()
});

/// Drop agent names SealGate cannot manage — ChatGPT, whose servers live in the
/// vendor's account, and the Claude hosts, whose config file takes stdio
/// entries only — from a selection list.
///
/// An unknown name is kept: it is most likely an agent this build doesn't
/// compile in, and silently dropping it would erase a selection that a fuller
/// build understands.
fn retain_manageable(agents: &mut Vec<String>) {
    agents.retain(|name| {
        let keep = !UNMANAGEABLE.iter().any(|u| u == name);
        if !keep {
            tracing::debug!(agent = %name, "dropping unmanageable agent from selection");
        }
        keep
    });
}

/// Which agents are present on the machine, with their workspace hook coverage.
///
/// The hook counts are computed here rather than by the UI: the workspace
/// targets are `.vscode/tasks.json` files inside the user's project
/// directories, and the daemon is the only component that walks those.
pub fn list_agents(user: &str) -> Vec<AgentInfo> {
    let home = user_home(user);
    // Build the adapters ONCE. Constructing them is not free - each enumerates
    // its config surface (Cursor reads every workspaceStorage entry, Claude Code
    // parses ~/.claude.json's projects map, JetBrains scans preference dirs) -
    // and this runs on every hook-status and agent-list request. Building twice
    // also split the answer across two snapshots: the observations came from one
    // set of adapters while the install paths compared against them came from
    // another, so a config appearing in between could put an entry and its
    // owner's paths in different worlds.
    let built = agents::build();
    // One discovery pass for every agent's sealgate entry, rather than one per
    // agent: discovery walks the same config set either way.
    let observed = agents::discover_all(&built);
    built
        .iter()
        .map(|a| {
            let installs = a.sealgate_installs(&home);
            let targets = a.hook_workspace_targets(&home);
            let workspace_hooks_installed = targets
                .iter()
                .filter(|t| mcp_quarantine::workspace_task_installed(t))
                .count() as u32;
            let (hooks_installed, hooks_total) = a
                .hook_install(&home)
                .map(|hi| mcp_quarantine::hooks_status(&hi))
                .unwrap_or((0, 0));
            AgentInfo {
                name: a.name().to_string(),
                installed: a.is_installed(),
                hooks_total,
                hooks_installed,
                workspace_hooks_total: targets.len() as u32,
                workspace_hooks_installed,
                sealgate_url: installed_sealgate_entry(a.name(), &installs, &observed)
                    .and_then(|s| sealgate_entry_url(&s.config)),
                config_path: a.config_path(&home).map(|p| p.display().to_string()),
                manageable: a.is_manageable(),
            }
        })
        .collect()
}

/// The `sealgate` entry that lives exactly where this agent's install
/// writes one, if there is one.
///
/// Matching is on the (file, key-path) pair, not the file alone: Claude Code
/// keeps user-scope and project-scope servers in the SAME file
/// (`~/.claude.json`, under `mcpServers` and `projects.<dir>.mcpServers`), so a
/// path-only check would accept a project entry as ours. It also keeps
/// `sealgate_url` consistent with the `config_path` reported alongside it - the
/// UI shows one and previews the other, and they have to describe the same
/// entry.
///
/// Deliberately strict: an entry that exists only in some project's config is
/// not reported. It covers that one project, and calling the agent "configured"
/// on the strength of it would tell the user they're protected everywhere.
fn installed_sealgate_entry<'a>(
    agent_name: &str,
    installs: &[SealGateInstall],
    observed: &'a [DiscoveredServer],
) -> Option<&'a DiscoveredServer> {
    observed.iter().find(|s| {
        s.client == agent_name
            && is_sealgate_entry(s)
            && installs
                .iter()
                .any(|i| i.path == s.location.path && i.key_path == s.location.key_path)
    })
}

/// The upstream URL of an `sealgate` entry, whichever shape it is in: an
/// HTTP entry carries it directly, an `npx -y mcp-remote <url> …` shim hides it
/// in the args.
///
/// SealGate writes only the first. The stdio arm covers a hand-written shim in a
/// *manageable* agent's install location — reached via `installed_sealgate_entry`,
/// which requires a matching `SealGateInstall`, so the Claude hosts' leftovers
/// never arrive here.
fn sealgate_entry_url(config: &ServerConfig) -> Option<String> {
    match config {
        ServerConfig::Http { url, .. } => Some(url.clone()),
        ServerConfig::Stdio { args, .. } => args
            .iter()
            .find(|a| a.starts_with("http://") || a.starts_with("https://"))
            .cloned(),
        ServerConfig::Opaque { .. } => None,
    }
}

/// Install the `sealgate` entry + session hooks for `agents`, reporting what
/// changed per agent. The agents are added to the enrolled selection, so a
/// later self-heal keeps them installed.
///
/// Scoped: no agent outside `agents` is touched.
pub fn apply_integrations(
    user: &str,
    agents_to_add: &[String],
) -> anyhow::Result<Vec<IntegrationChange>> {
    // Same guard as `enroll`: an unmanageable agent has nothing to install into,
    // and the selection is additive, so letting one in means carrying it for
    // good. Dropped up front so it reaches neither the selection nor the
    // installer. The app selects every detected app by default, so this is the
    // ordinary path, not an edge case.
    let mut wanted = agents_to_add.to_vec();
    retain_manageable(&mut wanted);

    let mut e = Enrollment::load_for(user)?.ok_or_else(|| anyhow::anyhow!("not enrolled"))?;
    for a in &wanted {
        if !e.selected_agents.contains(a) {
            e.selected_agents.push(a.clone());
        }
    }
    retain_manageable(&mut e.selected_agents);
    e.save_for(user)?;

    let home = user_home(user);
    let changes = install_sealgate_entries_for(user, &e, &home, &wanted);
    purge_stale_sealgate_entries(user);
    // Hooks only for what was asked for. The machine-wide sweep is enroll's job
    // (`apply_install`), which runs on every app start.
    apply_hooks_for(&home, Some(&wanted));
    Ok(changes)
}

/// Remove the `sealgate` entry for `agents` and drop them from the enrolled
/// selection, so the self-heal doesn't put them straight back.
pub fn revert_integrations(
    user: &str,
    agents_to_remove: &[String],
) -> anyhow::Result<Vec<IntegrationChange>> {
    let mut changes = Vec::new();
    let home = user_home(user);
    for agent in agents::build() {
        if !agents_to_remove.iter().any(|s| s == agent.name()) {
            continue;
        }
        for inst in agent.sealgate_installs(&home) {
            let res = if inst.prefer_cli {
                crate::claude_cli::remove(user)
            } else {
                mcp_quarantine::uninstall_sealgate(&inst).map_err(Into::into)
            };
            changes.push(IntegrationChange {
                agent: agent.name().to_string(),
                path: (!inst.prefer_cli).then(|| inst.path.display().to_string()),
                backup_path: None,
                ok: res.is_ok(),
                error: res.err().map(|e: anyhow::Error| e.to_string()),
            });
        }
    }
    if let Some(mut e) = Enrollment::load_for(user)? {
        e.selected_agents
            .retain(|a| !agents_to_remove.iter().any(|r| r == a));
        e.save_for(user)?;
    }
    Ok(changes)
}

/// An agent's user-scope config file and its current contents, for display.
/// A missing file is `None` content, not an error - the UI shows "no config
/// yet" and the daemon stays the only reader of agent files.
pub fn read_config(user: &str, agent_name: &str) -> anyhow::Result<(String, Option<String>)> {
    let home = user_home(user);
    let agent = agents::build()
        .into_iter()
        .find(|a| a.name() == agent_name)
        .ok_or_else(|| anyhow::anyhow!("unknown agent '{agent_name}'"))?;
    let path = agent
        .config_path(&home)
        .ok_or_else(|| anyhow::anyhow!("agent '{agent_name}' has no user-scope config"))?;
    Ok((path.display().to_string(), read_config_text(&path)?))
}

/// A config file's text, or `None` when it doesn't exist yet.
///
/// Only absence is `None`. A permission error, a directory where a file was
/// expected, non-UTF-8 bytes - those get propagated: swallowing them showed the
/// user "no config yet" for a file that is plainly there, and hid the more
/// important fact that the daemon (the component holding the OS permissions)
/// cannot read a config it is supposed to be watching.
fn read_config_text(path: &std::path::Path) -> anyhow::Result<Option<String>> {
    match std::fs::read_to_string(path) {
        Ok(text) => Ok(Some(text)),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(anyhow::Error::new(err).context(format!("reading {}", path.display()))),
    }
}

/// Put quarantined servers back where they came from: one by name/fingerprint,
/// or all of them when `needle` is `None`. Restored servers are forgotten from
/// the seen-store so the next reconcile pass doesn't immediately re-quarantine.
pub fn restore_quarantined(user: &str, needle: Option<&str>) -> anyhow::Result<(u32, Vec<String>)> {
    let mut q = QuarantinedState::load_for(user)?;
    let mut seen = Enrollment::load_for(user)?
        .map(|e| SeenStore::open(paths::seen_store_path(user), e.org_id))
        .transpose()?;

    // Select without removing. A restore that fails - unreadable config, a
    // read-only file, a path that moved - has to leave the record in place, or
    // the server stays quarantined with nothing left to retry from.
    let targets: Vec<QuarantinedEntry> = match needle {
        Some(n) => vec![
            q.find(n)
                .cloned()
                .ok_or_else(|| anyhow::anyhow!("no quarantined server matching '{n}'"))?,
        ],
        None => q.entries.clone(),
    };

    let mut restored = 0;
    let mut errors = Vec::new();
    for entry in &targets {
        match FileConfigStore.restore(&entry.record) {
            Ok(()) => {
                if let Some(s) = seen.as_mut() {
                    let _ = s.forget(&entry.fingerprint);
                }
                // Only now is the record spent.
                q.take(&entry.fingerprint);
                restored += 1;
                tracing::info!(server = %entry.name, agent = %entry.agent, "restored");
            }
            Err(e) => errors.push(format!("{} ({}): {e}", entry.name, entry.agent)),
        }
    }
    q.save_for(user)?;
    Ok((restored, errors))
}

/// `(kind, state, fingerprint)` for one server — the shared classification.
pub fn classify(
    s: &DiscoveredServer,
    seen: Option<&SeenStore>,
) -> (String, String, Option<String>) {
    let fp = fingerprint(&s.name, &s.config);
    let kind = match &s.config {
        ServerConfig::Stdio { .. } => "stdio",
        ServerConfig::Http { .. } => "http",
        ServerConfig::Opaque { .. } => "opaque",
    };
    let state = if is_sealgate_entry(s) {
        "sealgate"
    } else {
        match &s.config {
            ServerConfig::Opaque {
                removable: true, ..
            } => "opaque",
            ServerConfig::Opaque {
                removable: false, ..
            } => "report",
            _ => match &fp {
                None => "report",
                Some(f) => match seen {
                    Some(st) if st.contains(f) => "known",
                    Some(_) => "new",
                    None => "?",
                },
            },
        }
    };
    (kind.to_string(), state.to_string(), fp)
}

/// Discover + classify every server instance for `user`.
pub fn list_servers(user: &str) -> anyhow::Result<Vec<ServerView>> {
    let observed = agents::discover_all(&agents::build());
    let seen = Enrollment::load_for(user)?
        .and_then(|e| SeenStore::open(paths::seen_store_path(user), e.org_id).ok());
    Ok(observed
        .iter()
        .map(|s| {
            let (kind, state, fingerprint) = classify(s, seen.as_ref());
            ServerView {
                name: s.name.clone(),
                agent: s.client.to_string(),
                kind,
                state,
                fingerprint,
                path: s.location.path.display().to_string(),
                config: Some(s.config.clone()),
            }
        })
        .collect())
}

/// Enrollment + cached policy for `user`.
pub fn status(user: &str) -> anyhow::Result<Status> {
    let quarantined_count = QuarantinedState::load_for(user)
        .map(|q| q.entries.len())
        .unwrap_or(0);
    Ok(match Enrollment::load_for(user)? {
        None => Status {
            user: user.to_string(),
            enrolled: false,
            org_id: None,
            org_name: None,
            email: None,
            role: None,
            quarantine: false,
            quarantined_count,
            armed: false,
        },
        Some(e) => Status {
            user: user.to_string(),
            enrolled: true,
            org_id: Some(e.org_id),
            org_name: Some(e.org_name),
            email: e.email,
            role: Some(e.role),
            quarantine: e.quarantine,
            quarantined_count,
            armed: e.armed,
        },
    })
}

/// Re-fetch the policy (fail-closed) and return the updated status.
pub async fn refresh_policy(user: &str) -> anyhow::Result<Status> {
    if let Some(mut e) = Enrollment::load_for(user)? {
        let client = BackendClient::new(e.api_base_url.clone(), e.api_key.clone());
        if let Ok(p) = client.fetch_policy().await {
            e.quarantine = p.quarantine;
            e.save_for(user)?;
        }
    }
    status(user)
}

/// Online enrollment handshake: validate the key, resolve the org, cache the
/// policy and known set, then install the `sealgate` proxy entry into the
/// selected agents (when an MCP base URL was given).
/// `mcp_base_url`, `selected_agents`, and `secret` are all optional inputs from
/// the UI/CLI: `None`/unspecified keeps the previous value, so re-running
/// `enroll` acts as an update. The selection diff uninstalls sealgate from
/// agents dropped from the set.
#[allow(clippy::too_many_arguments)]
pub async fn enroll(
    user: &str,
    url: String,
    key: String,
    mcp_base_url: Option<String>,
    selected_agents: Option<Vec<String>>,
    secret: Option<String>,
    install: bool,
    armed: Option<bool>,
) -> anyhow::Result<Status> {
    let existing = Enrollment::load_for(user)?;

    let client = BackendClient::new(url.clone(), key.clone());
    let fps = client
        .fetch_fingerprints()
        .await
        .context("validating key / fetching org fingerprints")?;
    let policy = client.fetch_policy().await.context("fetching policy")?;
    let profile = client.fetch_profile().await.context("fetching profile")?;

    // A newly-provided/rotated secret must be registered (its hash) so the MCP
    // gateway will accept the X-SealGate-Secret-Key header we install. Done before
    // save/install so a rejected key fails the whole enroll cleanly.
    if let Some(sk) = &secret {
        client
            .register_secret_key(sk)
            .await
            .context("registering secret key")?;
    }

    // Merge install inputs over the previous enrollment (enroll = update).
    // Agents are ADDITIVE: `--agents` unions with the existing selection and
    // never removes — removal happens only via `unenroll`.
    let old_agents = existing
        .as_ref()
        .map(|e| e.selected_agents.clone())
        .unwrap_or_default();
    let mut new_agents = match selected_agents {
        Some(provided) => {
            let mut set = old_agents.clone();
            for a in provided {
                if !set.contains(&a) {
                    set.push(a);
                }
            }
            set
        }
        None => old_agents,
    };
    // Selecting an unmanageable agent is meaningless - there is nothing to
    // install into - and it does not stay harmless: the selection is additive
    // and only `unenroll` removes from it, so one such name would sit in every
    // later self-heal pass forever. Filtering the whole union (not just what
    // was provided) also prunes any that a previous version let through.
    retain_manageable(&mut new_agents);
    let mcp_base_url =
        mcp_base_url.or_else(|| existing.as_ref().and_then(|e| e.mcp_base_url.clone()));
    let sealgate_secret_key = secret.or_else(|| {
        existing
            .as_ref()
            .and_then(|e| e.sealgate_secret_key.clone())
    });
    // `armed` is a straight set (not additive): the UI arms enforcement when
    // onboarding completes; a missing value keeps the prior state.
    let armed = armed.unwrap_or_else(|| existing.as_ref().map(|e| e.armed).unwrap_or(false));

    let enrollment = Enrollment {
        api_base_url: url,
        api_key: key,
        org_id: fps.org_id.clone(),
        org_name: profile.domain.clone(),
        email: profile.email.clone(),
        role: profile.role.clone(),
        quarantine: policy.quarantine,
        mcp_base_url,
        selected_agents: new_agents.clone(),
        sealgate_secret_key,
        armed,
    };
    paths::ensure_user_dir(user)?;
    enrollment.save_for(user)?;

    let mut seen = SeenStore::open(paths::seen_store_path(user), enrollment.org_id.clone())?;
    let mut synced = std::collections::HashSet::new();
    for e in &fps.entries {
        let action = match e.status {
            KnownStatus::Requested => SeenAction::Requested,
            KnownStatus::Registered => SeenAction::Registered,
        };
        seen.mark_from_backend(&e.fingerprint, &e.name, action)?;
        synced.insert(e.fingerprint.clone());
    }
    seen.prune_backend(&synced)?;

    // Install the current (additive) set + hooks, unless the caller wants a
    // detect-only enrollment (e.g. a client running its own install in parallel).
    // Nothing is uninstalled here — that's `unenroll`'s job.
    if install {
        apply_install(user, &enrollment);
    }

    status(user)
}

/// The target user's home. For the current process user (user-mode dev build)
/// this honours `$HOME` via `dirs::home_dir`; only when the root daemon acts for
/// a *different* user do we resolve their home from `getpwnam`.
fn user_home(user: &str) -> std::path::PathBuf {
    if user == paths::current_username()
        && let Some(home) = dirs::home_dir()
    {
        return home;
    }
    platform::home_dir_for(user)
        .or_else(dirs::home_dir)
        .unwrap_or_default()
}

/// Apply everything under the target user's home: the `sealgate` MCP entry
/// for the *selected* agents, and hooks for *all installed* agents (as the app
/// does). Best-effort — a failure on one agent is logged, not fatal.
pub fn apply_install(user: &str, e: &Enrollment) {
    let home = user_home(user);
    install_sealgate_entries(user, e, &home);
    purge_stale_sealgate_entries(user);
    apply_hooks(&home);
}

/// Hosts whose `sealgate` entry SealGate no longer writes.
///
/// Frozen rather than derived from the adapters: this is a fact about what past
/// builds wrote, so deriving it would make it drift with the code instead of
/// staying pinned to the history it cleans up. A test asserts the names still
/// resolve, because a rename would otherwise disable the sweep in silence.
const STDIO_SHIM_HOSTS: [&str; 2] = ["claude_desktop", "claude_cowork"];

/// Why an `sealgate` entry found on disk has to come out.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Stale {
    /// A *project-scoped* Cursor entry. `<project>/.cursor/mcp.json` takes
    /// precedence over the user-level `~/.cursor/mcp.json`, so this one shadows
    /// the registration we just installed and the user sees "sealgate not
    /// recognized". Only Cursor has this precedence rule; other agents' project
    /// configs merge, and an entry there may well be deliberate.
    Shadowing,
    /// The `npx -y mcp-remote` bridge older builds wrote into the Claude hosts'
    /// config. They are not install targets any more, so nothing would ever
    /// overwrite it: left alone it keeps fetching an unpinned package from npm
    /// on every launch of the host app, with the secret key in `argv`.
    LegacyShim,
}

fn stale_reason(server: &DiscoveredServer) -> Option<Stale> {
    if server.client == "cursor" {
        return matches!(server.scope, sealgate_detectord::Scope::Project(_))
            .then_some(Stale::Shadowing);
    }
    (STDIO_SHIM_HOSTS.contains(&server.client) && is_mcp_remote_shim(&server.config))
        .then_some(Stale::LegacyShim)
}

/// Take out every `sealgate` entry that should no longer be on disk.
///
/// One sweep for two unrelated causes ([`Stale`]) because both end the same
/// way: remove the entry, record it so `restore` can put it back, and undo the
/// lot if the record never reaches disk. Splitting them gave the second cause
/// its own weaker removal path - no backup, no record, unrecoverable - which is
/// exactly the difference nobody would notice until a user needed it back.
///
/// Removal is restorable and not conditional on the entry being *ours*, because
/// it cannot be told apart from the user's own: `npx -y mcp-remote <url>` was
/// the published way to reach a remote MCP server from Claude Desktop, so an
/// entry someone hand-wrote against their own gateway looks identical to one we
/// wrote. Recording it is what makes deleting it safe.
fn purge_stale_sealgate_entries(user: &str) {
    let mut q = match QuarantinedState::load_for(user) {
        Ok(q) => q,
        Err(err) => {
            // Without somewhere to record it, removing the entry would strand
            // it: the sidecar would exist with nothing pointing at it.
            tracing::warn!(error = %err, "skipping purge: quarantined state unreadable");
            return;
        }
    };

    // What this pass took out, kept so it can be put back. The whole point of
    // recording these is that the user can `restore` them, so a removal whose
    // record never reaches disk is worse than no removal at all: the entry is
    // gone from the config, the sidecar exists, and nothing points at it.
    let mut undo: Vec<(PathBuf, QuarantineRecord)> = Vec::new();
    // Claude Desktop and Cowork are separate adapters over ONE file, and
    // `discover_all` dedupes by (client, path, key, name) - so the client in
    // that key keeps both copies of a shared entry. Acting on the second would
    // rewrite the file for a removal that already happened and log a success
    // for it.
    let mut done: std::collections::HashSet<(PathBuf, Vec<String>)> =
        std::collections::HashSet::new();

    for server in &agents::discover_all(&agents::build()) {
        if !is_sealgate_entry(server) {
            continue;
        }
        let Some(reason) = stale_reason(server) else {
            continue;
        };
        let loc = &server.location;
        if !done.insert((loc.path.clone(), loc.key_path.clone())) {
            continue;
        }
        match FileConfigStore.quarantine(loc, &server.config) {
            Ok(record) => {
                undo.push((loc.path.clone(), record.clone()));
                q.upsert(quarantined_entry(server, record));
                tracing::info!(
                    client = %server.client,
                    path = %loc.path.display(),
                    ?reason,
                    "removed a stale sealgate entry (restorable)"
                )
            }
            Err(err) => tracing::warn!(
                client = %server.client,
                path = %loc.path.display(),
                ?reason,
                error = %err,
                "removing a stale sealgate entry failed"
            ),
        }
    }
    commit_purge(&undo, || q.save_for(user));
}

/// Whether an entry is the shim **SealGate itself wrote**.
///
/// Deliberately not a general `mcp-remote` detector. SealGate emitted exactly one
/// shape, from one function, unchanged for the writer's whole life:
///
/// ```text
/// { "command": "npx", "args": ["-y", "mcp-remote", <url>, ...] }
/// ```
///
/// (`git log -S mcp-remote -- crates/.../configstore.rs`; the tray's copyable
/// snippet used the same prefix.) That is the entire population this migration
/// has to recognise, so matching it exactly is both sufficient and the only way
/// to be sure of the boundary.
///
/// The general version of this predicate was a mistake worth recording. Every
/// step toward "recognise any mcp-remote invocation" - other launchers, `yarn
/// dlx`, bare commands, which options take a value - added a way to be wrong in
/// one of two directions: over-match and delete a server that was never ours,
/// or under-match and leave the shim behind. The option tables in particular
/// cannot be finished, because every launcher keeps its own set and adds to it.
/// None of that generality serves a migration whose input is one known string.
///
/// A hand-written `mcp-remote` entry in some other shape is therefore left
/// alone, which is the right outcome twice over: it is not SealGate's to remove,
/// and it still reaches whatever gateway its author pointed it at.
fn is_mcp_remote_shim(config: &ServerConfig) -> bool {
    let ServerConfig::Stdio { command, args, .. } = config else {
        return false;
    };
    if base_name(command) != "npx" {
        return false;
    }
    let mut rest = args.iter().map(String::as_str).peekable();
    // `-y` is what SealGate wrote; tolerated as optional only because removing it
    // is an edit that leaves the entry otherwise untouched.
    if matches!(rest.peek(), Some(&"-y") | Some(&"--yes")) {
        rest.next();
    }
    // Then the package, pinned or not - pinning is the one edit a user might
    // plausibly make to *our* entry, since the floating version is the
    // complaint this change answers.
    rest.next().is_some_and(is_mcp_remote_token)
}

/// `mcp-remote`, `mcp-remote@1.2.3`, or either behind a path — the whole of
/// `MCP_REMOTE_RE`, including its `[\w.+-]+` version class.
fn is_mcp_remote_token(token: &str) -> bool {
    let base = base_name(token);
    match base.split_once('@') {
        Some((name, version)) => {
            name == "mcp-remote"
                // `+` in the TS regex: an empty version is not a version. The
                // character class matters too - it stops at the first thing a
                // version cannot contain, so `mcp-remote@1.2.3:port` and
                // `mcp-remote@foo@bar` are not this package.
                && !version.is_empty()
                && version
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '+' | '-'))
        }
        None => base == "mcp-remote",
    }
}

/// The last path segment, on either separator.
fn base_name(token: &str) -> &str {
    token.rsplit(['/', '\\']).next().unwrap_or(token)
}

/// Finish a purge pass: persist the records, or undo every removal if that
/// fails. Returns whether the removals stand.
///
/// The save is injected so the failure path is reachable in a test - it is the
/// branch that matters, and the one that cannot be provoked through the real
/// state file.
fn commit_purge(
    undo: &[(PathBuf, QuarantineRecord)],
    save: impl FnOnce() -> anyhow::Result<()>,
) -> bool {
    if undo.is_empty() {
        return true;
    }
    let Err(err) = save() else { return true };
    // The records did not reach disk, so put every entry back. The shadowing
    // entry returns with it - the user keeps seeing "sealgate not
    // recognized" until the next `apply_install` retries - but that is a
    // visible, retryable problem, where a removal nothing recorded is silent
    // and permanent.
    tracing::warn!(
        error = %err,
        count = undo.len(),
        "could not persist shadow-purge quarantine records; restoring the entries"
    );
    restore_purged(undo);
    false
}

/// Put back entries a purge pass removed but could not record. Returns how many
/// made it back.
fn restore_purged(undo: &[(PathBuf, QuarantineRecord)]) -> usize {
    let mut restored = 0;
    for (project, rec) in undo {
        match FileConfigStore.restore(rec) {
            Ok(()) => {
                restored += 1;
                tracing::info!(
                    project = %project.display(),
                    "restored shadowing entry after failed record save"
                )
            }
            // Both halves failed. This is the stranded case the rollback exists
            // to prevent, so name the sidecar: it is the only remaining way
            // back, via the CLI's disk-scanning `recover`.
            Err(err) => tracing::error!(
                project = %project.display(),
                error = %err,
                sidecar = %rec.disabled_path.display(),
                "entry is quarantined with no record and could not be restored"
            ),
        }
    }
    restored
}

/// The quarantine record for a server we just removed from a config.
///
/// Opaque servers (Cursor plugin dirs) have no fingerprint, so they are keyed
/// by path the way the reconciler does - an empty fingerprint would collide
/// across entries and could leak into the seen-store.
fn quarantined_entry(server: &DiscoveredServer, record: QuarantineRecord) -> QuarantinedEntry {
    QuarantinedEntry {
        name: server.name.clone(),
        agent: server.client.to_string(),
        fingerprint: fingerprint(&server.name, &server.config)
            .unwrap_or_else(|| format!("opaque:{}", server.location.path.display())),
        config: Some(server.config.clone()),
        record,
    }
}

fn install_sealgate_entries(user: &str, e: &Enrollment, home: &std::path::Path) {
    let selected = e.selected_agents.clone();
    install_sealgate_entries_for(user, e, home, &selected);
}

/// Install the `sealgate` entry for `wanted` agents, reporting per-agent
/// outcomes. `install_sealgate_entries` passes the whole enrolled selection;
/// `apply_integrations` passes just the agents the UI asked for.
fn install_sealgate_entries_for(
    user: &str,
    e: &Enrollment,
    home: &std::path::Path,
    wanted: &[String],
) -> Vec<IntegrationChange> {
    let Some(mcp_base) = e.mcp_base_url.as_deref() else {
        if !wanted.is_empty() {
            tracing::warn!("agents selected but no mcp_base_url set — skipping sealgate install");
        }
        return Vec::new();
    };
    let secret = e.sealgate_secret_key.as_deref();
    let mut changes = Vec::new();
    for agent in agents::build() {
        if !wanted.iter().any(|s| s == agent.name()) {
            continue;
        }
        for inst in agent.sealgate_installs(home) {
            // Claude Code goes through its own CLI (as the user); the file write
            // is the fallback.
            let done_via_cli = inst.prefer_cli
                && {
                    let url = mcp_quarantine::sealgate_url(mcp_base, &e.api_key, &inst.client_id);
                    match crate::claude_cli::install(user, &url, secret) {
                        Ok(()) => {
                            tracing::info!(
                                agent = agent.name(),
                                "installed sealgate (via claude CLI)"
                            );
                            true
                        }
                        Err(err) => {
                            tracing::warn!(agent = agent.name(), error = %err, "claude CLI failed; writing the file directly");
                            false
                        }
                    }
                };
            if done_via_cli {
                changes.push(IntegrationChange {
                    agent: agent.name().to_string(),
                    path: None,
                    backup_path: None,
                    ok: true,
                    error: None,
                });
                continue;
            }
            // The backup is taken on the first edit only, so report it just
            // when it's actually on disk.
            let backup = mcp_quarantine::backup_path(&inst.path);
            let res = mcp_quarantine::install_sealgate(&inst, mcp_base, &e.api_key, secret);
            match &res {
                Ok(()) => {
                    tracing::info!(agent = agent.name(), path = %inst.path.display(), "installed sealgate")
                }
                Err(err) => {
                    tracing::warn!(agent = agent.name(), error = %err, "sealgate install failed")
                }
            }
            changes.push(IntegrationChange {
                agent: agent.name().to_string(),
                path: Some(inst.path.display().to_string()),
                backup_path: backup.exists().then(|| backup.display().to_string()),
                ok: res.is_ok(),
                error: res.err().map(|e| e.to_string()),
            });
        }
    }
    changes
}

/// Re-install the sealgate entry for any *selected* agent where it's
/// currently missing — e.g. the user replaced/overwrote a config file, dropping
/// our entry. Only writes when the entry is absent (checked against live
/// discovery), so it never rewrites a config that already has it and can't loop
/// the fs watcher. Returns how many agents were (re-)installed.
pub fn heal_sealgate_install(user: &str, e: &Enrollment) -> usize {
    let Some(mcp_base) = e.mcp_base_url.as_deref() else {
        return 0;
    };
    if e.selected_agents.is_empty() {
        return 0;
    }
    let home = user_home(user);
    // Same adapters for the observation and the iteration - see `list_agents`.
    let built = agents::build();
    let present: std::collections::HashSet<&str> = agents::discover_all(&built)
        .iter()
        .filter(|s| is_sealgate_entry(s))
        .map(|s| s.client)
        .collect();
    let secret = e.sealgate_secret_key.as_deref();
    let mut healed = 0;
    for agent in &built {
        if !e.selected_agents.iter().any(|s| s == agent.name()) {
            continue;
        }
        if present.contains(agent.name()) {
            continue; // already installed — don't rewrite (avoids fs-watch churn)
        }
        // Count and report only what was actually written. An agent with no
        // install targets (JetBrains with no IDE on the machine) reaches here
        // and writes nothing; logging it as healed anyway made the self-heal
        // signal permanently non-zero, so a real heal - somebody's config got
        // clobbered - was indistinguishable from the every-20s background hum.
        //
        // A failed write does not count either. Claiming a heal for an install
        // that errored would put the same false signal back for the case that
        // matters most: the config SealGate could not repair.
        //
        // The error goes to `debug`, not `warn`, because this loop is on the
        // 20s rescan: a config that cannot be repaired fails identically
        // forever, and one warn per pass would bury the warnings that mean
        // something new. `install_sealgate_entries_for` can afford `warn` because
        // it runs when the user asks. The durable signal here is the count -
        // a failing agent now stays out of it, which is the whole point.
        let mut wrote = false;
        for inst in agent.sealgate_installs(&home) {
            let done_via_cli = inst.prefer_cli && {
                let url = mcp_quarantine::sealgate_url(mcp_base, &e.api_key, &inst.client_id);
                crate::claude_cli::install(user, &url, secret).is_ok()
            };
            if done_via_cli {
                wrote = true;
                continue;
            }
            match mcp_quarantine::install_sealgate(&inst, mcp_base, &e.api_key, secret) {
                Ok(()) => wrote = true,
                Err(err) => {
                    tracing::debug!(
                        agent = agent.name(),
                        path = %inst.path.display(),
                        error = %err,
                        "self-heal install failed"
                    )
                }
            }
        }
        if !wrote {
            continue;
        }
        tracing::info!(
            agent = agent.name(),
            "re-installed missing sealgate entry (self-heal)"
        );
        healed += 1;
    }
    healed
}

/// Materialise the hook scripts under `home/.sealgate`, then inject hooks
/// into every *installed* agent that has a hook surface (matching the app).
///
/// This machine-wide sweep belongs to the enroll path, which runs on every app
/// start: session hooks are how SealGate observes what agents do, independent of
/// which of them are registered with the gateway.
fn apply_hooks(home: &std::path::Path) {
    apply_hooks_for(home, None)
}

/// As [`apply_hooks`], restricted to `only` when given.
///
/// A request scoped to particular agents must not rewrite a *different* agent's
/// hook file as a side effect - the caller didn't ask, and the write shows up as
/// an unexplained modification (plus a backup) in a config they didn't select.
/// Coverage isn't lost by scoping: enroll sweeps every installed agent.
fn apply_hooks_for(home: &std::path::Path, only: Option<&[String]>) {
    let scripts = match mcp_quarantine::ensure_scripts(&home.join(".sealgate")) {
        Ok(s) => s,
        Err(err) => {
            tracing::warn!(error = %err, "materialising hook scripts failed");
            return;
        }
    };
    for agent in agents::build() {
        if !agent.is_installed() {
            continue;
        }
        if let Some(wanted) = only
            && !wanted.iter().any(|a| a == agent.name())
        {
            continue;
        }
        if let Some(hi) = agent.hook_install(home) {
            match mcp_quarantine::inject_hooks(&hi, &scripts) {
                Ok(true) => {
                    tracing::info!(agent = agent.name(), path = %hi.path.display(), "injected hooks")
                }
                Ok(false) => {}
                Err(err) => {
                    tracing::warn!(agent = agent.name(), error = %err, "hook injection failed")
                }
            }
        }
        for tasks_json in agent.hook_workspace_targets(home) {
            match mcp_quarantine::inject_workspace_task(&tasks_json, &scripts.registration) {
                Ok(true) => {
                    tracing::info!(agent = agent.name(), path = %tasks_json.display(), "injected workspace task")
                }
                Ok(false) => {}
                Err(err) => {
                    tracing::warn!(agent = agent.name(), error = %err, "workspace task injection failed")
                }
            }
        }
    }
}

/// Remove the `sealgate` entry from the given agents under `user`'s home.
fn remove_sealgate_for(user: &str, agents_to_remove: &[String]) {
    let home = user_home(user);
    for agent in agents::build() {
        if !agents_to_remove.iter().any(|s| s == agent.name()) {
            continue;
        }
        for inst in agent.sealgate_installs(&home) {
            let res = if inst.prefer_cli {
                crate::claude_cli::remove(user)
            } else {
                mcp_quarantine::uninstall_sealgate(&inst).map_err(Into::into)
            };
            if let Err(err) = res {
                tracing::warn!(agent = agent.name(), error = %err, "sealgate uninstall failed");
            }
        }
    }
}

/// Remove hooks from all agents that have a hook surface (full teardown).
fn remove_all_hooks_for(user: &str) {
    let home = user_home(user);
    for agent in agents::build() {
        if let Some(hi) = agent.hook_install(&home)
            && let Err(err) = mcp_quarantine::remove_hooks(&hi)
        {
            tracing::warn!(agent = agent.name(), error = %err, "hook removal failed");
        }
        for tasks_json in agent.hook_workspace_targets(&home) {
            if let Err(err) = mcp_quarantine::remove_workspace_task(&tasks_json) {
                tracing::warn!(agent = agent.name(), error = %err, "workspace task removal failed");
            }
        }
    }
}

/// Verify an existing key against the backend; on success adopt it (store +
/// re-install with it) without re-registering. The "enter your existing key"
/// path. Returns the verification result either way.
pub async fn verify_secret(user: &str, key: String) -> anyhow::Result<mcp_backend::VerifyResult> {
    let mut e = Enrollment::load_for(user)?.ok_or_else(|| anyhow::anyhow!("not enrolled"))?;
    let client = BackendClient::new(e.api_base_url.clone(), e.api_key.clone());
    let result = client
        .verify_secret_key(&key)
        .await
        .context("verifying secret key")?;
    if result.valid {
        e.sealgate_secret_key = Some(key);
        e.save_for(user)?;
        apply_install(user, &e);
    }
    Ok(result)
}

/// Destructively reset to a new key (the backend deletes this user's encrypted
/// personal values), then adopt it (store + re-install). The "start fresh" path.
pub async fn reset_secret(user: &str, key: String) -> anyhow::Result<mcp_backend::ResetResult> {
    let mut e = Enrollment::load_for(user)?.ok_or_else(|| anyhow::anyhow!("not enrolled"))?;
    let client = BackendClient::new(e.api_base_url.clone(), e.api_key.clone());
    let result = client
        .reset_secret_key(&key)
        .await
        .context("resetting secret key")?;
    e.sealgate_secret_key = Some(key);
    e.save_for(user)?;
    apply_install(user, &e);
    Ok(result)
}

/// Remove `user`'s enrollment (uninstalling sealgate first); returns the org
/// name if it was enrolled.
pub fn unenroll(user: &str) -> anyhow::Result<Option<String>> {
    let removed = Enrollment::remove_for(user)?;
    if let Some(e) = &removed {
        remove_sealgate_for(user, &e.selected_agents);
        remove_all_hooks_for(user); // full teardown removes hooks everywhere
    }
    Ok(removed.map(|e| e.org_name))
}

/// Dispose of a discovered, fingerprint-able server: send it to SG (submit +
/// remove) or skip (remove + mark dismissed). Both remove it locally
/// (quarantine-first).
pub async fn disposition(
    user: &str,
    name: &str,
    agent: Option<&str>,
    choice: Choice,
    rename: Option<&str>,
    submit_config: Option<ServerConfig>,
    register: Option<bool>,
) -> anyhow::Result<()> {
    let e = Enrollment::load_for(user)?.ok_or_else(|| anyhow::anyhow!("not enrolled"))?;

    // Primary mode: the daemon already auto-quarantined it and the UI is now
    // dispositioning. Act on the stored entry, not a (removed) discovered server.
    if let Some(entry) = QuarantinedState::load_for(user)?
        .entries
        .iter()
        .find(|x| x.name == name && agent.is_none_or(|a| x.agent == a))
        .cloned()
    {
        return disposition_quarantined(user, &e, &entry, choice, rename, submit_config, register)
            .await;
    }

    let observed = agents::discover_all(&agents::build());
    let matches: Vec<_> = observed
        .iter()
        .filter(|s| {
            s.name == name
                && agent.is_none_or(|a| s.client == a)
                && !is_sealgate_entry(s)
                && fingerprint(&s.name, &s.config).is_some()
        })
        .collect();
    let server = match matches.as_slice() {
        [] => anyhow::bail!("no discovered actionable server named '{name}'"),
        [only] => *only,
        many => {
            let ags: Vec<_> = many.iter().map(|s| s.client).collect();
            anyhow::bail!("'{name}' exists under multiple agents {ags:?}; specify agent");
        }
    };
    let fp = fingerprint(&server.name, &server.config).expect("filtered to Some");

    let mut seen = SeenStore::open(paths::seen_store_path(user), e.org_id.clone())?;
    let action = match choice {
        Choice::SendToEw => {
            let name = rename.unwrap_or(&server.name);
            // A client-supplied override is the user's authoritative redaction —
            // submit it verbatim. Otherwise auto-templatize the discovered config.
            let cfg = match submit_config {
                Some(c) => c,
                None => {
                    sealgate_detectord::secret_detection::templatize_for_fingerprint(&server.config)
                }
            };
            submit_to_ew(&e, name, &cfg, register).await?
        }
        Choice::Skip => SeenAction::Dismissed,
    };

    let record = FileConfigStore
        .quarantine(&server.location, &server.config)
        .context("removing from local config")?;
    seen.mark(&fp, &server.name, action)?;

    let mut q = QuarantinedState::load_for(user)?;
    // Same fingerprint that was just marked seen, so the two stores agree.
    q.upsert(QuarantinedEntry {
        fingerprint: fp,
        ..quarantined_entry(server, record)
    });
    q.save_for(user)?;
    Ok(())
}

/// Dispose of an already-quarantined server (primary mode). It stays quarantined
/// locally either way; SendToEw submits its stored config to the backend and
/// marks it known, Skip marks it dismissed so it isn't re-prompted.
async fn disposition_quarantined(
    user: &str,
    e: &Enrollment,
    entry: &QuarantinedEntry,
    choice: Choice,
    rename: Option<&str>,
    submit_config: Option<ServerConfig>,
    register: Option<bool>,
) -> anyhow::Result<()> {
    let mut seen = SeenStore::open(paths::seen_store_path(user), e.org_id.clone())?;
    let action = match choice {
        Choice::SendToEw => {
            // A client-supplied override is the user's authoritative redaction —
            // submit it verbatim. Otherwise auto-templatize the stored raw config.
            let config = match submit_config {
                Some(c) => c,
                None => {
                    let raw = entry.config.clone().ok_or_else(|| {
                        anyhow::anyhow!("no stored config for '{}' — cannot send to SG", entry.name)
                    })?;
                    sealgate_detectord::secret_detection::templatize_for_fingerprint(&raw)
                }
            };
            // Submit under the (possibly renamed) name, but keep marking the
            // *original* fingerprint known so the still-local server is silently
            // re-quarantined instead of re-prompting.
            let name = rename.unwrap_or(&entry.name);
            submit_to_ew(e, name, &config, register).await?
        }
        Choice::Skip => SeenAction::Dismissed,
    };
    seen.mark(&entry.fingerprint, &entry.name, action)?;
    tracing::info!(server = %entry.name, agent = %entry.agent, ?choice, rename, "disposition applied");
    Ok(())
}

/// Submit `config` to the backend under `name`, exactly as given. The caller is
/// responsible for redaction: daemon-discovered configs are auto-templatized
/// first, while a client-supplied `submit_config` (the user's manual
/// credential-review decision) is submitted verbatim so their explicit choices —
/// including leaving a value unmarked — are honored. Returns the seen-store
/// action (Registered for owner/admin, else Requested). A backend 409 is
/// surfaced as a `conflict:`-prefixed error so the UI can offer a rename.
async fn submit_to_ew(
    e: &Enrollment,
    name: &str,
    config: &ServerConfig,
    register_override: Option<bool>,
) -> anyhow::Result<SeenAction> {
    // Owners/admins register directly by default, everyone else files a
    // request. `register_override` carries an explicit UI choice (an admin who
    // picked "request approval" gets a request, not a silent registration).
    let register = register_override.unwrap_or(matches!(e.role.as_str(), "owner" | "admin"));
    let res = BackendClient::new(e.api_base_url.clone(), e.api_key.clone())
        .submit(&SubmitRequest {
            name: name.to_string(),
            config: config.clone(),
            register,
            hostname: crate::platform::hostname(),
        })
        .await;
    match res {
        Ok(()) if register => Ok(SeenAction::Registered),
        Ok(()) => Ok(SeenAction::Requested),
        Err(err) if is_conflict(&err) => {
            // Pass the backend's own wording through: a 409 can mean "that name
            // is taken" or "you already have a pending request for it", and the
            // UI shows the user different next steps for each.
            anyhow::bail!("conflict: {}", conflict_detail(&err, name))
        }
        Err(err) => Err(anyhow::Error::new(err).context("submitting to backend")),
    }
}

/// Whether a backend error is a 409 name conflict.
fn is_conflict(err: &BackendError) -> bool {
    matches!(err, BackendError::Status { status, .. } if status.as_u16() == 409)
}

/// The 409's explanation: the backend's `detail` when it sent one, else a
/// generic line naming the server.
fn conflict_detail(err: &BackendError, name: &str) -> String {
    match err {
        BackendError::Status {
            detail: Some(d), ..
        } if !d.is_empty() => d.clone(),
        _ => format!("'{name}' is already registered at SealGate"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selection_drops_unmanageable_agents_but_keeps_everything_else() {
        // The app sends its saved app selection on every start (enroll) as well
        // as on apply, and the selection is additive - only `unenroll` empties
        // it. So one unmanageable name getting in is permanent, and it used to
        // make every self-heal pass report a heal that never happened.
        let mut agents = vec![
            "claude_code".to_string(),
            "chatgpt".to_string(),
            "cursor".to_string(),
        ];
        retain_manageable(&mut agents);
        assert_eq!(
            agents,
            vec!["claude_code".to_string(), "cursor".to_string()]
        );
    }

    #[test]
    fn selection_keeps_names_this_build_does_not_know() {
        // An agent compiled out of this build is not the same as one we refuse
        // to manage; dropping it would erase a selection a fuller build honours.
        let mut agents = vec!["some_future_agent".to_string()];
        retain_manageable(&mut agents);
        assert_eq!(agents, vec!["some_future_agent".to_string()]);
    }

    fn quarantine_record(path: &str) -> QuarantineRecord {
        QuarantineRecord {
            kind: SourceKind::Json,
            source_path: PathBuf::from(path),
            disabled_path: PathBuf::from(format!("{path}.disabled")),
            backup_path: PathBuf::from(format!("{path}.sg-backup")),
            key_path: vec!["mcpServers".into()],
            server_key: "sealgate".into(),
            extra: Default::default(),
        }
    }

    /// Every removal has to leave a record behind: the sidecar on disk is
    /// useless to `restore` if nothing in the state points at it.
    #[test]
    fn quarantined_entry_carries_the_record_and_a_usable_fingerprint() {
        let server = entry(
            "cursor",
            "sealgate",
            "/home/u/work/app/.cursor/mcp.json",
            &["mcpServers"],
            Scope::Project(PathBuf::from("/home/u/work/app")),
            "https://mcp.edison.watch/mcp",
        );
        let record = quarantine_record("/home/u/work/app/.cursor/mcp.json");

        let e = quarantined_entry(&server, record.clone());
        assert_eq!(e.name, "sealgate");
        assert_eq!(e.agent, "cursor");
        assert_eq!(e.record.disabled_path, record.disabled_path);
        assert!(e.config.is_some(), "kept so it can be resubmitted later");
        assert!(!e.fingerprint.is_empty(), "an empty key would collide");
    }

    /// Opaque servers can't be fingerprinted; they must still get a distinct,
    /// non-empty key rather than sharing one.
    #[test]
    fn quarantined_entry_keys_opaque_servers_by_path() {
        let mut server = entry(
            "cursor",
            "plugin-thing",
            "/home/u/.cursor/plugins/cache/x",
            &[],
            Scope::Global,
            "unused",
        );
        server.config = ServerConfig::Opaque {
            removable: true,
            reason: sealgate_detectord::OpaqueReason::CursorPlugin,
        };

        let e = quarantined_entry(
            &server,
            quarantine_record("/home/u/.cursor/plugins/cache/x"),
        );
        assert!(
            e.fingerprint.starts_with("opaque:"),
            "got {}",
            e.fingerprint
        );
        assert!(e.fingerprint.contains("plugins/cache/x"));
    }

    #[test]
    fn read_config_text_distinguishes_absent_from_unreadable() {
        let dir = tempfile::tempdir().unwrap();

        // Absent: the honest "no config yet".
        assert!(
            read_config_text(&dir.path().join("nope.json"))
                .unwrap()
                .is_none()
        );

        // Present and readable.
        let file = dir.path().join("mcp.json");
        std::fs::write(&file, "{}").unwrap();
        assert_eq!(read_config_text(&file).unwrap().as_deref(), Some("{}"));

        // Unreadable (a directory stands in for any non-NotFound error): must
        // surface, not masquerade as "no config yet".
        let err = read_config_text(dir.path()).unwrap_err();
        assert!(
            err.to_string().contains("reading"),
            "error should name the path: {err}"
        );
    }
    use sealgate_detectord::{
        ConfigLocation, HttpKind, Scope, SealGateStyle, SourceKind, Transport,
    };
    use std::path::PathBuf;

    fn install(path: &str, key_path: &[&str]) -> SealGateInstall {
        SealGateInstall {
            path: PathBuf::from(path),
            key_path: key_path.iter().map(|s| s.to_string()).collect(),
            style: SealGateStyle::Http,
            client_id: "test".into(),
            prefer_cli: false,
        }
    }

    fn entry(
        client: &'static str,
        name: &str,
        path: &str,
        key_path: &[&str],
        scope: Scope,
        url: &str,
    ) -> DiscoveredServer {
        DiscoveredServer {
            client,
            name: name.into(),
            transport: Transport::Remote,
            scope,
            config: ServerConfig::Http {
                url: url.into(),
                headers: Default::default(),
                kind: HttpKind::Http,
            },
            location: ConfigLocation {
                kind: SourceKind::Json,
                path: PathBuf::from(path),
                key_path: key_path.iter().map(|s| s.to_string()).collect(),
                server_key: name.into(),
                extra: Default::default(),
            },
        }
    }

    /// Removing a shadowing entry and failing to record it would strand it: the
    /// sidecar exists, the entry is gone from the config, and `restore` has
    /// nothing pointing at it. The rollback has to genuinely put it back, so
    /// this drives the real store against a real file rather than a stub.
    #[test]
    fn purge_rollback_returns_the_entry_to_its_config() {
        let d = tempfile::tempdir().unwrap();
        let project = d.path().join("work/app");
        let cfg = project.join(".cursor/mcp.json");
        std::fs::create_dir_all(cfg.parent().unwrap()).unwrap();
        std::fs::write(
            &cfg,
            r#"{"mcpServers":{"sealgate":{"url":"https://mcp.edison.watch/mcp"},"other":{"url":"https://x"}}}"#,
        )
        .unwrap();

        let loc = ConfigLocation {
            kind: SourceKind::Json,
            path: cfg.clone(),
            key_path: vec!["mcpServers".into()],
            server_key: "sealgate".into(),
            extra: Default::default(),
        };
        let config = ServerConfig::Http {
            url: "https://mcp.edison.watch/mcp".into(),
            headers: Default::default(),
            kind: HttpKind::Http,
        };

        let record = FileConfigStore.quarantine(&loc, &config).unwrap();
        let after: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&cfg).unwrap()).unwrap();
        assert!(
            after["mcpServers"].get("sealgate").is_none(),
            "precondition: the purge removed it"
        );

        // The save failed, so everything this pass took out goes back.
        let restored = restore_purged(&[(project.clone(), record)]);

        assert_eq!(restored, 1);
        let back: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&cfg).unwrap()).unwrap();
        assert_eq!(
            back["mcpServers"]["sealgate"]["url"], "https://mcp.edison.watch/mcp",
            "the entry did not come back - it is stranded with no record"
        );
        assert!(
            back["mcpServers"].get("other").is_some(),
            "rollback clobbered an unrelated server"
        );
    }

    /// The wiring, not just the rollback: a failed save must undo the pass, and
    /// a successful one must leave it alone.
    #[test]
    fn purge_commit_undoes_the_pass_only_when_the_save_fails() {
        for (label, save_ok) in [("save failed", false), ("save succeeded", true)] {
            let d = tempfile::tempdir().unwrap();
            let project = d.path().join("work/app");
            let cfg = project.join(".cursor/mcp.json");
            std::fs::create_dir_all(cfg.parent().unwrap()).unwrap();
            std::fs::write(
                &cfg,
                r#"{"mcpServers":{"sealgate":{"url":"https://mcp.edison.watch/mcp"}}}"#,
            )
            .unwrap();
            let loc = ConfigLocation {
                kind: SourceKind::Json,
                path: cfg.clone(),
                key_path: vec!["mcpServers".into()],
                server_key: "sealgate".into(),
                extra: Default::default(),
            };
            let config = ServerConfig::Http {
                url: "https://mcp.edison.watch/mcp".into(),
                headers: Default::default(),
                kind: HttpKind::Http,
            };
            let record = FileConfigStore.quarantine(&loc, &config).unwrap();

            let stands = commit_purge(&[(project, record)], || {
                if save_ok {
                    Ok(())
                } else {
                    Err(anyhow::anyhow!("disk full"))
                }
            });

            let v: serde_json::Value =
                serde_json::from_str(&std::fs::read_to_string(&cfg).unwrap()).unwrap();
            let present = v["mcpServers"].get("sealgate").is_some();
            assert_eq!(stands, save_ok, "{label}: wrong commit result");
            assert_eq!(
                present, !save_ok,
                "{label}: entry present={present} - a removal with no record is unrecoverable"
            );
        }
    }

    /// A rollback that cannot run is the one case worth shouting about; it must
    /// report honestly rather than counting a failure as a restore.
    #[test]
    fn purge_rollback_reports_what_it_could_not_restore() {
        let d = tempfile::tempdir().unwrap();
        let missing = d.path().join("gone/.cursor/mcp.json");
        let restored = restore_purged(&[(
            d.path().join("gone"),
            quarantine_record(&missing.display().to_string()),
        )]);
        assert_eq!(restored, 0, "nothing was restorable; must not claim it was");
    }

    #[test]
    fn reports_the_entry_in_our_own_install_location() {
        let installs = vec![install("/home/u/.cursor/mcp.json", &["mcpServers"])];
        let observed = vec![entry(
            "cursor",
            "sealgate",
            "/home/u/.cursor/mcp.json",
            &["mcpServers"],
            Scope::Global,
            "https://mcp.edison.watch/mcp?client=cursor",
        )];
        let found = installed_sealgate_entry("cursor", &installs, &observed);
        assert_eq!(
            found.and_then(|s| sealgate_entry_url(&s.config)).as_deref(),
            Some("https://mcp.edison.watch/mcp?client=cursor")
        );
    }

    /// Claude Code keeps both scopes in `~/.claude.json`, so a project entry
    /// shares the install file and only the key path distinguishes them. Taking
    /// it would report "configured" for the whole agent on the strength of one
    /// project's config.
    #[test]
    fn ignores_a_project_entry_that_shares_the_install_file() {
        let installs = vec![install("/home/u/.claude.json", &["mcpServers"])];
        let observed = vec![entry(
            "claude_code",
            "sealgate",
            "/home/u/.claude.json",
            &["projects", "/home/u/work/app", "mcpServers"],
            Scope::Project(PathBuf::from("/home/u/work/app")),
            "https://stale.example/mcp",
        )];
        assert!(installed_sealgate_entry("claude_code", &installs, &observed).is_none());
    }

    #[test]
    fn ignores_a_project_entry_in_a_different_file() {
        let installs = vec![install("/home/u/.cursor/mcp.json", &["mcpServers"])];
        let observed = vec![entry(
            "cursor",
            "sealgate",
            "/home/u/work/app/.cursor/mcp.json",
            &["mcpServers"],
            Scope::Project(PathBuf::from("/home/u/work/app")),
            "https://team-gateway.example/mcp",
        )];
        assert!(installed_sealgate_entry("cursor", &installs, &observed).is_none());
    }

    /// The URL reported for one agent must not come from another's config.
    #[test]
    fn ignores_another_agents_entry() {
        let installs = vec![install("/home/u/.cursor/mcp.json", &["mcpServers"])];
        let observed = vec![entry(
            "vscode",
            "sealgate",
            "/home/u/.cursor/mcp.json",
            &["mcpServers"],
            Scope::Global,
            "https://mcp.edison.watch/mcp?client=vscode",
        )];
        assert!(installed_sealgate_entry("cursor", &installs, &observed).is_none());
    }

    #[test]
    fn picks_the_url_out_of_a_stdio_shim_entry() {
        // A hand-written shim in an install location SealGate does write to.
        // `?client=cursor`, not a Claude host: those have no install location,
        // so `installed_sealgate_entry` never routes their entries here.
        let config = ServerConfig::Stdio {
            command: "npx".into(),
            args: vec![
                "-y".into(),
                "mcp-remote".into(),
                "https://mcp.edison.watch/mcp?client=cursor".into(),
            ],
            env: Default::default(),
        };
        assert_eq!(
            sealgate_entry_url(&config).as_deref(),
            Some("https://mcp.edison.watch/mcp?client=cursor")
        );
    }

    fn stdio(command: &str, args: &[&str]) -> ServerConfig {
        ServerConfig::Stdio {
            command: command.into(),
            args: args.iter().map(|a| (*a).to_string()).collect(),
            env: Default::default(),
        }
    }

    #[test]
    fn recognises_the_entry_sealgate_wrote() {
        // The exact shape, with and without the trailing secret header.
        assert!(is_mcp_remote_shim(&stdio(
            "npx",
            &["-y", "mcp-remote", "https://x"]
        )));
        assert!(is_mcp_remote_shim(&stdio(
            "npx",
            &[
                "-y",
                "mcp-remote",
                "https://x",
                "--header",
                "X-SealGate-Secret-Key: s"
            ]
        )));
        // The tray snippet's variant, which a user may have pasted in.
        assert!(is_mcp_remote_shim(&stdio(
            "npx",
            &["-y", "mcp-remote", "https://x", "--transport", "http-first"]
        )));
        // Two edits a user might make to OUR entry and still leave it ours:
        // pinning the version (the floating fetch is the complaint this change
        // answers), and dropping `-y`.
        assert!(is_mcp_remote_shim(&stdio(
            "npx",
            &["-y", "mcp-remote@0.1.29", "https://x"]
        )));
        assert!(is_mcp_remote_shim(&stdio(
            "npx",
            &["mcp-remote", "https://x"]
        )));
        // A path to npx is still npx.
        assert!(is_mcp_remote_shim(&stdio(
            "/usr/local/bin/npx",
            &["-y", "mcp-remote", "https://x"]
        )));
    }

    #[test]
    fn leaves_alone_every_shape_sealgate_never_wrote() {
        // These are NOT oversights. SealGate emitted one shape from one function
        // for the writer's whole life, so anything else is someone's own entry:
        // not ours to delete, and still reaching the gateway its author chose.
        // Recognising them was what kept this predicate wrong - each launcher
        // has its own option table, and those tables cannot be finished.
        for other in [
            stdio("bunx", &["mcp-remote", "https://x"]),
            stdio("bunx", &["--bun", "mcp-remote", "https://x"]),
            stdio("yarn", &["dlx", "mcp-remote", "https://x"]),
            stdio("pnpm", &["exec", "mcp-remote", "https://x"]),
            stdio("mcp-remote", &["https://x"]),
            stdio("npx", &["--", "mcp-remote", "https://x"]),
            stdio("npx", &["-w", "some-workspace", "mcp-remote", "https://x"]),
        ] {
            assert!(!is_mcp_remote_shim(&other), "{other:?} is not SealGate's");
        }
    }

    #[test]
    fn leaves_alone_anything_that_is_not_the_shim() {
        // This predicate decides whether to delete an entry from someone's
        // config, on every app start. Over-matching keeps deleting it.
        assert!(!is_mcp_remote_shim(&stdio(
            "npx",
            &["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
        )));
        // A different package. Matching a prefix rather than the whole token
        // would take this one too.
        assert!(!is_mcp_remote_shim(&stdio(
            "npx",
            &["-y", "mcp-remote-proxy"]
        )));
        assert!(!is_mcp_remote_shim(&stdio(
            "npx",
            &["-y", "not-mcp-remote"]
        )));
        // A bare `@` is not a version - the TS regex requires `[\w.+-]+` - and
        // neither is one carrying a character a version cannot hold.
        assert!(!is_mcp_remote_shim(&stdio("npx", &["-y", "mcp-remote@"])));
        assert!(!is_mcp_remote_shim(&stdio(
            "npx",
            &["-y", "mcp-remote@1.2.3:port"]
        )));
        // The package name has to be in the package POSITION. A URL that
        // happens to end in `/mcp-remote` is an argument to something else.
        assert!(!is_mcp_remote_shim(&stdio(
            "npx",
            &["-y", "some-proxy", "https://gateway.example/mcp-remote"]
        )));
        // `--package mcp-remote other-server` RUNS other-server.
        assert!(!is_mcp_remote_shim(&stdio(
            "npx",
            &["--package", "mcp-remote", "other-server"]
        )));
        assert!(!is_mcp_remote_shim(&ServerConfig::Http {
            url: "https://mcp.edison.watch/mcp/K/".into(),
            headers: Default::default(),
            kind: sealgate_detectord::HttpKind::Http,
        }));
    }

    #[test]
    fn the_shim_hosts_are_still_agents_this_build_knows() {
        // `STDIO_SHIM_HOSTS` duplicates two `CLIENT_NAME` literals. Renaming
        // either breaks neither the build nor any other test - the purge would
        // just stop matching, and every affected machine would keep its shim
        // for good, silently.
        let names: Vec<&str> = agents::build().iter().map(|a| a.name()).collect();
        for host in STDIO_SHIM_HOSTS {
            assert!(
                names.contains(&host),
                "{host} is not an agent name any more; the legacy shim purge is dead code"
            );
        }
    }

    #[test]
    fn an_entry_is_stale_only_where_it_is_actually_stale() {
        // Cursor: a project entry shadows the user-level one, and the
        // user-level one is what we just installed.
        let mut cursor = entry(
            "cursor",
            "sealgate",
            "/home/u/p/.cursor/mcp.json",
            &["mcpServers"],
            Scope::Project(PathBuf::from("/home/u/p")),
            "https://x",
        );
        assert_eq!(stale_reason(&cursor), Some(Stale::Shadowing));
        cursor.scope = Scope::Global;
        assert_eq!(stale_reason(&cursor), None);

        // A Claude host is stale only when the entry is the shim. An HTTP entry
        // there is someone's own doing - SealGate never wrote one.
        let mut claude = entry(
            "claude_desktop",
            "sealgate",
            "/home/u/claude_desktop_config.json",
            &["mcpServers"],
            Scope::Global,
            "https://x",
        );
        assert_eq!(stale_reason(&claude), None);
        claude.config = stdio("npx", &["-y", "mcp-remote", "https://x"]);
        assert_eq!(stale_reason(&claude), Some(Stale::LegacyShim));

        // The same shim under a host SealGate never wrote it to stays put.
        let mut elsewhere = claude.clone();
        elsewhere.client = "vscode";
        assert_eq!(stale_reason(&elsewhere), None);
    }
}
