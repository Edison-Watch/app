//! SealGate backend REST client.
//!
//! Thin async wrapper over the three endpoints the daemon needs, all
//! authenticated with a bearer API key (the same key the desktop app uses; the
//! daemon holds it in its root-owned enrollment store):
//!
//! - `GET  /api/v1/user/domain-config`   → the org policy flag
//! - `GET  /api/v1/servers/fingerprints` → the org's known fingerprints
//! - `POST /api/v1/mcp-requests`         → submit / register a server
//!
//! Response *parsing* is factored into pure functions ([`parse_policy`],
//! [`parse_fingerprints`]) so it is unit-testable without a live server. The
//! daemon layers fail-closed / last-known-good caching on top of this client;
//! this crate just does the calls.

use serde::Deserialize;

use sealgate_detectord::{HttpKind, ServerConfig};

const DOMAIN_CONFIG_PATH: &str = "/api/v1/user/domain-config";
const FINGERPRINTS_PATH: &str = "/api/v1/servers/fingerprints";
const MCP_REQUESTS_PATH: &str = "/api/v1/mcp-requests";
const PROFILE_PATH: &str = "/api/v1/user/profile";
const SECRET_KEY_REGISTER_PATH: &str = "/api/v1/user/secret-key/register";
const SECRET_KEY_VERIFY_PATH: &str = "/api/v1/user/secret-key/verify";
const SECRET_KEY_RESET_PATH: &str = "/api/v1/user/secret-key/reset";

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("http: {0}")]
    Http(#[from] reqwest::Error),
    #[error("backend returned {status} for {path}{}", detail.as_deref().map(|d| format!(": {d}")).unwrap_or_default())]
    Status {
        status: reqwest::StatusCode,
        path: String,
        /// The response body, when there was a readable one.
        ///
        /// Kept because the status alone is often ambiguous: two different 409s
        /// mean "a server with that name is already registered" and "you
        /// already have a pending request for it", and the UI has to tell the
        /// user which - the first calls for a rename, the second for waiting.
        detail: Option<String>,
    },
    #[error("decoding {path}: {message}")]
    Decode { path: String, message: String },
}

pub type Result<T> = std::result::Result<T, Error>;

/// The org policy flag governing quarantine.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Policy {
    pub quarantine: bool,
}

/// Lifecycle status of a known server in the caller's org.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KnownStatus {
    /// Approved (`TemplateMcpServerDefinitions`).
    Registered,
    /// Pending admin review (`mcp_server_requests`).
    Requested,
}

/// One `(name, fingerprint)` pair the backend already knows for this org.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KnownEntry {
    pub name: String,
    pub fingerprint: String,
    pub status: KnownStatus,
}

/// Parsed `GET /servers/fingerprints` response.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fingerprints {
    /// The org the backend computed this for. The daemon MUST verify this
    /// matches its cached org_id before applying (a mismatch means the key was
    /// re-scoped) — see design §5/§9.
    pub org_id: String,
    pub entries: Vec<KnownEntry>,
}

/// The caller's profile (`GET /user/profile`). `domain` is the email domain —
/// the human-readable org label — and `role` is user/admin/owner.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Profile {
    pub email: Option<String>,
    pub role: String,
    pub domain: String,
    pub org_id: Option<String>,
}

/// Result of verifying a secret key (unknown fields are ignored).
#[derive(Debug, Clone, Deserialize)]
pub struct VerifyResult {
    /// Whether the key's user part matches the registered hash.
    pub valid: bool,
    /// Whether the `.admin:` org part matches (null if none present).
    #[serde(default)]
    pub domain_valid: Option<bool>,
    /// Whether the registered key has expired.
    #[serde(default)]
    pub expired: bool,
    /// Days until expiry (negative if expired).
    #[serde(default)]
    pub days_remaining: Option<i64>,
}

/// Result of a destructive secret-key reset.
#[derive(Debug, Clone, Deserialize)]
pub struct ResetResult {
    #[serde(default)]
    pub success: bool,
    /// Number of encrypted personal values the backend deleted.
    #[serde(default)]
    pub deleted: u32,
}

