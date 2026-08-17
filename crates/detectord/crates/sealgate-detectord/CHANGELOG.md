# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
once it has a tagged release.

## [Unreleased]

### Added

- VSCode `state.vscdb` `mcpToolCache` reader: catches the older
  static-contribution `extensionServers` shape. (Phase 4.1)
- VSCode extension-provider scanner: reads
  `~/.vscode/extensions/extensions.json` and each entry's `package.json`,
  emitting one `McpServer` per `contributes.mcpServerDefinitionProviders`
  declaration. This is how modern extensions (e.g. `upstash.context7-mcp`,
  `github.copilot-chat`, `ms-python.vscode-pylance`) register MCP servers
  via `vscode.lm.registerMcpServerDefinitionProvider`; the runtime
  registration is in-memory only and never reaches `state.vscdb`, so the
  static `package.json` scan is the only on-disk surface. New builder-style
  setter `VsCode::with_extensions_dir` lets consumers point this at an
  explicit path. `discover()` populates it from `~/.vscode/extensions` by
  default.
- JSONC-tolerant parsing for VSCode's `mcp.json`: line comments
  (`//`), block comments (`/* */`), and trailing commas are now
  accepted, matching VSCode's own parser behaviour. (Phase 4.2)

### Changed

- **Breaking:** `VsCode::from_paths` gained a `state_vscdb:
  Option<PathBuf>` second parameter so consumers can point the
  extension-server reader at an explicit SQLite path (or pass `None`
  to skip extension-server discovery).

- Renamed the crate from `mcp_detector` to `mcp_detector_lib` to make its
  library-first nature explicit on crates.io. The CLI binary is still
  installed as `mcp_detector`.

### Added

- `Client` trait (`name`, `watch_paths`, `parse_all`) - the extension point for
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
