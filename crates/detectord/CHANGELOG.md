# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
once it has a tagged release.

## [Unreleased]

### Added

- `Client` trait (`name`, `watch_paths`, `parse_all`) — the extension point for
  adding support for a new MCP client.
- `Watcher::run` (blocking, callback-based) and `Watcher::spawn` (background
  thread + `mpsc::Receiver` + `WatcherHandle` that stops the worker on drop)
  as the two ways to drive the watcher.
- `ChangeEvent::Added` and `ChangeEvent::Removed`, produced by per-client
  snapshot diffing. In-place edits are intentionally not reported.
- Bundled clients, each behind its own cargo feature (both default-on):
  - `VsCode`: global `Code/User/mcp.json` plus per-workspace
    `.vscode/mcp.json`. Workspace enumeration goes through VSCode's
    `state.vscdb`, opened read-only with `immutable=1` so it's safe to read
    alongside a running editor.
  - `ClaudeCode`: `~/.claude.json` (top-level `mcpServers` and embedded
    `projects` map) plus per-project `.mcp.json`.
- `from_paths(...)` constructors on both bundled clients for tests, CI, and
  non-standard installs.
- `Error` enum (`Notify`, `Io`, `Sqlite`, `Json`, `Thread`) carrying file-path
  context on the file-bound variants. `anyhow` is no longer in the public API.
- crates.io metadata: description, MIT-OR-Apache-2.0 SPDX license, keywords,
  categories, MSRV `1.88`.
- Crate-level rustdoc, per-item documentation, and a runnable
  `examples/watch.rs` exercising the channel API.
- GitHub Actions CI: `cargo fmt --check`, `cargo clippy -D warnings`,
  `cargo test --lib` across all four feature permutations, doctests, and
  `cargo doc` with `RUSTDOCFLAGS=-D warnings`.
