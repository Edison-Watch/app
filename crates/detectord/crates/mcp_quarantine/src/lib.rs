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
    ConfigStore, FileConfigStore, QuarantineRecord, backup_path, install_sealgate, sealgate_url,
    uninstall_sealgate,
};
pub use error::{Error, Result};
pub use hooks::{
    HookScripts, ensure_scripts, hooks_status, inject_hooks, inject_workspace_task, remove_hooks,
    remove_workspace_task, workspace_task_installed,
};
pub use reconcile::{Action as ReconcileAction, KnownOracle, Policy, is_sealgate_entry, plan};
pub use seen_store::{Action, SeenStore};
