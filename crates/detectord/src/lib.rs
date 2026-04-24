pub mod client;
pub mod clients;
pub mod diff;
pub mod types;
pub mod watcher;

pub use client::Client;
pub use types::{ChangeEvent, McpServer, Scope, Transport};
pub use watcher::Watcher;
