//! Bundled [`Agent`](crate::Agent) implementations. Each one is gated behind
//! its own cargo feature so consumers can opt in only to the agents they care
//! about.

// Shared helpers, compiled whenever at least one agent is enabled.
#[cfg(any(
    feature = "claude_code",
    feature = "vscode",
    feature = "cursor",
    feature = "claude_desktop",
    feature = "claude_cowork",
    feature = "windsurf",
    feature = "zed",
    feature = "jetbrains",
    feature = "codex"
))]
mod common;
#[cfg(any(
    feature = "claude_code",
    feature = "vscode",
    feature = "cursor",
    feature = "claude_desktop",
    feature = "claude_cowork",
    feature = "windsurf",
    feature = "zed",
    feature = "jetbrains",
    feature = "codex"
))]
mod transport;
// SQLite state-DB reader, shared by the editors that use `state.vscdb`.
#[cfg(any(feature = "vscode", feature = "cursor"))]
mod statedb;

// ChatGPT is presence-detection only - server-side Connectors, no local config
// to parse - so it is deliberately absent from the `common`/`transport` gates
// above.
#[cfg(feature = "chatgpt")]
pub mod chatgpt;
#[cfg(feature = "claude_code")]
pub mod claude_code;
#[cfg(feature = "claude_cowork")]
pub mod claude_cowork;
#[cfg(feature = "claude_desktop")]
pub mod claude_desktop;
#[cfg(feature = "codex")]
pub mod codex;
#[cfg(feature = "cursor")]
pub mod cursor;
#[cfg(feature = "jetbrains")]
pub mod jetbrains;
#[cfg(feature = "vscode")]
pub mod vscode;
#[cfg(feature = "windsurf")]
pub mod windsurf;
#[cfg(feature = "zed")]
pub mod zed;

#[cfg(feature = "chatgpt")]
pub use chatgpt::ChatGpt;
#[cfg(feature = "claude_code")]
pub use claude_code::ClaudeCode;
#[cfg(feature = "claude_cowork")]
pub use claude_cowork::ClaudeCowork;
#[cfg(feature = "claude_desktop")]
pub use claude_desktop::ClaudeDesktop;
#[cfg(feature = "codex")]
pub use codex::Codex;
#[cfg(feature = "cursor")]
pub use cursor::Cursor;
#[cfg(feature = "jetbrains")]
pub use jetbrains::JetBrains;
#[cfg(feature = "vscode")]
pub use vscode::VsCode;
#[cfg(feature = "windsurf")]
pub use windsurf::Windsurf;
#[cfg(feature = "zed")]
pub use zed::Zed;

#[cfg(any(
    feature = "claude_code",
    feature = "vscode",
    feature = "cursor",
    feature = "claude_desktop",
    feature = "claude_cowork",
    feature = "windsurf",
    feature = "zed",
    feature = "jetbrains",
    feature = "codex"
))]
pub(crate) use transport::{detect_transport, server_config_from_value};
