# Quarantine Daemon — Architecture & Design

> Status: **Design agreed**, pre-implementation. Date: 2026-06-30.
> Scope: the Rust reimplementation of the MCP discovery + quarantine subsystem of
> `client_2` (the SealGate Electron app) as a privileged system agent.

This document captures the architecture decided for the Rust quarantine daemon and
**the reasoning behind each decision** — especially the non-obvious ones. It is the
source of truth for the design; the current code (`sealgate-detectord` read-only
watcher + `mcp_detector_daemon` FDA-gated per-user daemon) predates it and will be
reshaped to match.

---

## 1. Problem & goals

MCP servers are configured independently by each host app (Claude Code, VSCode,
Cursor, Claude Desktop, …), often across several files per app. SealGate needs
to **discover** those servers and, when an admin requires it, **quarantine** them —
move them off the local config and onto the SealGate backend.

Today this lives in the `client_2` Electron app, where the app *itself* is the
enforcer. That is the weakness we are fixing: enforcement runs as the user, in a
process the user can stop. The Rust effort exists to make quarantine **faster, more
robust, and enforceable as a system agent**, because the functionality is
**imposed by admins**.

Two operating modes (one policy switch):

- **Quarantine OFF** — auto-discovery only; servers move to SealGate only when
  the user explicitly chooses to.
- **Quarantine ON** — auto-discovery **plus** continuous enforcement: new servers
  are actively detected and removed.

The only behavioural difference between the two modes is **what happens to a server
the user does *not* send to SealGate**: OFF leaves it; ON removes it anyway.

## 2. Posture & threat model (the reframe everything follows from)

Because quarantine is **admin-imposed** and the daemon must be a service the user
**cannot stop**, this is **not a detector that helps an app** — it is a
**privileged enforcement agent that assumes the local user is adversarial.** The
user may actively try to run a forbidden server: editing configs back, restoring a
quarantined entry, killing the helper UI, or feeding a fake "quarantine off" flag.

Every decision below falls out of that single fact.

---

## 3. Key decisions

Each is stated with its rationale; details follow in §4+.

1. **Privileged, non-stoppable process.** A root `LaunchDaemon`
   (`/Library/LaunchDaemons`), not a per-user `LaunchAgent`. A user can
   `launchctl unload` their own agent, so the agent model cannot satisfy
   "not stoppable by the user." Root ownership also dissolves the Full-Disk-Access
   dance (the current FDA state machine goes away).

2. **The daemon owns *all* detection — read *and* write.** Enforcement integrity
   requires the same privileged process that detects to also act. The Electron UI
   is demoted to a helper: it pops up notifications, collects a rename, and asks
   the daemon questions. It performs **no** config writes, ever.

3. **Multi-tenant, keyed by OS user, identified by the kernel.** One root daemon
   serves all users. The principal for every request is the **peer uid**
   (`getpeereid`), not anything the (untrusted) UI asserts. Operations are scoped
   to that uid; a UI connection cannot see or act on another user's servers.

4. **Trust boundary flips: the UI can request/suggest, never decide/veto/disable.**
   The policy flag and approved-server list must be **daemon-fetched and
   daemon-owned**, never sourced from the user-space app. Enrollment is the one
   moment the UI hands over a credential — the user's own key, for their own org.

5. **Fail-closed, last-known-good policy.** The client today fails *open*
   (`fetchAutoQuarantineEnabled` returns `false` on any error). For an enforcement
   daemon that is backwards — "backend unreachable" must **not** mean "enforcement
   off." The daemon caches the last successfully-fetched policy + known-set and
   keeps enforcing through outages. There is no cold-start gap because enrollment
   happens during sign-in (inherently online); enrollment is not marked active
   until the first policy fetch succeeds.

6. **Quarantine-first.** On detecting an unknown server the daemon **neutralizes it
   immediately** (moves it to a sidecar), *then* asks the user for disposition.
   This closes the race where a user adds a forbidden server and uses it during the
   prompt window. It also collapses two mutation paths into one (see §9).

7. **Level-triggered reconciliation, not edge-triggered diffing.** Both `client_2`
   (`lastKnownServers` diff) and the current Rust prototype (`diff::Snapshot`) react
   to *changes*. Against an adversarial user that is fragile. Instead the daemon
   reconciles **current observed state** against policy every cycle (kubelet-style).
   Tamper-resistance then falls out for free: a restored server is simply present
   next cycle and gets removed again — no "drop from last-known" trick, no
   dependence on catching the edit event.

