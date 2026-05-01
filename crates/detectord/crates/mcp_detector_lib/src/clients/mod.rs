//! Bundled [`Client`](crate::Client) implementations. Each one is gated
//! behind its own cargo feature so consumers can opt in only to the clients
//! they care about.

#[cfg(any(feature = "claude_code", feature = "vscode"))]
mod transport;

#[cfg(feature = "claude_code")]
pub mod claude_code;
#[cfg(feature = "vscode")]
pub mod vscode;

#[cfg(feature = "claude_code")]
pub use claude_code::ClaudeCode;
#[cfg(feature = "vscode")]
pub use vscode::VsCode;

#[cfg(any(feature = "claude_code", feature = "vscode"))]
pub(crate) use transport::detect_transport;
