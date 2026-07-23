//! Build the set of MCP host-app adapters to scan for the current user.

use std::sync::Arc;

use edison_detectord::Agent;
use edison_detectord::clients::{
    ClaudeCode, ClaudeCowork, ClaudeDesktop, Codex, Cursor, JetBrains, VsCode, Windsurf, Zed,
};

/// Discover the locally-available agents. An agent whose `discover()`
/// constructor fails is logged and skipped.
pub fn build() -> Vec<Arc<dyn Agent>> {
    let mut agents: Vec<Arc<dyn Agent>> = Vec::new();

    macro_rules! add {
        ($ctor:expr, $label:literal) => {
            match $ctor {
                Ok(a) => agents.push(Arc::new(a)),
                Err(e) => tracing::warn!(error = %e, concat!($label, " discover failed")),
            }
        };
    }

    add!(ClaudeCode::discover(), "claude_code");
    add!(ClaudeDesktop::discover(), "claude_desktop");
    add!(ClaudeCowork::discover(), "claude_cowork");
    add!(Cursor::discover(), "cursor");
    add!(VsCode::discover(), "vscode");
    add!(Windsurf::discover(), "windsurf");
    add!(Zed::discover(), "zed");
    add!(Codex::discover(), "codex");
    add!(JetBrains::intellij(), "intellij");
    add!(JetBrains::pycharm(), "pycharm");
    add!(JetBrains::webstorm(), "webstorm");

    agents
}

/// One reconcile-pass discovery across all agents, flattening per-agent errors
/// to a logged warning (one broken config can't stop the rest).
pub fn discover_all(agents: &[Arc<dyn Agent>]) -> Vec<edison_detectord::DiscoveredServer> {
    let mut out = Vec::new();
    for a in agents {
        match a.discover() {
            Ok(servers) => out.extend(servers),
            Err(e) => tracing::warn!(agent = a.name(), error = %e, "discover failed"),
        }
    }
    // Dedupe by *physical target* (agent + file + nested key + server key). The
    // same entry can be discovered from several sources — e.g. one workspace
    // opened under multiple Cursor workspace hashes enumerates the same
    // `.cursor/mcp.json` more than once — and acting on it twice would try to
    // remove an already-removed entry.
    let mut seen = std::collections::HashSet::new();
    out.retain(|s| {
        seen.insert((
            s.client,
            s.location.path.clone(),
            s.location.key_path.clone(),
            s.location.server_key.clone(),
        ))
    });
    out
}
