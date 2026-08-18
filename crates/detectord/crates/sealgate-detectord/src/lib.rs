//! Watches MCP (Model Context Protocol) client configs and reports added or
//! removed servers as they happen.
//!
//! MCP servers are configured independently by each client (Claude Code,
//! VSCode, Cursor, Claude Desktop, ...), often across several files per
//! client - a global user-level file, per-project files, and sometimes
//! application state stored in a SQLite database. This crate unifies those
//! sources behind a single [`Agent`] trait, watches them via an event-driven
//! filesystem watcher, and emits a [`ChangeEvent`] whenever a server appears
//! or disappears.
//!
//! # Quick start
//!
//! Build a list of clients, hand them to a [`Watcher`], and either run it
//! in-thread or spawn it on a worker:
//!
//! ```no_run
//! use std::sync::Arc;
//! use sealgate_detectord::{Agent, Result, Watcher, clients::{ClaudeCode, VsCode}};
//!
//! fn main() -> Result<()> {
//!     let clients: Vec<Arc<dyn Agent>> = vec![
//!         Arc::new(VsCode::discover()?),
//!         Arc::new(ClaudeCode::discover()?),
//!     ];
//!     Watcher::new(clients).run(|ev| println!("{ev}"))?;
//!     Ok(())
//! }
//! ```
//!
//! For library use that needs to drive other work alongside the watcher,
//! prefer [`Watcher::spawn`], which returns a [`std::sync::mpsc::Receiver`]
//! and a [`WatcherHandle`] that stops the worker on drop.
//!
//! # Cargo features
//!
//! Each client lives behind its own feature; both are on by default.
//!
//! - `vscode` - enables [`clients::VsCode`]; pulls in `rusqlite` (bundled).
//! - `claude_code` - enables [`clients::ClaudeCode`].
//!
//! # Event semantics
//!
//! - The initial snapshot taken on startup is **silent** - no `Added` events
//!   are emitted for servers that already exist when the watcher starts.
//! - Subsequent additions emit [`ChangeEvent::Added`].
//! - Subsequent removals emit [`ChangeEvent::Removed`].
//! - In-place edits (same name, different command/url/args) are not reported.
//!
//! # Adding a new agent
//!
//! Implement [`Agent`] for a new struct, gate it behind a cargo feature, and
//! register an instance with [`Watcher::new`]. The trait surface is just
//! four methods: [`Agent::name`], [`Agent::is_installed`],
//! [`Agent::watch_targets`], and [`Agent::discover`]. The watcher takes care of
//! debounced filesystem
//! events, snapshot diffing, and event delivery.

pub mod agent;
pub mod clients;
pub(crate) mod diff;
pub mod error;
pub mod fingerprint;
pub mod secret_detection;
pub mod tcc;
pub mod types;
pub mod watch;
pub mod watcher;

pub use agent::Agent;
pub use error::{Error, Result};
pub use fingerprint::fingerprint;
pub use tcc::{has_full_disk_access, watch_needs_full_disk_access};
pub use types::{
    ChangeEvent, ConfigLocation, DiscoveredServer, HookBinding, HookInstall, HookScriptKind,
    HookStyle, HttpKind, LocationExtra, OpaqueReason, Scope, SealGateInstall, SealGateStyle,
    ServerConfig, SourceKind, StateShape, Transport,
};
pub use watch::{WatchDir, WatchTargets};
pub use watcher::{Watcher, WatcherHandle};
