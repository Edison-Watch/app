//! Templatisation of secrets embedded in a server's launch config, so that a
//! freshly-discovered server with a real credential fingerprints the same as
//! the templatised form the backend stored (concrete secrets → `{...}`
//! placeholders).
//!
//! # Scope
//!
//! The [fingerprint](crate::fingerprint) consumes only `command`, `args`, and
//! `url` — never `env` or `headers` — so this module only templatises secrets
//! that appear *in those fields*.
//!
//! # Parity
//!
//! The detection rules mirror client_2's `secretDetection.ts` (see
//! `docs/architecture.md` §6). Matching *exactly* matters both ways: missing a
//! secret leaves a raw value where the backend has `{}`, and over-detecting
//! templatises a value the backend left literal — either diverges the
//! fingerprint. So the prefix set, the flag-name heuristic, and the non-secret
//! filters are all kept in lockstep with the client.

use crate::types::ServerConfig;

/// The placeholder a detected secret is replaced with. The fingerprint then
/// normalises every `{...}` to a bare `{}`, so the exact text here never affects
/// the hash — only *which tokens* we replace does.
const PLACEHOLDER: &str = "{SECRET}";

/// Known credential prefixes (kept identical to the client's set).
const SECRET_PREFIXES: &[&str] = &[
    "sk-",         // OpenAI
    "sk_live_",    // Stripe live
    "sk_test_",    // Stripe test
    "ghp_",        // GitHub personal
    "gho_",        // GitHub OAuth
    "ghs_",        // GitHub server
    "github_pat_", // GitHub fine-grained PAT
    "xoxb-",       // Slack bot
    "xoxp-",       // Slack user
    "xoxs-",       // Slack (legacy)
    "xapp-",       // Slack app-level
    "eyJ",         // JWT header `{"alg":…}` base64
];

/// Credential-bearing connection-string schemes.
const CONNECTION_STRING_PREFIXES: &[&str] = &["mongodb+srv://", "postgres://", "mysql://"];

/// Flag/param names that mark their value as a secret regardless of shape.
const SENSITIVE_KEY_WORDS: &[&str] = &[
    "key",
    "token",
    "secret",
    "password",
    "credential",
    "auth",
    "bearer",
];

/// Flags whose value is never a secret (prevents false positives on long paths
/// etc.).
const NON_SECRET_FLAGS: &[&str] = &[
    "-y",
    "--yes",
    "-n",
    "--no",
    "--verbose",
    "--debug",
    "--quiet",
    "-q",
    "--version",
    "-v",
    "--help",
    "-h",
    "--port",
    "-p",
    "--host",
    "--name",
    "--config",
    "-c",
    "--output",
    "-o",
    "--input",
    "-i",
    "--dir",
    "--cwd",
    "--format",
    "--level",
    "--log-level",
    "--timeout",
    "--retry",
    "--max-retries",
];

/// Return a copy of `config` with secrets in fingerprint-relevant fields
/// (`command`, `args`, `url`) replaced by [`PLACEHOLDER`]. `env`/`headers` are
/// passed through unchanged — they do not feed the fingerprint.
pub fn templatize_for_fingerprint(config: &ServerConfig) -> ServerConfig {
    match config {
        ServerConfig::Stdio { command, args, env } => ServerConfig::Stdio {
            command: templatize_token(command),
            args: templatize_args(args),
            env: env.clone(),
        },
        ServerConfig::Http { url, headers, kind } => ServerConfig::Http {
            url: templatize_url(url),
            headers: headers.clone(),
            kind: *kind,
        },
        ServerConfig::Opaque { removable, reason } => ServerConfig::Opaque {
            removable: *removable,
            reason: *reason,
        },
    }
}

/// Templatise a CLI argument list, tracking the preceding flag so that the value
/// after a sensitive-named flag (`--api-key VALUE`) is replaced even when it
/// isn't high-entropy.
fn templatize_args(args: &[String]) -> Vec<String> {
    let mut out = Vec::with_capacity(args.len());
    let mut prev_sensitive_flag = false;
    for arg in args {
        if let Some(eq) = arg.find('=') {
            // `--flag=value`: scan both the flag name and the value.
            let (flag, rest) = arg.split_at(eq);
            let value = &rest[1..];
            if !is_non_secret_flag(flag) && (is_sensitive_key_name(flag) || is_secret_value(value))
            {
                out.push(format!("{flag}={PLACEHOLDER}"));
            } else {
                out.push(arg.clone());
            }
            prev_sensitive_flag = false;
        } else if arg.starts_with('-') {
            // A flag; remember whether it's a sensitive one for the next value.
            out.push(arg.clone());
            prev_sensitive_flag = is_sensitive_key_name(arg) && !is_non_secret_flag(arg);
        } else if prev_sensitive_flag {
            // The value of a `--api-key VALUE`-style flag.
            out.push(PLACEHOLDER.to_string());
            prev_sensitive_flag = false;
        } else if let Some(masked) = templatize_auth_value(arg) {
            out.push(masked);
            prev_sensitive_flag = false;
        } else if is_secret_value(arg) {
            out.push(PLACEHOLDER.to_string());
            prev_sensitive_flag = false;
        } else {
            out.push(arg.clone());
            prev_sensitive_flag = false;
        }
    }
    out
}