/// A server to submit to the backend.
#[derive(Debug, Clone)]
pub struct SubmitRequest {
    pub name: String,
    pub config: ServerConfig,
    /// `true` = register (admin/owner, auto-approved); `false` = request review.
    pub register: bool,
    /// The machine the server was discovered on. The backend uses this to scope
    /// approval of a local (stdio) server to the specific host it lives on.
    pub hostname: String,
}

/// Async client bound to a base URL + bearer key.
#[derive(Debug, Clone)]
pub struct BackendClient {
    base_url: String,
    api_key: String,
    http: reqwest::Client,
}

impl BackendClient {
    pub fn new(base_url: impl Into<String>, api_key: impl Into<String>) -> Self {
        // A total-request timeout so a down/slow backend fails fast (fail-closed)
        // instead of hanging the enroll/refresh path indefinitely.
        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .unwrap_or_default();
        Self {
            base_url: base_url.into().trim_end_matches('/').to_string(),
            api_key: api_key.into(),
            http,
        }
    }

    /// Construct with a caller-supplied [`reqwest::Client`] (timeouts, proxy…).
    pub fn with_http(
        base_url: impl Into<String>,
        api_key: impl Into<String>,
        http: reqwest::Client,
    ) -> Self {
        Self {
            base_url: base_url.into().trim_end_matches('/').to_string(),
            api_key: api_key.into(),
            http,
        }
    }

    /// `GET /api/v1/user/domain-config`.
    pub async fn fetch_policy(&self) -> Result<Policy> {
        let body = self.get_text(DOMAIN_CONFIG_PATH).await?;
        parse_policy(&body).map_err(|message| Error::Decode {
            path: DOMAIN_CONFIG_PATH.into(),
            message,
        })
    }

    /// `GET /api/v1/user/profile`.
    pub async fn fetch_profile(&self) -> Result<Profile> {
        let body = self.get_text(PROFILE_PATH).await?;
        parse_profile(&body).map_err(|message| Error::Decode {
            path: PROFILE_PATH.into(),
            message,
        })
    }

    /// `GET /api/v1/servers/fingerprints`.
    pub async fn fetch_fingerprints(&self) -> Result<Fingerprints> {
        let body = self.get_text(FINGERPRINTS_PATH).await?;
        parse_fingerprints(&body).map_err(|message| Error::Decode {
            path: FINGERPRINTS_PATH.into(),
            message,
        })
    }

    /// `POST /api/v1/user/secret-key/register` with `{ user_key_hash }`.
    ///
    /// Registers the SHA-256 hash of the key's **user part** (the base64 without
    /// the `user:` prefix) so the MCP gateway can validate the
    /// `X-Edison-Secret-Key` header the daemon installs. Call whenever the key
    /// is set or rotated. The raw key never leaves the machine.
    pub async fn register_secret_key(&self, composite_key: &str) -> Result<()> {
        let body = serde_json::json!({ "user_key_hash": user_part_hash(composite_key) });
        let resp = self
            .http
            .post(format!("{}{}", self.base_url, SECRET_KEY_REGISTER_PATH))
            .bearer_auth(&self.api_key)
            .json(&body)
            .send()
            .await?;
        if !resp.status().is_success() {
            return Err(status_error(resp, SECRET_KEY_REGISTER_PATH).await);
        }
        Ok(())
    }

    /// `POST /api/v1/user/secret-key/verify` with `{ key }` (the raw composite;
    /// the backend hashes it). Non-destructive check that a key matches the
    /// registered hash — the "enter your existing key" path.
    pub async fn verify_secret_key(&self, composite_key: &str) -> Result<VerifyResult> {
        let resp = self
            .http
            .post(format!("{}{}", self.base_url, SECRET_KEY_VERIFY_PATH))
            .bearer_auth(&self.api_key)
            .json(&serde_json::json!({ "key": composite_key }))
            .send()
            .await?;
        if !resp.status().is_success() {
            return Err(status_error(resp, SECRET_KEY_VERIFY_PATH).await);
        }
        Ok(resp.json().await?)
    }

