//! The [`Agent`] trait - the extension point for adding support for a new MCP
//! host application (Claude Code, VSCode, Cursor, ...).

use std::path::{Path, PathBuf};

use crate::error::Result;
use crate::types::{DiscoveredServer, EdisonInstall, HookInstall};
use crate::watch::WatchTargets;

/// A source of MCP server configuration that the daemon can observe.
///
/// Implementations are typically constructed by a `discover()` *constructor*
/// (distinct from the [`discover`](Agent::discover) trait method below) that
/// does the one-time work of locating their config files (potentially reading
/// other state, e.g. an editor's recent-workspaces database).
///
/// The [`Watcher`](crate::Watcher) requires `Send + Sync` so a list of agents
/// can be shared across threads via `Arc<dyn Agent>`.
pub trait Agent: Send + Sync {
    /// Stable, machine-readable identifier (e.g. `"vscode"`, `"claude_code"`).
    /// Surfaced in [`DiscoveredServer::client`] and used in log lines.
    fn name(&self) -> &'static str;

    /// Whether this agent appears to be installed / present on the machine.
    /// Used to report which agents exist (onboarding); an absent agent simply
    /// produces no servers.
    fn is_installed(&self) -> bool;

    /// Whether Edison can install the `edison-watch` entry and inject hooks for
    /// this agent. False for a host whose MCP servers live in the vendor's
    /// account (ChatGPT's Connectors), and for one whose config file has no
    /// shape that can carry a gateway URL (the Claude hosts take stdio only).
    ///
    /// Says nothing about reading: an unmanageable agent may still have a
    /// config Edison parses on every scan — see
    /// [`config_path`](Agent::config_path).
    ///
    /// Declared, not inferred from an empty
    /// [`edison_installs`](Agent::edison_installs): "no install target right
    /// now" and "never has one" are different facts. JetBrains reports no
    /// targets when no IDE is installed and is still perfectly manageable the
    /// moment one appears.
    ///
    /// An unmanageable agent is dropped from the enrolled selection, so nothing
    /// downstream tries to install into it or reports it as unconfigured. It is
    /// still discovered and still reported as installed - the app's job is to
    /// tell the user it is there and outside Edison's reach.
    fn is_manageable(&self) -> bool {
        true
    }

    /// Filesystem locations to watch for this agent's MCP config.
    ///
    /// A driver subscribes to each [`files`](WatchTargets::files) entry's
    /// **parent directory**, not the file itself, because most editors write
    /// configs via atomic rename (create temp + rename over target) and that
    /// pattern invalidates single-file watches. Returning a non-existent path
    /// is fine — the driver simply skips a parent dir that does not exist.
    fn watch_targets(&self) -> WatchTargets;

    /// Read every configured source and return all currently-defined servers,
    /// each carrying its raw [`config`](DiscoveredServer::config) and
    /// [`location`](DiscoveredServer::location).
    ///
    /// Called on startup (to seed the snapshot) and again on every debounced
    /// filesystem event. Implementations should be tolerant of missing or
    /// malformed files — log and return what was parseable rather than
    /// erroring out, so one broken config can't kill the detector.
    fn discover(&self) -> Result<Vec<DiscoveredServer>>;

    /// Where/how to install the `edison-watch` proxy entry for this agent, under
    /// the target user's `home`. Usually one target; JetBrains returns one per
    /// installed IDE version. Empty if the agent isn't an install target.
    ///
    /// `home` is threaded (not `dirs::home_dir()`) so a root daemon writes into
    /// the correct user's home. Install is separate from discovery/quarantine:
    /// only the UI-selected agents get the entry, whereas quarantine acts on all.
    fn edison_installs(&self, home: &Path) -> Vec<EdisonInstall> {
        let _ = home;
        Vec::new()
    }

    /// This agent's user-scope config file, for showing and reading back — a
    /// different question from [`edison_installs`](Agent::edison_installs),
    /// which says where the `edison-watch` entry may be *written*.
    ///
    /// The two coincide for most agents, hence the default. They come apart for
    /// a host Edison can read but not install into, where deriving one from the
    /// other would deny a file the daemon parses on every scan.
    fn config_path(&self, home: &Path) -> Option<PathBuf> {
        self.edison_installs(home).first().map(|i| i.path.clone())
    }

    /// How to inject Edison Watch hooks for this agent under `home`, or `None`
    /// if it has no hook surface. Injected into all installed agents (as the app
    /// does), not just the selected ones.
    fn hook_install(&self, home: &Path) -> Option<HookInstall> {
        let _ = home;
        None
    }

    /// Per-workspace `.vscode/tasks.json` files (under `home`) that get an
    /// "Edison Watch Registration" folder-open task. Only VSCode uses this.
    fn hook_workspace_targets(&self, home: &Path) -> Vec<PathBuf> {
        let _ = home;
        Vec::new()
    }
}