8. **Identity = a frozen, three-way fingerprint contract.** The fingerprint is
   computed independently by the **Python backend** and the **TS client** today and
   they are deliberately kept identical. The Rust daemon must join that contract
   byte-for-byte (see §6). This is a freeze-and-port, not a redesign.

9. **Strict crate layering by trust/privilege** (see §11): read-only engine →
   mutation+logic → backend client → privileged binary, with a no-cycle DAG.

---

## 4. Privilege & process model

- **Root `LaunchDaemon`**, one per machine, serving every OS user.
- **Identity via peer credentials.** A single root-owned socket
  (e.g. `/var/run/sealgate/daemon.sock`, permissive perms). On each connection
  the daemon calls `getpeereid(fd) → uid`. That uid is the authz principal and maps
  to an enrollment. Authz is **kernel-enforced**, not asserted by the UI, so it
  cannot be spoofed. An un-enrolled uid may only call `Enroll`.
- **Privilege-drop on write.** MCP configs live in each user's home. When mutating a
  user's files the daemon drops to that user (`seteuid` / write-then-`chown`) so
  file ownership stays correct. Decision logic runs as root; only the file touch is
  de-privileged.
- **FDA is gone.** The `Starting/AwaitingFda/Running` machine and `permission.rs`
  TCC probe are removed; a root daemon has the access and gets identity from
  `getpeereid` instead.

## 5. Enrollment, policy & state ownership

**Root-owned enrollment store** — `/Library/Application Support/sealgate-detectord/
enrollments.json`, `root:wheel`, `0600` — keyed by OS user:

```jsonc
{
  "enrollments": {
    "alice": {
      "env": "prod",
      "api_base_url": "https://dashboard.sealgate.ai",
      "api_key": "sg_live_…",            // alice's bearer — same key the app uses
      "org_id": "org_…",
      "policy":     { "auto_quarantine": true, "fetched_at": "…" },  // last-known-good
      "allow_list": [ { "name": "…", "fingerprint": "…", "status": "registered" } ],
      "allow_list_fetched_at": "…"
    }
  }
}
```

- **Auth is unchanged from the client**: bearer API key over REST. There is **no**
  machine/device-token mechanism today, so the daemon stores **user→API-key pairs**
  in this root-owned file. The client confirms it accesses the backend via the REST
  API, **never the DB directly** (`domainConfig.ts`; no `pg`/`supabase` in
  `src/main`).
- **Endpoints** (all `Authorization: Bearer <key>`):
  - `GET /api/v1/user/domain-config` → `auto_quarantine_other_mcp_servers`
  - `GET /api/v1/servers/fingerprints` → org known-set (registered + requested)
  - `POST /api/v1/mcp-requests` → submit / register a server
- **Enrollment = sign-in handshake.** The UI (running as the user) sends
  `Enroll{api_key, env}`; the daemon validates by resolving `org_id` and does its
  **first** policy + known-set fetch. Enrollment is only marked active once that
  fetch succeeds. Because sign-in is inherently online, there is no
  "enrolled-but-never-reached-backend" state.
- **Root-owned storage is what makes it tamper-resistant**: after enrollment,
  logout / key-deletion in user space cannot starve the daemon of policy.
- **Refresh loop**: poll `domain-config` + `fingerprints` per user (~5 min). On any
  error, **keep the cached values and keep enforcing** (fail-closed). Never
  downgrade to "off" on a failed fetch.
- **Authoritative state is root-owned.** Local config files and `disabled_` sidecars
  are treated as *untrusted input to reconcile*, never as the source of truth.

### Residual bypass (accepted, deferred)

Without a device identity / MDM binding, nothing stops a user from enrolling with a
**personal org's** key whose policy has quarantine off. This is the same limitation
`client_2` has today. Out of scope until a machine-token mechanism exists.

## 6. Identity — the fingerprint contract

The fingerprint answers *"is this server already known to the backend?"* — it
governs **prompt vs. silent removal**, not allow vs. block. (Under quarantine ON,
*nothing* stays locally; the fingerprint only decides whether the user is
prompted.)