    /// `POST /api/v1/user/secret-key/reset` with `{ new_key_hash, confirm:true }`.
    ///
    /// **Destructive**: the backend deletes this user's personal encrypted
    /// values (those they supply themselves) and stores the new key's hash. The
    /// "I lost my key, start fresh" path. The raw key never leaves the machine.
    pub async fn reset_secret_key(&self, composite_key: &str) -> Result<ResetResult> {
        let body = serde_json::json!({
            "new_key_hash": user_part_hash(composite_key),
            "confirm": true,
        });
        let resp = self
            .http
            .post(format!("{}{}", self.base_url, SECRET_KEY_RESET_PATH))
            .bearer_auth(&self.api_key)
            .json(&body)
            .send()
            .await?;
        if !resp.status().is_success() {
            return Err(status_error(resp, SECRET_KEY_RESET_PATH).await);
        }
        Ok(resp.json().await?)
    }

    /// `POST /api/v1/mcp-requests`.
    pub async fn submit(&self, req: &SubmitRequest) -> Result<()> {
        let resp = self
            .http
            .post(format!("{}{}", self.base_url, MCP_REQUESTS_PATH))
            .bearer_auth(&self.api_key)
            .json(&submit_body(req))
            .send()
            .await?;
        if !resp.status().is_success() {
            return Err(status_error(resp, MCP_REQUESTS_PATH).await);
        }
        Ok(())
    }

    async fn get_text(&self, path: &str) -> Result<String> {
        let resp = self
            .http
            .get(format!("{}{}", self.base_url, path))
            .bearer_auth(&self.api_key)
            .header(reqwest::header::ACCEPT, "application/json")
            .send()
            .await?;
        if !resp.status().is_success() {
            return Err(status_error(resp, path).await);
        }
        Ok(resp.text().await?)
    }
}

/// Build a [`Error::Status`] from a non-success response, keeping its body.
///
/// Consumes the response, so callers must not have read it already.
async fn status_error(resp: reqwest::Response, path: &str) -> Error {
    let status = resp.status();
    let detail = resp.text().await.ok().and_then(|raw| extract_detail(&raw));
    Error::Status {
        status,
        path: path.into(),
        detail,
    }
}

/// The human-readable part of an error body: the `detail` field of the
/// backend's JSON error shape, else the raw text. Truncated - this ends up in
/// log lines and dialog copy, not in a report.
fn extract_detail(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let text = serde_json::from_str::<serde_json::Value>(trimmed)
        .ok()
        .and_then(|v| {
            v.get("detail").and_then(|d| {
                d.as_str()
                    .map(str::to_owned)
                    .or_else(|| Some(d.to_string()))
            })
        })
        .unwrap_or_else(|| trimmed.to_owned());
    let mut text = text.replace('\n', " ");
    if text.chars().count() > 300 {
        text = text.chars().take(300).collect::<String>() + "…";
    }
    Some(text)
}

