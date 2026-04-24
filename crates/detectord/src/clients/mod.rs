mod transport;

pub mod claude_code;
pub mod vscode;

pub use claude_code::ClaudeCode;
pub use vscode::VsCode;

pub(crate) use transport::detect_transport;
