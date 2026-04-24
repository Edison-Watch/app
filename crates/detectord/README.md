# mcp_detector

A background tool that watches the on-disk configs of MCP (Model Context Protocol) clients and reports changes as they happen.

## What it does

MCP servers are configured independently by each client (Claude Code, VSCode, Cursor, Claude Desktop, ...), often in several places per client: a global user-level file, per-project files, and sometimes application state stored in a SQLite database. `mcp_detector` unifies those sources into a single live stream of change events.

For the initial milestone it focuses on additions and removals: **when an MCP server appears in or disappears from any tracked config, print a line identifying it, its scope (global vs project-specific), and its transport (stdio vs remote).** In-place edits (same server name, different fields) are not reported yet.

## Design

- **Library + binary.** Core logic lives in `src/lib.rs`; `src/main.rs` is a thin CLI that wires the library to stdout.
- **Client abstraction.** Each supported client implements a common trait exposing (a) the set of config paths to watch and (b) a parser that normalises the on-disk shape into a shared `McpServer` type.
- **Event-driven watching.** Uses `notify-debouncer-full` against parent directories rather than individual files — most editors write configs via atomic rename, which breaks single-file watches.
- **Stateful diffing.** Maintains a last-known snapshot per config source. On each debounced event it reparses and emits structured events for anything new.

## Source shapes

Config sources across clients differ in several important ways:

- **Format.** Most clients use JSON (`mcp.json`, `.mcp.json`, etc.), but some store configuration or the metadata needed to *discover* project-level configs in a SQLite database (e.g. VSCode's `state.vscdb` workspace history).
- **Scope.** A single file can mix global and project-scoped entries (Claude Code's `~/.claude.json` embeds a `projects` map with per-project server lists).
- **Location.** Project-level configs live inside each project directory, so the detector has to know which projects to watch — either by enumerating them from the client's own state, or from a user-provided list.

The client abstraction hides all of this from the core watcher and diff logic.

## Supported clients

| Client          | Status           |
|-----------------|------------------|
| VSCode          | Planned (first)  |
| Claude Code     | Planned (second) |
| Cursor          | Later            |
| Claude Desktop  | Later            |

## Usage

_TBD — tool is in early development._

## Building

```bash
cargo build --release
```
