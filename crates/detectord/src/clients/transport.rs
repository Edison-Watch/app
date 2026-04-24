use crate::types::Transport;

/// Heuristic transport detection that works across all current MCP client
/// schemas: anything with a URL-style field, or an explicit `type` of `http`
/// or `sse`, is Remote; everything else is Stdio.
pub(crate) fn detect_transport(v: &serde_json::Value) -> Transport {
    let ty = v.get("type").and_then(|t| t.as_str());
    if v.get("url").is_some() || matches!(ty, Some("http") | Some("sse") | Some("streamable-http"))
    {
        Transport::Remote
    } else {
        Transport::Stdio
    }
}
