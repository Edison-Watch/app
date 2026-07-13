//! Stable server fingerprint — the identity used to ask "is this server already
//! known to the backend?".
//!
//! # Frozen cross-implementation contract
//!
//! This is a **three-way contract**: the Python backend
//! (`servers_fingerprints.py::compute_server_fingerprint`) and the TS client
//! (`seenServersStore.ts::getServerFingerprint`) compute it independently and
//! it must stay byte-for-byte identical, or the daemon fails to recognise
//! already-known servers. Do not "improve" the algorithm here in isolation —
//! see `docs/architecture.md` §6.
//!
//! ```text
//! identifier = "{name}:{command}:{args joined by ' '}"   (stdio, non-empty command)
//!            | "{name}:{url}"                             (http,  non-empty url)
//!            | <unfingerprint-able → None>
//! every {placeholder} is normalised to a bare {} before hashing
//! fingerprint = first 16 hex chars of sha256(identifier)
//! ```

use sha2::{Digest, Sha256};

use crate::secret_detection::templatize_for_fingerprint;
use crate::types::ServerConfig;

/// Compute the 16-hex-char fingerprint for a server, or `None` when it cannot
/// be fingerprinted (stdio with an empty command, or http with an empty url).
/// Secrets in the fingerprinted fields are templatised first so the result is
/// stable across rotated credentials and matches the backend's stored form.
pub fn fingerprint(name: &str, config: &ServerConfig) -> Option<String> {
    let templatized = templatize_for_fingerprint(config);
    let identifier = match &templatized {
        ServerConfig::Stdio { command, args, .. } => {
            if command.is_empty() {
                return None;
            }
            let command = normalize_placeholders(command);
            let args = args
                .iter()
                .map(|a| normalize_placeholders(a))
                .collect::<Vec<_>>()
                .join(" ");
            format!("{name}:{command}:{args}")
        }
        ServerConfig::Http { url, .. } => {
            if url.is_empty() {
                return None;
            }
            format!("{name}:{}", normalize_placeholders(url))
        }
        ServerConfig::Opaque { .. } => return None,
    };
    Some(hash16(&identifier))
}

/// `sha256(s)` hex-encoded, truncated to the first 16 chars (= first 8 bytes).
fn hash16(s: &str) -> String {
    let digest = Sha256::digest(s.as_bytes());
    let mut out = String::with_capacity(16);
    for byte in &digest[..8] {
        use std::fmt::Write;
        let _ = write!(out, "{byte:02x}");
    }
    out
}

/// Collapse every `{...}` template placeholder (no nested braces) to a bare
/// `{}`, matching the JS/Python `/\{[^{}]*\}/g → "{}"` normalisation so that a
/// placeholder's variable name never affects the fingerprint.
fn normalize_placeholders(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'{' {
            // Find the next '}' and confirm no '{' lies between (the regex
            // class is [^{}]*), i.e. a well-formed innermost placeholder.
            if let Some(rel) = s[i + 1..].find('}') {
                let inner = &s[i + 1..i + 1 + rel];
                if !inner.contains('{') {
                    out.push_str("{}");
                    i += 1 + rel + 1;
                    continue;
                }
            }
        }
        let ch = s[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::HttpKind;
    use std::collections::BTreeMap;

    fn stdio(command: &str, args: &[&str]) -> ServerConfig {
        ServerConfig::Stdio {
            command: command.into(),
            args: args.iter().map(|s| s.to_string()).collect(),
            env: BTreeMap::new(),
        }
    }

    fn http(url: &str) -> ServerConfig {
        ServerConfig::Http {
            url: url.into(),
            headers: BTreeMap::new(),
            kind: HttpKind::Http,
        }
    }

    // Golden vectors computed directly from the canonical algorithm
    // (sha256(identifier)[:16]). These pin the frozen contract; if one of
    // these changes, the daemon has silently diverged from backend + client.

    #[test]
    fn golden_stdio_basic() {
        assert_eq!(
            fingerprint("ctx7", &stdio("npx", &["-y", "ctx7-mcp"])).unwrap(),
            "3b02d109f5583486"
        );
    }

    #[test]
    fn golden_http_basic() {
        assert_eq!(
            fingerprint("remote", &http("https://x.example/mcp")).unwrap(),
            "9306a4c918d7d372"
        );
    }

    #[test]
    fn golden_stdio_templatized_secret() {
        // The sk- token is templatised → "{SECRET}" → normalised → "{}",
        // yielding identifier "srv:server:--token {}".
        assert_eq!(
            fingerprint(
                "srv",
                &stdio("server", &["--token", "sk-abc123def456ghi789jkl012mno345"])
            )
            .unwrap(),
            "d29e144857eed9a4"
        );
    }

    #[test]
    fn golden_stdio_no_args() {
        assert_eq!(
            fingerprint("bare", &stdio("node", &[])).unwrap(),
            "7de4c89d590bc157"
        );
    }

    #[test]
    fn placeholder_name_does_not_affect_fingerprint() {
        // Two different placeholder names must collapse to the same fingerprint.
        let a = fingerprint("s", &stdio("c", &["--k", "{TOKEN}"]));
        let b = fingerprint("s", &stdio("c", &["--k", "{SOME_OTHER_NAME}"]));
        assert_eq!(a, b);
    }

    #[test]
    fn empty_command_is_unfingerprintable() {
        assert_eq!(fingerprint("x", &stdio("", &["a"])), None);
    }

    #[test]
    fn empty_url_is_unfingerprintable() {
        assert_eq!(fingerprint("x", &http("")), None);
    }

    #[test]
    fn normalize_handles_multiple_and_adjacent_placeholders() {
        assert_eq!(normalize_placeholders("a{X}b{YY}c"), "a{}b{}c");
        assert_eq!(normalize_placeholders("{A}{B}"), "{}{}");
        assert_eq!(normalize_placeholders("no braces"), "no braces");
    }
}