/// Replace `s` wholesale if it looks like a secret, else return it unchanged.
fn templatize_token(s: &str) -> String {
    if is_secret_value(s) {
        PLACEHOLDER.to_string()
    } else {
        s.to_string()
    }
}

/// Templatise secrets inside a URL: userinfo (`user:pass@`) and any query
/// parameter whose name is sensitive or whose value looks like a secret.
fn templatize_url(url: &str) -> String {
    let mut out = url.to_string();

    // userinfo: scheme://<userinfo>@host
    if let Some(scheme_end) = out.find("://") {
        let after = scheme_end + 3;
        if let Some(at_rel) = out[after..].find('@') {
            let authority_end = out[after..]
                .find('/')
                .map(|s| after + s)
                .unwrap_or(out.len());
            let at = after + at_rel;
            if at < authority_end {
                out.replace_range(after..at, PLACEHOLDER);
            }
        }
    }

    // query parameter values
    if let Some(q) = out.find('?') {
        let (base, query) = out.split_at(q + 1);
        let rebuilt: Vec<String> = query
            .split('&')
            .map(|pair| match pair.split_once('=') {
                Some((k, v)) if is_sensitive_key_name(k) || is_secret_value(v) => {
                    format!("{k}={PLACEHOLDER}")
                }
                _ => pair.to_string(),
            })
            .collect();
        out = format!("{base}{}", rebuilt.join("&"));
    }

    out
}

/// A `Bearer <token>` / `Basic <token>` value → `Bearer {SECRET}`, keeping the
/// scheme prefix. Returns `None` if there's no such token.
fn templatize_auth_value(value: &str) -> Option<String> {
    let lower = value.to_lowercase();
    for scheme in ["bearer", "basic"] {
        if let Some(pos) = lower.find(scheme) {
            let after = pos + scheme.len();
            let rest = &value[after..];
            let trimmed = rest.trim_start();
            let ws = rest.len() - trimmed.len();
            if ws > 0
                && !trimmed.is_empty()
                && (has_known_secret_prefix(trimmed)
                    || looks_like_api_key(trimmed)
                    || trimmed.len() >= 8)
            {
                return Some(format!("{}{PLACEHOLDER}", &value[..after + ws]));
            }
        }
    }
    None
}

fn is_secret_value(v: &str) -> bool {
    has_known_secret_prefix(v) || looks_like_api_key(v)
}

fn has_known_secret_prefix(v: &str) -> bool {
    SECRET_PREFIXES.iter().any(|p| v.starts_with(p))
        || CONNECTION_STRING_PREFIXES.iter().any(|p| v.starts_with(p))
}

fn is_non_secret_flag(flag: &str) -> bool {
    NON_SECRET_FLAGS.contains(&flag)
}

fn is_sensitive_key_name(name: &str) -> bool {
    let lower = name.to_lowercase();
    SENSITIVE_KEY_WORDS.iter().any(|w| lower.contains(w))
}

/// High-entropy heuristic: ≥32 chars, ≥85% key-ish characters, and not an
/// obvious non-secret (URL/npm package/path).
fn looks_like_api_key(v: &str) -> bool {
    if v.len() < 32 || looks_like_non_secret(v) {
        return false;
    }
    let keyish = v
        .chars()
        .filter(|c| matches!(c, 'A'..='Z' | 'a'..='z' | '0'..='9' | '_' | '-' | '+' | '/' | '='))
        .count();
    keyish * 100 > v.len() * 85
}

/// Values that are structurally not secrets: URLs, npm package specifiers, and
/// filesystem paths.
fn looks_like_non_secret(v: &str) -> bool {
    if v.starts_with("http://") || v.starts_with("https://") {
        return true;
    }
    if is_npm_scoped(v) {
        return true;
    }
    if is_npm_bare(v) && !has_known_secret_prefix(v) {
        return true;
    }
    if v.starts_with('/') || v.starts_with("./") || v.starts_with('~') {
        return true;
    }
    is_windows_path(v)
}

/// `@scope/name` — starts with `@`, then `[\w-]+ / [\w.-]+`.
fn is_npm_scoped(v: &str) -> bool {
    let Some(rest) = v.strip_prefix('@') else {
        return false;
    };
    let Some((scope, name)) = rest.split_once('/') else {
        return false;
    };
    !scope.is_empty()
        && scope
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        && !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.' || c == '-')
}

