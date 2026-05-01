# MCP Detector

Cargo workspace that watches the on-disk configs of MCP (Model Context Protocol) clients and reports changes as they happen. Two crates:

| Crate | Path | Role |
|---|---|---|
| `mcp_detector_lib` | [crates/mcp_detector_lib/](crates/mcp_detector_lib/) | Library: client abstraction, filesystem watcher, diff engine. Cross-platform, publishable. |
| `mcp_detector_daemon` | [crates/mcp_detector_daemon/](crates/mcp_detector_daemon/) | Long-lived macOS daemon: wraps the library behind a Unix-socket IPC, gated on Full Disk Access. |

Build everything: `cargo build --workspace --release`.

## What it does

MCP servers are configured independently by each client (Claude Code, VSCode, Cursor, Claude Desktop, ...) — often in several places per client: a global user-level file, per-project files, and sometimes application state stored in a SQLite database. This workspace unifies those sources into a single live stream of change events.

For the initial milestone the focus is additions and removals: **when an MCP server appears in or disappears from any tracked config, an event is emitted identifying it, its scope (global vs project-specific), and its transport (stdio vs remote).** In-place edits (same server name, different fields) are not reported yet.

## Library — `mcp_detector_lib`

- **Client abstraction.** Each supported client implements a common trait exposing (a) the set of config paths to watch and (b) a parser that normalises the on-disk shape into a shared `McpServer` type. Trait: [crates/mcp_detector_lib/src/client.rs](crates/mcp_detector_lib/src/client.rs).
- **Event-driven watching.** Uses `notify-debouncer-full` against parent directories rather than individual files — most editors write configs via atomic rename, which breaks single-file watches. Driver: [crates/mcp_detector_lib/src/watcher.rs](crates/mcp_detector_lib/src/watcher.rs).
- **Stateful diffing.** Maintains a last-known snapshot per config source; emits structured events on each debounced reparse. See [crates/mcp_detector_lib/src/diff.rs](crates/mcp_detector_lib/src/diff.rs).

### Source shapes

Config sources across clients differ in several important ways:

- **Format.** Most clients use JSON (`mcp.json`, `.mcp.json`, ...), but some store configuration or the metadata needed to *discover* project-level configs in a SQLite database (e.g. VSCode's `state.vscdb` workspace history).
- **Scope.** A single file can mix global and project-scoped entries (Claude Code's `~/.claude.json` embeds a `projects` map with per-project server lists).
- **Location.** Project-level configs live inside each project directory, so the detector has to know which projects to watch — either by enumerating them from the client's own state, or from a user-provided list.

The client abstraction hides all of this from the core watcher and diff logic.

### Supported clients

| Client | Status | Cargo feature |
|---|---|---|
| VSCode | Implemented | `vscode` |
| Claude Code | Implemented | `claude_code` |
| Cursor | Planned | – |
| Claude Desktop | Planned | – |

### Use as a dependency

```toml
[dependencies]
mcp_detector_lib = { path = "crates/mcp_detector_lib" }
```

Then drive the watcher:

```rust,no_run
use std::sync::Arc;
use mcp_detector_lib::{Client, Result, Watcher, clients::{ClaudeCode, VsCode}};

fn main() -> Result<()> {
    let clients: Vec<Arc<dyn Client>> = vec![
        Arc::new(VsCode::discover()?),
        Arc::new(ClaudeCode::discover()?),
    ];

    let (events, _handle) = Watcher::new(clients).spawn()?;
    for ev in events {
        println!("{ev}");
    }
    Ok(())
}
```

`Watcher::spawn` runs the watcher on a background thread; the returned handle stops the worker on drop. For a blocking, callback-based variant, use `Watcher::run`. Full example: [crates/mcp_detector_lib/examples/watch.rs](crates/mcp_detector_lib/examples/watch.rs).

`VsCode::discover()` and `ClaudeCode::discover()` use platform-specific paths. For tests, CI, or non-standard installs, use `from_paths(...)` to point each client at explicit locations instead.

### Cargo features

Each bundled client lives behind its own feature; both are on by default.

- `vscode` — pulls in `rusqlite` (bundled) for reading VSCode's `state.vscdb` workspace history.
- `claude_code` — no extra deps.

```toml
[dependencies]
mcp_detector_lib = { path = "crates/mcp_detector_lib", default-features = false, features = ["claude_code"] }
```

## Daemon — `mcp_detector_daemon`

Long-lived macOS process that wraps the library and exposes its events over a Unix domain socket. Designed to be supervised by a per-user LaunchAgent (the consumer ships the plist; the daemon just runs in the foreground until killed).

### State machine

```
Starting → AwaitingFda ↔ Running
```

- Boots the IPC server immediately so clients can connect and observe `awaiting_fda` even before permissions are granted.
- Polls a TCC-protected probe path (`~/Library/Application Support/com.apple.TCC/TCC.db` by default) every 3 seconds and on demand. Probe lives at [crates/mcp_detector_daemon/src/permission.rs](crates/mcp_detector_daemon/src/permission.rs).
- Transitions to `Running` once the probe succeeds; rebuilds the watcher with whatever clients [crates/mcp_detector_daemon/src/app.rs](crates/mcp_detector_daemon/src/app.rs) discovers.
- Re-enters `AwaitingFda` if the probe fails on a periodic recheck (i.e. the user revoked access).

### IPC

Newline-delimited JSON over a Unix domain socket (`0o600`). Default path: `~/Library/Application Support/Edison Watch/daemon.sock`. Wire types: [crates/mcp_detector_daemon/src/protocol.rs](crates/mcp_detector_daemon/src/protocol.rs).

Requests:

| Request | Reply |
|---|---|
| `{"op":"status"}` | `{"kind":"status","state":"awaiting_fda"\|"running"\|"starting","clients_watched":[...],"socket_path":"...","version":"..."}` |
| `{"op":"recheck_fda"}` | `{"kind":"ack"}` (forces an immediate FDA re-probe) |

Pushed unsolicited from the daemon:

```json
{"kind":"event","change":"added"|"removed","server_name":"...","client":"...","scope":"...","transport":"..."}
```

Quick smoke test:

```bash
cargo run --release -p mcp_detector_daemon -- \
    --socket /tmp/daemon.sock --log-dir /tmp/daemon-logs

echo '{"op":"status"}' | nc -U /tmp/daemon.sock -w 1
```

### CLI flags

```
--socket <path>          Unix socket to listen on
                         (default: ~/Library/Application Support/Edison Watch/daemon.sock)
--log-dir <path>         Directory for the daily-rolling log file
                         (default: ~/Library/Logs/Edison Watch)
```

### Logging

`tracing` with two layers:
- Daily-rolling file under `--log-dir` (14-day retention).
- Stdout when stdout is a TTY (i.e. when invoked from a terminal, not when supervised by launchd).

Filter via `RUST_LOG`, e.g. `RUST_LOG=debug`.

## Repository layout

```
.
├── Cargo.toml                # virtual workspace
├── crates/
│   ├── mcp_detector_lib/     # library (was the top-level crate before the workspace split)
│   └── mcp_detector_daemon/  # macOS daemon binary
└── README.md
```
