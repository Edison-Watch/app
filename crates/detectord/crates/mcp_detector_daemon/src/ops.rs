//! Operations behind both the CLI and the IPC server, each scoped to an OS
//! user. Returning protocol DTOs keeps the two front-ends in sync.

use anyhow::Context;
use edison_detectord::{DiscoveredServer, ServerConfig, fingerprint};
use mcp_backend::{BackendClient, Error as BackendError, KnownStatus, SubmitRequest};
use mcp_quarantine::{
    Action as SeenAction, ConfigStore, FileConfigStore, SeenStore, is_edison_entry,
};

use crate::agents;
use crate::enrollment::Enrollment;
use crate::paths;
use crate::platform;
use crate::protocol::{AgentInfo, Choice, ServerView, Status};
use crate::quarantined::{QuarantinedEntry, QuarantinedState};

/// Which agents are present on the machine.
pub fn list_agents() -> Vec<AgentInfo> {
    agents::build()
        .iter()
        .map(|a| AgentInfo {
            name: a.name().to_string(),
            installed: a.is_installed(),
        })
        .collect()
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
    let state = if is_edison_entry(s) {
        "edison"
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
/// policy and known set, then install the `edison-watch` proxy entry into the
/// selected agents (when an MCP base URL was given).
/// `mcp_base_url`, `selected_agents`, and `secret` are all optional inputs from
/// the UI/CLI: `None`/unspecified keeps the previous value, so re-running
/// `enroll` acts as an update. The selection diff uninstalls edison-watch from
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
    // gateway will accept the X-Edison-Secret-Key header we install. Done before
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
    let new_agents = match selected_agents {
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
    let mcp_base_url =
        mcp_base_url.or_else(|| existing.as_ref().and_then(|e| e.mcp_base_url.clone()));
    let edison_secret_key =
        secret.or_else(|| existing.as_ref().and_then(|e| e.edison_secret_key.clone()));
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
        edison_secret_key,
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

/// Apply everything under the target user's home: the `edison-watch` MCP entry
/// for the *selected* agents, and hooks for *all installed* agents (as the app
/// does). Best-effort — a failure on one agent is logged, not fatal.
pub fn apply_install(user: &str, e: &Enrollment) {
    let home = user_home(user);
    install_edison_entries(user, e, &home);
    apply_hooks(&home);
}

fn install_edison_entries(user: &str, e: &Enrollment, home: &std::path::Path) {
    let Some(mcp_base) = e.mcp_base_url.as_deref() else {
        if !e.selected_agents.is_empty() {
            tracing::warn!(
                "agents selected but no mcp_base_url set — skipping edison-watch install"
            );
        }
        return;
    };
    let secret = e.edison_secret_key.as_deref();
    for agent in agents::build() {
        if !e.selected_agents.iter().any(|s| s == agent.name()) {
            continue;
        }
        for inst in agent.edison_installs(home) {
            // Claude Code goes through its own CLI (as the user); the file write
            // is the fallback.
            let done_via_cli = inst.prefer_cli
                && {
                    let url = mcp_quarantine::edison_url(mcp_base, &e.api_key, &inst.client_id);
                    match crate::claude_cli::install(user, &url, secret) {
                        Ok(()) => {
                            tracing::info!(
                                agent = agent.name(),
                                "installed edison-watch (via claude CLI)"
                            );
                            true
                        }
                        Err(err) => {
                            tracing::warn!(agent = agent.name(), error = %err, "claude CLI failed; writing the file directly");
                            false
                        }
                    }
                };
            if !done_via_cli {
                match mcp_quarantine::install_edison(&inst, mcp_base, &e.api_key, secret) {
                    Ok(()) => {
                        tracing::info!(agent = agent.name(), path = %inst.path.display(), "installed edison-watch")
                    }
                    Err(err) => {
                        tracing::warn!(agent = agent.name(), error = %err, "edison-watch install failed")
                    }
                }
            }
        }
    }
}

/// Re-install the edison-watch entry for any *selected* agent where it's
/// currently missing — e.g. the user replaced/overwrote a config file, dropping
/// our entry. Only writes when the entry is absent (checked against live
/// discovery), so it never rewrites a config that already has it and can't loop
/// the fs watcher. Returns how many agents were (re-)installed.
pub fn heal_edison_install(user: &str, e: &Enrollment) -> usize {
    let Some(mcp_base) = e.mcp_base_url.as_deref() else {
        return 0;
    };
    if e.selected_agents.is_empty() {
        return 0;
    }
    let home = user_home(user);
    let present: std::collections::HashSet<&str> = agents::discover_all(&agents::build())
        .iter()
        .filter(|s| is_edison_entry(s))
        .map(|s| s.client)
        .collect();
    let secret = e.edison_secret_key.as_deref();
    let mut healed = 0;
    for agent in agents::build() {
        if !e.selected_agents.iter().any(|s| s == agent.name()) {
            continue;
        }
        if present.contains(agent.name()) {
            continue; // already installed — don't rewrite (avoids fs-watch churn)
        }
        for inst in agent.edison_installs(&home) {
            let done_via_cli = inst.prefer_cli && {
                let url = mcp_quarantine::edison_url(mcp_base, &e.api_key, &inst.client_id);
                crate::claude_cli::install(user, &url, secret).is_ok()
            };
            if !done_via_cli {
                let _ = mcp_quarantine::install_edison(&inst, mcp_base, &e.api_key, secret);
            }
        }
        tracing::info!(
            agent = agent.name(),
            "re-installed missing edison-watch entry (self-heal)"
        );
        healed += 1;
    }
    healed
}

/// Materialise the hook scripts under `home/.edison-watch`, then inject hooks
/// into every *installed* agent that has a hook surface (matching the app).
fn apply_hooks(home: &std::path::Path) {
    let scripts = match mcp_quarantine::ensure_scripts(&home.join(".edison-watch")) {
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

/// Remove the `edison-watch` entry from the given agents under `user`'s home.
fn remove_edison_for(user: &str, agents_to_remove: &[String]) {
    let home = user_home(user);
    for agent in agents::build() {
        if !agents_to_remove.iter().any(|s| s == agent.name()) {
            continue;
        }
        for inst in agent.edison_installs(&home) {
            let res = if inst.prefer_cli {
                crate::claude_cli::remove(user)
            } else {
                mcp_quarantine::uninstall_edison(&inst).map_err(Into::into)
            };
            if let Err(err) = res {
                tracing::warn!(agent = agent.name(), error = %err, "edison-watch uninstall failed");
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
        e.edison_secret_key = Some(key);
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
    e.edison_secret_key = Some(key);
    e.save_for(user)?;
    apply_install(user, &e);
    Ok(result)
}

/// Remove `user`'s enrollment (uninstalling edison-watch first); returns the org
/// name if it was enrolled.
pub fn unenroll(user: &str) -> anyhow::Result<Option<String>> {
    let removed = Enrollment::remove_for(user)?;
    if let Some(e) = &removed {
        remove_edison_for(user, &e.selected_agents);
        remove_all_hooks_for(user); // full teardown removes hooks everywhere
    }
    Ok(removed.map(|e| e.org_name))
}

/// Dispose of a discovered, fingerprint-able server: send it to EW (submit +
/// remove) or skip (remove + mark dismissed). Both remove it locally
/// (quarantine-first).
pub async fn disposition(
    user: &str,
    name: &str,
    agent: Option<&str>,
    choice: Choice,
    rename: Option<&str>,
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
        return disposition_quarantined(user, &e, &entry, choice, rename).await;
    }

    let observed = agents::discover_all(&agents::build());
    let matches: Vec<_> = observed
        .iter()
        .filter(|s| {
            s.name == name
                && agent.is_none_or(|a| s.client == a)
                && !is_edison_entry(s)
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
            submit_to_ew(&e, name, &server.config).await?
        }
        Choice::Skip => SeenAction::Dismissed,
    };

    let record = FileConfigStore
        .quarantine(&server.location, &server.config)
        .context("removing from local config")?;
    seen.mark(&fp, &server.name, action)?;

    let mut q = QuarantinedState::load_for(user)?;
    q.upsert(QuarantinedEntry {
        name: server.name.clone(),
        agent: server.client.to_string(),
        fingerprint: fp,
        config: Some(server.config.clone()),
        record,
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
) -> anyhow::Result<()> {
    let mut seen = SeenStore::open(paths::seen_store_path(user), e.org_id.clone())?;
    let action = match choice {
        Choice::SendToEw => {
            let config = entry.config.clone().ok_or_else(|| {
                anyhow::anyhow!("no stored config for '{}' — cannot send to EW", entry.name)
            })?;
            // Submit under the (possibly renamed) name, but keep marking the
            // *original* fingerprint known so the still-local server is silently
            // re-quarantined instead of re-prompting.
            let name = rename.unwrap_or(&entry.name);
            submit_to_ew(e, name, &config).await?
        }
        Choice::Skip => SeenAction::Dismissed,
    };
    seen.mark(&entry.fingerprint, &entry.name, action)?;
    tracing::info!(server = %entry.name, agent = %entry.agent, ?choice, rename, "disposition applied");
    Ok(())
}

/// Submit a config to the backend under `name`, templatizing detected secrets
/// first so raw credentials never leave the machine. Returns the seen-store
/// action (Registered for owner/admin, else Requested). A backend 409 is
/// surfaced as a `conflict:`-prefixed error so the UI can offer a rename.
async fn submit_to_ew(
    e: &Enrollment,
    name: &str,
    config: &ServerConfig,
) -> anyhow::Result<SeenAction> {
    let register = matches!(e.role.as_str(), "owner" | "admin");
    let config = edison_detectord::secret_detection::templatize_for_fingerprint(config);
    let res = BackendClient::new(e.api_base_url.clone(), e.api_key.clone())
        .submit(&SubmitRequest {
            name: name.to_string(),
            config,
            register,
            hostname: crate::platform::hostname(),
        })
        .await;
    match res {
        Ok(()) if register => Ok(SeenAction::Registered),
        Ok(()) => Ok(SeenAction::Requested),
        Err(err) if is_conflict(&err) => {
            anyhow::bail!("conflict: '{name}' is already registered at Edison Watch")
        }
        Err(err) => Err(anyhow::Error::new(err).context("submitting to backend")),
    }
}

/// Whether a backend error is a 409 name conflict.
fn is_conflict(err: &BackendError) -> bool {
    matches!(err, BackendError::Status { status, .. } if status.as_u16() == 409)
}
