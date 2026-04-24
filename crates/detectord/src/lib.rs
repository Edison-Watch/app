pub mod client;
pub mod clients;
pub mod diff;
pub mod error;
pub mod types;
pub mod watcher;

pub use client::Client;
pub use error::{Error, Result};
pub use types::{ChangeEvent, McpServer, Scope, Transport};
pub use watcher::Watcher;
