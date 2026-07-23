//! The quarantine layer: the reconcile planner, persistent state, and config
//! mutation. **No privilege, no IPC, no network** — those are injected by the
//! daemon. Everything here is unit-testable in a tempdir.
//!
//! - [`reconcile`] — the pure, level-triggered planner (design §8).
//! - (later) `seen_store` — the root-owned "known" oracle.
//! - (later) `configstore` — kind-dispatched writers (quarantine/restore).

pub mod configstore;
pub mod error;
pub mod hooks;
pub mod reconcile;
pub mod seen_store;
mod statedb;

pub use configstore::{
    ConfigStore, FileConfigStore, QuarantineRecord, edison_url, install_edison, uninstall_edison,
};
pub use error::{Error, Result};
pub use hooks::{
    HookScripts, ensure_scripts, inject_hooks, inject_workspace_task, remove_hooks,
    remove_workspace_task,
};
pub use reconcile::{Action as ReconcileAction, KnownOracle, Policy, is_edison_entry, plan};
pub use seen_store::{Action, SeenStore};