It is a **three-way contract**, currently honoured by two independent
implementations that must stay identical, with the Rust daemon to become the third:

- Backend: `src/api/v1/routes/servers_fingerprints.py::compute_server_fingerprint`
- Client: `client_2/src/main/discovery/seenServersStore.ts::getServerFingerprint`

Both docstrings cite each other as the thing they must match.

**Algorithm** (16-char prefix of `sha256(identifier)`):

- stdio: `identifier = f"{name}:{command}:{' '.join(args)}"`
- http : `identifier = f"{name}:{url}"`
- else : unfingerprint-able → **skipped**
- All `{PLACEHOLDER}` template tokens are normalized to bare `{}` before hashing, so
  placeholder *names* never affect the result.

### The split that locates the risk

- **Hash half — trivial, low risk.** ~10 lines; already mirrored in Python and TS.
  Port byte-exact.
- **Secret-templatization half — the entire risk, client-side only.** The backend
  **never runs secret detection**; dashboard servers are *born templatized* (admins
  enter `{API_TOKEN}` template fields) and it just hashes raw rows
  (`servers_fingerprints.py:11-15`). The client/daemon discovers configs **raw**
  (real `sk-…` value baked in) and must run `detectSecrets()` to turn the secret
  into `{}` *before* hashing, or the identifier diverges and an already-known server
  is falsely re-prompted. The **only** reference for this half is
  `client_2/src/main/discovery/secretDetection.ts`.

**Decision:** freeze-and-port. Redefining would mean a coordinated migration across
backend + TS client + every stored fingerprint + the new daemon — not viable. Lock
it with a **shared golden-vector corpus** (`raw config → templatized → fingerprint`
triples emitted by the live TS implementation, asserted in Rust CI).

**Per the team:** exact secret-detection parity is **deferred** — both sides replace
with placeholders; if the daemon's detection diverges that is a separate bug to fix
later, not an architecture blocker.

### Blind spot (intentional)

Identity includes `command/args/url`, so **re-pointing a server's command is caught
automatically** (new fingerprint → unknown → quarantined), fixing the prototype's
"modifications ignored" gap. But secret **values** are templatized out, so
**rotating a credential is invisible** (same fingerprint). Intended — the backend
never sees per-user secret values. Structural changes are enforced; value swaps are
not.

## 7. Discovery — the `Agent` trait

> Terminology: **agent** = an MCP host app (Claude Code, VSCode, Cursor). **UI** =
> the Electron subscriber to the daemon. "Client" is retired because it overloaded
> both. The trait `Client` is renamed `Agent`.

```rust
pub trait Agent: Send + Sync {            // Claude Code, VSCode, …
    fn name(&self) -> &'static str;
    fn is_installed(&self) -> bool;                       // → ListAgents / onboarding
    fn watch_targets(&self) -> WatchTargets;              // files (d0) + dirs (dN) + needs_periodic_rescan
    fn discover(&self) -> Result<Vec<DiscoveredServer>>;  // Stdio | Http only; unsupported skipped
}

pub struct DiscoveredServer {
    pub client: &'static str,
    pub name: String,            // current map key (post-rename)
    pub scope: Scope,            // Global | Project(path)
    pub transport: Transport,
    pub config: ServerConfig,    // RAW payload — needed for fingerprint + action
    pub location: ConfigLocation,
}

pub enum ServerConfig {
    Stdio { command: String, args: Vec<String>, env: BTreeMap<String, String> },
    Http  { url: String, headers: BTreeMap<String, String>, kind: HttpKind },
}

pub struct ConfigLocation {       // self-describing: where + how to mutate
    pub kind: SourceKind,         // dispatch target for the writer
    pub path: PathBuf,
    pub key_path: Vec<String>,    // ["mcpServers"] | ["projects","/p","mcpServers"] | ["servers"]
    pub server_key: String,       // the map key to remove (originalName)
    pub extra: LocationExtra,     // CLI project dir, plugin dir, sqlite row id…
}

pub enum SourceKind { Json, Jsonc, Toml, SqliteState, ClaudeCli, CursorPluginDir }
```