/// `^[a-z][\w.-]*$` — a bare lowercase package/identifier.
fn is_npm_bare(v: &str) -> bool {
    let mut chars = v.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_lowercase())
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.' || c == '-')
}

/// `^[A-Z]:\` — a Windows drive path.
fn is_windows_path(v: &str) -> bool {
    let b = v.as_bytes();
    b.len() >= 3 && b[0].is_ascii_uppercase() && b[1] == b':' && b[2] == b'\\'
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    fn stdio(command: &str, args: &[&str]) -> ServerConfig {
        ServerConfig::Stdio {
            command: command.into(),
            args: args.iter().map(|s| s.to_string()).collect(),
            env: BTreeMap::new(),
        }
    }
    fn args_of(c: &ServerConfig) -> Vec<String> {
        let ServerConfig::Stdio { args, .. } = templatize_for_fingerprint(c) else {
            panic!()
        };
        args
    }

    #[test]
    fn templatizes_known_prefix_arg() {
        assert_eq!(
            args_of(&stdio(
                "server",
                &["--token", "sk-abc123def456ghi789jkl012mno345"]
            )),
            vec!["--token", "{SECRET}"]
        );
    }

    #[test]
    fn templatizes_flag_equals_value() {
        assert_eq!(
            args_of(&stdio(
                "server",
                &["--token=ghp_0123456789abcdefghijklmnopqrstuvwxyz"]
            )),
            vec!["--token={SECRET}"]
        );
    }

    #[test]
    fn stripe_and_slack_prefixes() {
        assert_eq!(
            args_of(&stdio("s", &["sk_live_0123456789abcdefXYZ"])),
            vec!["{SECRET}"]
        );
        assert_eq!(
            args_of(&stdio("s", &["xapp-1-A-2-longtokenvalue"])),
            vec!["{SECRET}"]
        );
    }

    #[test]
    fn connection_strings_are_secret() {
        assert_eq!(
            args_of(&stdio("s", &["mongodb+srv://u:p@cluster.example/db"])),
            vec!["{SECRET}"]
        );
    }

    #[test]
    fn sensitive_flag_name_templatizes_short_value() {
        // Value isn't high-entropy, but the flag name is sensitive.
        assert_eq!(
            args_of(&stdio("s", &["--api-key", "short"])),
            vec!["--api-key", "{SECRET}"]
        );
        assert_eq!(
            args_of(&stdio("s", &["--password=hunter2"])),
            vec!["--password={SECRET}"]
        );
    }

    #[test]
    fn non_secret_flags_and_values_left_alone() {
        // A long path is high-entropy-ish but must not be templatized.
        assert_eq!(
            args_of(&stdio(
                "npx",
                &[
                    "-y",
                    "ctx7-mcp",
                    "--port",
                    "8080",
                    "--config",
                    "/very/long/path/to/config/file.json"
                ]
            )),
            vec![
                "-y",
                "ctx7-mcp",
                "--port",
                "8080",
                "--config",
                "/very/long/path/to/config/file.json"
            ]
        );
    }

    #[test]
    fn npm_scoped_package_not_secret() {
        assert_eq!(
            args_of(&stdio(
                "npx",
                &["-y", "@modelcontextprotocol/server-everything-and-more"]
            )),
            vec!["-y", "@modelcontextprotocol/server-everything-and-more"]
        );
    }

    #[test]
    fn bearer_token_extraction() {
        assert_eq!(
            args_of(&stdio(
                "s",
                &["Authorization: Bearer sk-abc123def456ghi789jkl0"]
            )),
            vec!["Authorization: Bearer {SECRET}"]
        );
    }

    #[test]
    fn templatizes_url_query_and_userinfo() {
        let c = ServerConfig::Http {
            url:
                "https://user:supersecretpasswordvalue1234@h.example/mcp?key=sk-abc123def456ghi789"
                    .into(),
            headers: BTreeMap::new(),
            kind: crate::types::HttpKind::Http,
        };
        let ServerConfig::Http { url, .. } = templatize_for_fingerprint(&c) else {
            panic!()
        };
        assert_eq!(url, "https://{SECRET}@h.example/mcp?key={SECRET}");
    }

    #[test]
    fn url_query_sensitive_name() {
        let c = ServerConfig::Http {
            url: "https://h.example/mcp?token=short&page=2".into(),
            headers: BTreeMap::new(),
            kind: crate::types::HttpKind::Http,
        };
        let ServerConfig::Http { url, .. } = templatize_for_fingerprint(&c) else {
            panic!()
        };
        assert_eq!(url, "https://h.example/mcp?token={SECRET}&page=2");
    }
}
