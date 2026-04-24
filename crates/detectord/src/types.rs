use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct McpServer {
    pub client: &'static str,
    pub name: String,
    pub transport: Transport,
    pub scope: Scope,
    pub source: PathBuf,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Transport {
    Stdio,
    Remote,
}

impl std::fmt::Display for Transport {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Transport::Stdio => write!(f, "stdio"),
            Transport::Remote => write!(f, "remote"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum Scope {
    Global,
    Project(PathBuf),
}

impl std::fmt::Display for Scope {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Scope::Global => write!(f, "scope=global"),
            Scope::Project(p) => write!(f, "scope=project project_dir={}", p.display()),
        }
    }
}

#[derive(Debug, Clone)]
pub enum ChangeEvent {
    Added(McpServer),
    Removed(McpServer),
}

impl std::fmt::Display for ChangeEvent {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let (tag, s) = match self {
            ChangeEvent::Added(s) => ("ADDED", s),
            ChangeEvent::Removed(s) => ("REMOVED", s),
        };
        write!(
            f,
            "{} client={} name={} {} transport={} source={}",
            tag,
            s.client,
            s.name,
            s.scope,
            s.transport,
            s.source.display(),
        )
    }
}