- **The seam: the agent owns the *locator*; a shared store owns the *mechanics*.**
  Discovery emits self-describing servers (each carries how to mutate it). The
  agent's read+write *semantics* stay co-located ("my project-scoped servers go
  through the CLI"), while the byte-manipulation per `SourceKind` is written once,
  not per agent. Client-specific mechanisms (CLI, plugin-dir) are just more kinds.
- **Unsupported / opaque servers are not emitted** (no extractable command/url).
  Nothing happens for them, exactly as today. May be surfaced to admins later.
- **Fingerprint is computed in the engine, not by agents** — single source of the
  frozen contract; agents stay dumb.

## 8. The reconciliation loop

Per enrolled OS user, **level-triggered**, **armed only when policy = ON**:

```
reconcile(user):                          # serialized; coalesce triggers (dirty flag)
  policy = policy_cache[user]             # last-known-good
  if policy.quarantine == OFF:
      return                              # discovery/report only; no auto-mutation

  observed = discover_all(user)           # every agent, raw config + locator
  for srv in observed:
      if is_sealgate_entry(srv): continue   # never touch our own injected server
      fp = fingerprint(srv)               # ported detectSecrets + sha256
      if fp is None: continue             # unsupported → skip
      if known.contains(fp):              # seen-store oracle
          enforce_removed(srv)            # SILENT: ensure quarantined/removed
      else:
          enforce_removed(srv)            # QUARANTINE-FIRST: neutralize now
          seen.mark(fp, pending)
          emit_pending(user, srv, fp)     # → UI popup, async disposition
```

- `enforce_removed` is **idempotent** — already-quarantined servers are a no-op, so
  repeated runs are cheap and convergent.
- **Triggers** (all just *hints to reconcile*, never the basis of correctness):
  fs events on watched parent dirs (debounced) · periodic safety-net rescan (~20 s,
  catches event-less changes: SQLite `state.vscdb`, extension-API installs) ·
  backend policy/known-set refresh (~5 min) · enrollment (initial full sweep that
  secures pre-existing state).