/// SHA-256 hex of a composite key's **user part** — the base64 between `user:`
/// and any `.admin:<…>` org segment. Matches the client's
/// `hashSecretKey(userPart)`, so the daemon registers the same hash the backend
/// would already have on file for that key.
pub fn user_part_hash(composite_key: &str) -> String {
    use sha2::{Digest, Sha256};
    // `user:<userPart>[.admin:<domainPart>]` → userPart.
    let user_part = composite_key
        .split('.')
        .next()
        .unwrap_or(composite_key)
        .strip_prefix("user:")
        .unwrap_or(composite_key);
    let digest = Sha256::digest(user_part.as_bytes());
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

// ── pure parsing (unit-testable without HTTP) ───────────────────────────────

#[derive(Deserialize)]
struct DomainConfigDto {
    #[serde(default)]
    auto_quarantine_other_mcp_servers: bool,
}

/// Parse the domain-config body into a [`Policy`].
pub fn parse_policy(body: &str) -> std::result::Result<Policy, String> {
    let dto: DomainConfigDto = serde_json::from_str(body).map_err(|e| e.to_string())?;
    Ok(Policy {
        quarantine: dto.auto_quarantine_other_mcp_servers,
    })
}

#[derive(Deserialize)]
struct ProfileDto {
    #[serde(default)]
    email: Option<String>,
    #[serde(default)]
    role: String,
    #[serde(default)]
    domain: String,
    #[serde(default)]
    org_id: Option<String>,
}

/// Parse the profile body.
pub fn parse_profile(body: &str) -> std::result::Result<Profile, String> {
    let dto: ProfileDto = serde_json::from_str(body).map_err(|e| e.to_string())?;
    Ok(Profile {
        email: dto.email,
        role: dto.role,
        domain: dto.domain,
        org_id: dto.org_id,
    })
}

#[derive(Deserialize)]
struct FingerprintsDto {
    org_id: String,
    #[serde(default)]
    fingerprints: Vec<FingerprintDto>,
}

#[derive(Deserialize)]
struct FingerprintDto {
    name: String,
    fingerprint: String,
    #[serde(default)]
    status: Option<String>,
}

/// Parse the fingerprints body. Entries without a recognised status default to
/// `Registered` (matching the backend's documented default).
pub fn parse_fingerprints(body: &str) -> std::result::Result<Fingerprints, String> {
    let dto: FingerprintsDto = serde_json::from_str(body).map_err(|e| e.to_string())?;
    let entries = dto
        .fingerprints
        .into_iter()
        .map(|f| KnownEntry {
            name: f.name,
            fingerprint: f.fingerprint,
            status: match f.status.as_deref() {
                Some("requested") => KnownStatus::Requested,
                _ => KnownStatus::Registered,
            },
        })
        .collect();
    Ok(Fingerprints {
        org_id: dto.org_id,
        entries,
    })
}

/// Build the JSON body for `POST /mcp-requests`.
///
/// NOTE: the exact field set is aligned to the backend's create/request schema
/// (name + command/args/env or url/headers); confirm against `CreateServerRequest`
/// when wiring live.
fn submit_body(req: &SubmitRequest) -> serde_json::Value {
    use serde_json::json;
    let mut body = json!({
        "name": req.name,
        "status": if req.register { "registered" } else { "requested" },
        "hostname": req.hostname,
    });
    let obj = body.as_object_mut().expect("object literal");
    match &req.config {
        ServerConfig::Stdio { command, args, env } => {
            // Explicit transport type so the backend doesn't have to infer stdio
            // from the presence of `command`.
            obj.insert("type".into(), json!("stdio"));
            obj.insert("command".into(), json!(command));
            obj.insert("args".into(), json!(args));
            obj.insert("env".into(), json!(env));
        }
        ServerConfig::Http { url, headers, kind } => {
            let ty = match kind {
                HttpKind::Http => "http",
                HttpKind::Sse => "sse",
                HttpKind::StreamableHttp => "streamable-http",
            };
            obj.insert("type".into(), json!(ty));
            obj.insert("url".into(), json!(url));
            obj.insert("headers".into(), json!(headers));
        }
        ServerConfig::Opaque { .. } => {}
    }
    body
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    #[test]
    fn policy_true_and_false_and_missing() {
        assert!(
            parse_policy(r#"{"auto_quarantine_other_mcp_servers":true}"#)
                .unwrap()
                .quarantine
        );
        assert!(
            !parse_policy(r#"{"auto_quarantine_other_mcp_servers":false}"#)
                .unwrap()
                .quarantine
        );
        // Missing flag defaults to false (fail-closed caching is the daemon's job).
        assert!(!parse_policy(r#"{}"#).unwrap().quarantine);
    }

    #[test]
    fn policy_rejects_garbage() {
        assert!(parse_policy("not json").is_err());
    }

    #[test]
    fn fingerprints_parses_status_and_default() {
        let body = r#"{
            "org_id": "org-1",
            "fingerprints": [
                {"name":"a","fingerprint":"f1","status":"registered"},
                {"name":"b","fingerprint":"f2","status":"requested"},
                {"name":"c","fingerprint":"f3"}
            ]
        }"#;
        let fps = parse_fingerprints(body).unwrap();
        assert_eq!(fps.org_id, "org-1");
        assert_eq!(fps.entries.len(), 3);
        assert_eq!(fps.entries[0].status, KnownStatus::Registered);
        assert_eq!(fps.entries[1].status, KnownStatus::Requested);
        assert_eq!(fps.entries[2].status, KnownStatus::Registered); // default
    }

    #[test]
    fn fingerprints_empty_list() {
        let fps = parse_fingerprints(r#"{"org_id":"o"}"#).unwrap();
        assert!(fps.entries.is_empty());
    }

    #[test]
    fn submit_body_stdio_and_http() {
        let stdio = SubmitRequest {
            name: "s".into(),
            config: ServerConfig::Stdio {
                command: "npx".into(),
                args: vec!["-y".into()],
                env: BTreeMap::new(),
            },
            register: true,
            hostname: "dev-box".into(),
        };
        let b = submit_body(&stdio);
        assert_eq!(b["name"], "s");
        assert_eq!(b["status"], "registered");
        assert_eq!(b["type"], "stdio");
        assert_eq!(b["command"], "npx");
        assert_eq!(b["hostname"], "dev-box");

        let http = SubmitRequest {
            name: "h".into(),
            config: ServerConfig::Http {
                url: "https://x".into(),
                headers: BTreeMap::new(),
                kind: HttpKind::Sse,
            },
            register: false,
            hostname: "dev-box".into(),
        };
        let b = submit_body(&http);
        assert_eq!(b["status"], "requested");
        assert_eq!(b["type"], "sse");
        assert_eq!(b["url"], "https://x");
        assert_eq!(b["hostname"], "dev-box");
    }

    #[test]
    fn profile_parses_domain_and_role() {
        let body = r#"{"user_id":"u","email":"a@gatlingx.com","role":"owner","domain":"gatlingx.com","org_id":"o-1"}"#;
        let p = parse_profile(body).unwrap();
        assert_eq!(p.domain, "gatlingx.com");
        assert_eq!(p.role, "owner");
        assert_eq!(p.email.as_deref(), Some("a@gatlingx.com"));
    }

    #[test]
    fn base_url_trailing_slash_trimmed() {
        let c = BackendClient::new("https://api.example/", "k");
        assert_eq!(c.base_url, "https://api.example");
    }

    #[test]
    fn user_part_hash_strips_prefix_and_ignores_org_segment() {
        // sha256("abc") — the hash is of the user part, not the composite.
        const SHA256_ABC: &str = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
        assert_eq!(user_part_hash("user:abc"), SHA256_ABC);
        // The `.admin:<…>` org segment is not part of the user hash.
        assert_eq!(user_part_hash("user:abc.admin:xyz"), SHA256_ABC);
        // A bare key (no prefix) hashes as-is.
        assert_eq!(user_part_hash("abc"), SHA256_ABC);
    }

    #[test]
    fn extract_detail_prefers_the_json_detail_field() {
        // The backend's error shape. This string is what distinguishes a
        // "name taken" 409 from a "you already have a request pending" one.
        assert_eq!(
            extract_detail(r#"{"detail":"You already have a pending request for this server"}"#)
                .as_deref(),
            Some("You already have a pending request for this server")
        );
    }

    #[test]
    fn extract_detail_falls_back_to_raw_text_and_drops_empties() {
        assert_eq!(
            extract_detail("plain failure").as_deref(),
            Some("plain failure")
        );
        assert_eq!(extract_detail("   "), None);
        assert_eq!(extract_detail(""), None);
        // Non-string `detail` (e.g. FastAPI validation arrays) still yields text.
        assert!(extract_detail(r#"{"detail":[{"msg":"bad"}]}"#).is_some());
    }

    #[test]
    fn extract_detail_truncates_and_flattens() {
        let long = "x".repeat(500);
        let out = extract_detail(&format!("{long}\nsecond line")).unwrap();
        assert!(
            out.chars().count() <= 301,
            "got {} chars",
            out.chars().count()
        );
        assert!(
            !out.contains('\n'),
            "newlines would break single-line log/dialog copy"
        );
    }

    #[test]
    fn status_error_display_includes_the_detail() {
        let err = Error::Status {
            status: reqwest::StatusCode::CONFLICT,
            path: "/api/v1/mcp-requests".into(),
            detail: Some("You already have a pending request".into()),
        };
        assert!(
            err.to_string()
                .contains("You already have a pending request")
        );
        // …and stays readable when there was no body.
        let bare = Error::Status {
            status: reqwest::StatusCode::CONFLICT,
            path: "/api/v1/mcp-requests".into(),
            detail: None,
        };
        assert_eq!(
            bare.to_string(),
            "backend returned 409 Conflict for /api/v1/mcp-requests"
        );
    }
}
