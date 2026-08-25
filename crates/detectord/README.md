# SealGate Quarantine Daemon

Open Rust code for the SealGate **MCP quarantine** system agent. It discovers
the MCP (Model Context Protocol) servers configured across a machine's host apps
(Claude Code, VSCode, …) and — when an admin requires it — quarantines them:
moves them off the local config and onto the SealGate backend.

The target design (a privileged, non-stoppable, multi-user enforcement daemon) is
specified in **[docs/architecture.md](docs/architecture.md)** — read that for the
*why* behind the decisions (root `LaunchDaemon`, `getpeereid` scoping, fail-closed
policy, quarantine-first, level-triggered reconciliation, the frozen fingerprint
contract). This README describes what is **implemented today**; the repo is
mid-migration from a read-only detector toward that design.

## Workspace

| Crate | Path | Role | Status |
|---|---|---|---|
| `sealgate-detectord` | [crates/sealgate-detectord/](crates/sealgate-detectord/) | Read-only engine: agent abstraction, discovery, fingerprint, filesystem watcher. Cross-platform, publishable. | Reshaped |
| `mcp_quarantine` | [crates/mcp_quarantine/](crates/mcp_quarantine/) | Mutation + state + the reconcile planner. No privilege/IPC/network. | Planner done; seen-store + writers WIP |
| `mcp_detector_daemon` | [crates/mcp_detector_daemon/](crates/mcp_detector_daemon/) | Long-lived macOS daemon wrapping the engine behind a Unix-socket IPC. | Being reworked to the root enforcement model |

Build everything: `cargo build --workspace --release`. Test: `cargo test --workspace`.

## Motivation

MCP servers are configured independently by each host app — often in several
places per app: a global user-level file, per-project files, and sometimes
application state in a SQLite database. Quarantine is **imposed by admins**, so it
must run as a system agent the user cannot stop. That posture — a privileged
enforcement agent that assumes the local user is adversarial — drives the whole
design.

## Library — `sealgate-detectord`

The read-only engine. Cross-platform, no root, no network.

- **Agent abstraction.** Each supported host app implements the [`Agent`](crates/sealgate-detectord/src/agent.rs)
  trait: `name`, `is_installed`, `watch_targets`, and `discover`. `discover`
  normalises each on-disk entry into a [`DiscoveredServer`](crates/sealgate-detectord/src/types.rs)
  carrying its raw `config` ([`ServerConfig::Stdio` | `Http` | `Unsupported`]) and
  a `location` (where + how to mutate it).
- **Server fingerprint.** [`fingerprint`](crates/sealgate-detectord/src/fingerprint.rs)
  computes the stable identity used to ask "is this server already known to the
  backend?". It is a **frozen cross-implementation contract** — byte-for-byte
  identical to the Python backend and the TS client (`sha256(identifier)[:16]`,
  secrets templatised first via [`secret_detection`](crates/sealgate-detectord/src/secret_detection.rs)).
  Pinned by golden-vector tests. See [docs/architecture.md §6](docs/architecture.md).
- **Event-driven watching.** [`Watcher`](crates/sealgate-detectord/src/watcher.rs)
  uses `notify-debouncer-full` against parent directories (editors write configs
  via atomic rename, which breaks single-file watches) and emits `ChangeEvent`s.
  *(This edge-triggered watcher will be superseded by the daemon's level-triggered
  reconcile driver — see the design doc.)*

### Source shapes

Config sources differ in **format** (JSON / JSONC / SQLite state DB), **scope** (a
single file can mix global and project entries, e.g. Claude Code's `~/.claude.json`
`projects` map), and **location** (project configs live inside each project dir).
The `Agent` trait hides all of this; servers that expose no extractable
command/url (e.g. VSCode extension-provider contributions) are emitted as
`ServerConfig::Unsupported` — surfaced for reporting, skipped by enforcement.

### Supported agents

| Agent | Status | Cargo feature | Notes |
|---|---|---|---|
| VSCode | Implemented | `vscode` | Global, per-workspace, and extension/marketplace (`state.vscdb`) servers |
| Claude Code | Implemented | `claude_code` | Global + per-project servers (`~/.claude.json`, `.mcp.json`) |
| Cursor, Claude Desktop, Zed, Codex | Planned | — | |

### Use as a dependency

```toml
[dependencies]
sealgate-detectord = "0.1"
```

```rust,no_run
use std::sync::Arc;
use sealgate_detectord::{Agent, Result, Watcher, clients::{ClaudeCode, VsCode}};

fn main() -> Result<()> {
    let agents: Vec<Arc<dyn Agent>> = vec![
        Arc::new(VsCode::discover()?),
        Arc::new(ClaudeCode::discover()?),
    ];
    let (events, _handle) = Watcher::new(agents).spawn()?;
    for ev in events {
        println!("{ev}");
    }
    Ok(())
}
```

`discover()` uses platform-specific paths; for tests/CI use `from_paths(...)`. Each
agent lives behind its own cargo feature (`vscode` pulls in `rusqlite`; both on by
default).

## Quarantine layer — `mcp_quarantine`

Mutation, persistent state, and the decision logic — **no privilege, no IPC, no
network** (the daemon injects those). Everything here is unit-testable in a
tempdir.

- **Reconcile planner** ([reconcile.rs](crates/mcp_quarantine/src/reconcile.rs)) —
  *implemented.* The pure, level-triggered heart:
  `plan(observed, oracle, policy) -> Vec<Action>`. Quarantine-first — an unknown
  server is neutralised immediately, then surfaced for disposition; a known one is
  quarantined silently; the policy-off pass is inert; our own `sealgate` entry
  and report-only servers are skipped. Being level-triggered, it is inherently
  tamper-resistant (a restored server simply reappears next pass).
- **Seen-store** (the `KnownOracle`) and **config writers** (`quarantine`/`restore`,
  dispatched on `SourceKind`) — *in progress.*

## Daemon — `mcp_detector_daemon`

Long-lived macOS process wrapping the engine over a Unix-domain socket. It runs
a reconcile worker per enrolled user: each pass discovers every agent's servers,
plans against the seen-store and org policy, and — once enrolment is armed —
quarantines what the plan says to.

It needs **no Full Disk Access**. That grant is only ever about what may be
*watched*: an FSEvents stream is recursive at the API level, so watching `$HOME`
would reach Desktop, Documents and Downloads and prompt for each. The watch set
therefore excludes `$HOME` (the one config file directly inside it is watched as
a leaf path) and skips the protected folders outright — see
[`tcc.rs`](crates/sealgate-detectord/src/tcc.rs). Reading and writing the config
files themselves was never gated.

Shipped from the design doc: per-user reconcile workers, enrollment + fail-closed
policy, an operator CLI (`install`/`uninstall`/`unenroll`/`status`), and a
`state.json` status file. Still outstanding is the *privileged* half — it
installs today as a per-user `LaunchAgent` (`~/Library/LaunchAgents`), not a root
`LaunchDaemon`, and the socket does not yet scope connections with `getpeereid`.
Until then a user can `launchctl unload` their own agent. See
[docs/architecture.md §4–§10](docs/architecture.md).

## Repository layout

```
.
├── Cargo.toml                # virtual workspace
├── docs/architecture.md      # design source of truth
└── crates/
    ├── sealgate-detectord/      # read-only engine
    ├── mcp_quarantine/        # mutation + state + reconcile
    └── mcp_detector_daemon/   # macOS daemon binary
```