- **Concurrency**: one serialized reconcile worker per user with a coalescing
  dirty-flag (mirrors `client_2`'s `isCheckingForChanges`/`pendingRescan`).
- **OFF mode** is inert — pure discovery/reporting; mutation only on an explicit
  user "send to SG." The same engine with the worker *disarmed*.

## 9. The "known" oracle & mutation

**`known` is a local seen-store, not the raw backend list.** It is fed by two
writers:

1. **Backend sync** upserts `registered`/`requested` fingerprints — covers servers
   registered on the dashboard or by other machines.
2. **Local user decisions** write `dismissed`/`requested`/`registered`.

Reconcile queries only the seen-store. **Why the union matters:** a **rename changes
the fingerprint** (name is in the identifier), so a renamed-and-sent server is stored
at the backend under the *new* fingerprint while the local config still has the
*old* one. The local seen-store (keyed by the *detected* fp, marked when the user
acted) suppresses the re-prompt; the backend set alone would re-prompt forever.

- Store is **root-owned** and org-scoped (compound key `org_id:fingerprint`).
- **Prune rule:** backend-sync may only drop entries that *came from* the backend and
  vanished — it must **not** delete local-only `dismissed` entries, or skipped
  servers re-prompt on the next sync.

**Mutation — `ConfigStore`, dispatched on `location.kind`:**

```rust
pub trait ConfigStore: Send + Sync {
    fn quarantine(&self, loc: &ConfigLocation, cfg: &ServerConfig) -> Result<QuarantineRecord>;
    fn restore(&self, rec: &QuarantineRecord) -> Result<()>;   // internal only — see §10
}
```

- Mechanics per kind: backup → move entry to `disabled_<config>.json` sidecar
  (JSONC surgical edit preserving comments) / SQLite mutation / `claude mcp remove` /
  plugin-dir rename → rollback on failure.
- **Quarantine-first shrinks the surface.** `client_2` needed two write paths —
  `removeServerFromConfig` (delete, for "Add to SealGate") and `quarantineServer`
  (sidecar, for skip). Here *every* detection goes to the sidecar first, so
  disposition needs no separate delete path: "send to SG" = submit to backend
  (+ optionally purge the now-redundant sidecar entry); "skip" = leave in sidecar.
  The irreversible delete disappears — safer.
- **Writers are privilege-free file ops** (testable in a tempdir). Privilege-drop is
  a wrapper the daemon adds around the call, not baked into the writer.

## 10. IPC contract

**Transport:** one root socket; principal = `getpeereid` uid; newline-delimited JSON;
`request_id` for correlation. **Pushes are best-effort; authoritative state is
queryable** — the UI must not depend on having received a push. On startup it calls
`ListServers{state: QuarantinedPending}` and renders popups for whatever is there.

```rust
// ── UI → daemon ──  (principal = peer uid; NOT in the message)
enum Request {
    Enroll      { api_key: String, env: String },
    GetStatus,
    ListAgents,                                      // which host apps are present
    ListServers { state: Option<ServerState>, agent: Option<String> },
    Disposition { fingerprint: String, choice: Choice },
    RefreshPolicy,                                   // force a re-sync
}
enum Choice { SendToEw { rename: Option<String> }, Skip }

// ── daemon → UI ──
enum Message {
    Status(StatusReply), Agents(Vec<AgentInfo>), Servers(Vec<ServerView>),
    Ack, Error { code: ErrorCode, message: String },
    Event(Event),                                    // unsolicited push
}
enum Event {
    Quarantined(ServerView),                         // already neutralized, awaiting disposition
    Discovered(ServerView),                          // quarantine-OFF / informational
    ServerStateChanged { fingerprint: String, state: ServerState },
    PolicyChanged      { quarantine_on: bool },
}
enum ServerState { Live, QuarantinedPending, SentToEw, Skipped }

struct StatusReply {                                 // stdio-d-style flat status, NOT an FDA machine
    installed: bool, enrolled: bool, quarantine_on: bool,
    last_policy_sync: Option<i64>, state_age_ms: u64,   // liveness/heartbeat
    agents_watched: Vec<String>, version: String,
}
```

- **`Disposition` is a request, not a write.** `SendToEw` → daemon does
  `POST /mcp-requests` (renamed config, that uid's key), marks seen, purges sidecar.
  `Skip` → marks `dismissed`. The UI proposes; the daemon disposes.
- **Disposition is never time-critical** (quarantine-first ⇒ already safe). No
  blocking, no timeout; an unanswered prompt just stays quarantined.
- **No restore verb.** Local re-materialization happens only on policy-off or
  un-enroll, as an internal daemon action.

**Operator CLI** (mirrors `stdiod`; root-gated — natural, since the daemon and plist
are root-owned):

```
sealgated install
sealgated uninstall [--purge]     # tear down LaunchDaemon; --purge wipes enrollments/state
sealgated unenroll <user>         # drop one enrollment, keep the daemon
sealgated enroll --user <u> --key <k>   # debug convenience
sealgated status                  # same flat status as GetStatus, from a written state.json
```

Over the socket, admin ops are gated by `peer_uid == 0`. The UI never gets
unenroll/uninstall/restore. (`stdiod` precedent:
`client_2/src/main/stdiod/controller.ts` — `install`/`uninstall --purge`/`status`,
status = `{binaryAvailable, installed, loggedIn, state, stateAgeMs}`.)

## 11. Crate layout

Organizing principle: **isolate by trust/privilege so each boundary is auditable.**

```
crates/
  sealgate-detectord/      READ-ONLY engine. Cross-platform, no root, no network, publishable.
    agent.rs             trait Agent (was Client)
    agents/{claude_code,vscode}.rs   parsers → DiscoveredServer
    types.rs             DiscoveredServer, ServerConfig, ConfigLocation, SourceKind, Scope, Transport
    fingerprint.rs       ported getServerFingerprint              ← frozen contract
    secret_detection.rs  ported detectSecrets                     ← the fragile half
    watch.rs             WatchTargets

  mcp_quarantine/        MUTATION + decision logic. No privilege, no IPC, no network.
    configstore.rs       trait ConfigStore + kind-dispatched writers
    writers/{json,jsonc,sqlite,claude_cli,plugin_dir}.rs
    seen_store.rs        persistent known-oracle (path injected)
    reconcile.rs         pure planner: plan(observed, oracle, policy) -> Vec<Action>
    # depends on: sealgate-detectord

  mcp_backend/           Backend REST client (reqwest). No privilege.
    lib.rs, types.rs     domain_config / server_fingerprints / submit_request
    # depends on: sealgate-detectord

  mcp_detector_daemon/   THE binary. All privilege + all wiring.
    main.rs              operator CLI
    enrollment.rs        root-owned enrollments.json
    policy.rs            backend refresh w/ fail-closed last-known-good
    supervisor.rs        per-user reconcile WORKERS (triggers, debounce, timers, dirty-flag)
    privilege.rs         getpeereid scoping · privilege-drop-on-write
    ipc.rs               root socket · uid→enrollment dispatch · UI protocol
    protocol.rs          Request / Message / Event / StatusReply
    platform/launchd.rs  plist install/uninstall · state.json writer
    # depends on: all three above
```

**Dependency DAG (strict, acyclic):**

```
              sealgate-detectord
              ▲       ▲       ▲
     mcp_quarantine   │   mcp_backend          (siblings; no edge between them)
              ▲       │       ▲
              └───────┼───────┘
                mcp_detector_daemon
```

Two deliberate non-edges:

- **`mcp_quarantine` does not depend on `mcp_backend`.** Reconcile reads only the
  local `seen_store`. The daemon does backend sync → writes the known-set into
  `seen_store` → reconcile reads it. Decision logic never touches the network and is
  unit-testable with a hand-built oracle.
- **`reconcile` is a pure planner; the *driver* is in the daemon.**
  `plan(observed, oracle, policy) -> Vec<Action>` is deterministic and testable; the
  messy parts (watching, debounce, timers, per-user serialization, privilege-drop,
  IPC emit) live in `supervisor.rs`.

**Why:** the read-only engine stays publishable and root-free (a reviewer auditing
"does discovery touch disk?" reads one crate); all mutation is in one root-free crate
(test sidecar+surgical-edit in a tempdir, no root); all danger — `getpeereid`,
privilege-drop, root socket, launchd, operator CLI — collapses into the binary.

**Port vs. new:**

| Crate | Status | Work |
|---|---|---|
| `sealgate-detectord` | exists, reshape | `Client→Agent`; `parse_all→discover` (raw config + locator); add `fingerprint`/`secret_detection`; `watch_paths→watch_targets` |
| `mcp_quarantine` | new | configstore + writers, seen_store, reconcile planner |
| `mcp_backend` | new | thin reqwest client over 3 endpoints |
| `mcp_detector_daemon` | exists, heavy rework | drop FDA + `permission.rs`; add root socket + uid scoping + multi-user workers + enrollment + policy refresh + operator CLI + privilege-drop + launchd |

## 12. Open / deferred

- **Secret-detection parity** — deferred; lock with golden vectors when addressed
  (§6).
- **Residual enroll-with-permissive-org bypass** — needs a device token / MDM
  binding; out of scope until that exists (§5).
- **Unsupported/opaque server visibility** — currently skipped silently; could be
  surfaced to admins later (§7).
- **Non-macOS platforms** — layout is cross-platform but the daemon's launchd +
  privilege-drop are macOS-first; Linux (systemd) / Windows parallels later.
- **Tool-level introspection** — *not* required. "Discover the agents" means
  detecting installed host apps (`is_installed`), not connecting to servers to list
  tools.

## 13. Reference — `client_2` mechanisms to port

| Concern | Source |
|---|---|
| Fingerprint (backend, canonical hash) | `src/api/v1/routes/servers_fingerprints.py` |
| Fingerprint (client) + seen-store | `client_2/src/main/discovery/seenServersStore.ts` |
| Secret templatization | `client_2/src/main/discovery/secretDetection.ts` |
| Discovery aggregator + dedup | `client_2/src/main/discovery/mcpDiscovery.ts` |
| Agent registry + config entries | `client_2/src/main/clients/registry.ts`, `clients/types.ts` |
| Monitor (diff, rescan, re-quarantine) | `client_2/src/main/runtime/mcpConfigMonitor.ts` |
| Mutation (quarantine/remove/restore) | `client_2/src/main/runtime/mcpConfigActions.ts` |
| Policy orchestration + silent rules | `client_2/src/main/quarantine/quarantineManager.ts` |
| Admin flag fetch | `client_2/src/main/infra/domainConfig.ts` |
| Backend sync of known-set | `client_2/src/main/discovery/seenServersBackendSync.ts` |
| Daemon lifecycle precedent (CLI + status) | `client_2/src/main/stdiod/controller.ts` |
