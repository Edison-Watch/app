use std::collections::BTreeMap;

use crate::types::{HttpKind, ServerConfig, Transport};

/// Heuristic transport detection that works across all current MCP client
/// schemas: anything with a URL-style field, or an explicit `type` of `http`,
/// `sse`, or `streamable-http`, is Remote; everything else is Stdio.
pub(crate) fn detect_transport(v: &serde_json::Value) -> Transport {
    let ty = v.get("type").and_then(|t| t.as_str());
    if v.get("url").is_some() || matches!(ty, Some("http") | Some("sse") | Some("streamable-http"))
    {
        Transport::Remote
    } else {
        Transport::Stdio
    }
}

/// Parse one server-config JSON object into a [`ServerConfig`].
///
/// Returns `Some(Stdio|Http)` when the entry has an extractable command or url,
/// and `None` otherwise (a malformed or non-actionable entry the caller can
/// either skip or record as [`ServerConfig::Opaque`]).
pub(crate) fn server_config_from_value(v: &serde_json::Value) -> Option<ServerConfig> {
    let obj = v.as_object()?;
    let ty = obj.get("type").and_then(|t| t.as_str());

    let url = obj.get("url").and_then(|u| u.as_str());
    let looks_http =
        url.is_some() || matches!(ty, Some("http") | Some("sse") | Some("streamable-http"));
    if looks_http {
        // `type` may claim http while the url is absent/malformed — then it is
        // not actionable, so fall through to `None`.
        let url = url?.to_string();
        let headers = string_map(obj.get("headers"));
        let kind = match ty {
            Some("sse") => HttpKind::Sse,
            Some("streamable-http") => HttpKind::StreamableHttp,
            _ => HttpKind::Http,
        };
        return Some(ServerConfig::Http { url, headers, kind });
    }

    if let Some(command) = obj.get("command").and_then(|c| c.as_str()) {
        let args = obj
            .get("args")
            .and_then(|a| a.as_array())
            .map(|arr| arr.iter().filter_map(|x| x.as_str().map(String::from)).collect())
            .unwrap_or_default();
        let env = string_map(obj.get("env"));
        return Some(ServerConfig::Stdio {
            command: command.to_string(),
            args,
            env,
        });
    }

    None
}

/// Collect a JSON object of string→string, dropping non-string values.
fn string_map(v: Option<&serde_json::Value>) -> BTreeMap<String, String> {
    v.and_then(|v| v.as_object())
        .map(|m| {
            m.iter()
                .filter_map(|(k, val)| val.as_str().map(|s| (k.clone(), s.to_string())))
                .collect()
        })
        .unwrap_or_default()
}
