//! `setup register`: register the Beeper connector with SealGate for this
//! device. Idempotent: an approved `beeper` server bound to this device is
//! left as it is.
//!
//! `setup wait-approved`: on a backend that queues the request for an admin,
//! open the dashboard and wait until it is approved.

use std::time::{Duration, Instant};

use anyhow::Result;
use reqwest::StatusCode;
use serde::Deserialize;
use serde_json::json;

use super::report::Reporter;
use super::{beeper, EXIT_NOT_YET, EXIT_OK};
use crate::cli::server::{approved_names, submit};
use crate::config::PersistedConfig;
use crate::http::{self, BackendClient, HttpError};

const NAME: &str = "beeper";
/// `wait-approved`: an admin declined the request.
const EXIT_DECLINED: i32 = 3;

pub async fn run(rep: &Reporter) -> Result<i32> {
    let cfg = PersistedConfig::load()?;
    if cfg.usable_credential().is_none() {
        rep.warn("this computer is not signed in to SealGate yet");
        rep.action("run: sealgate-stdiod login");
        rep.result(json!({ "registered": false, "signed_in": false }));
        return Ok(EXIT_NOT_YET);
    }
    let client = http::from_config(&cfg)?;
    let alternate = alternate_name(&cfg);

    if let Some(name) = approved_name(&cfg, &client).await? {
        rep.ok(&format!("'{name}' is already registered for this computer"));
        rep.result(json!({ "registered": true, "name": name }));
        return Ok(EXIT_OK);
    }

    let mut args = vec!["-y".to_string(), beeper::MCP_PKG.to_string()];
    if let Some(endpoint) = beeper::api_base()
        .await
        .and_then(|b| beeper::mcp_endpoint(&b))
    {
        rep.info(&format!(
            "Beeper answers on a non-default port; the connector uses {endpoint}"
        ));
        args.push(endpoint);
    }

    let mut name = NAME.to_string();
    let mut outcome = submit(
        &cfg,
        &client,
        &name,
        Some("Beeper".into()),
        "npx".into(),
        args.clone(),
    )
    .await;
    if is_conflict(&outcome) {
        if let Some(alt) = alternate {
            rep.warn(&format!(
                "'{name}' is already taken on this backend; trying '{alt}'"
            ));
            name = alt;
            outcome = submit(
                &cfg,
                &client,
                &name,
                Some("Beeper".into()),
                "npx".into(),
                args,
            )
            .await;
        }
    }
    if is_conflict(&outcome) {
        rep.ok(&format!(
            "a request for '{name}' already exists on the backend"
        ));
        rep.action("approve it in the SealGate dashboard if it is still pending");
        rep.result(json!({ "registered": false, "pending": true, "name": name }));
        return Ok(EXIT_NOT_YET);
    }
    let response = outcome?;
    if response.auto_approved {
        rep.ok(&format!(
            "registered '{name}'; no dashboard approval needed"
        ));
        rep.result(json!({ "registered": true, "name": name }));
        return Ok(EXIT_OK);
    }
    rep.ok(&format!("submitted '{name}' for approval"));
    rep.action(&format!(
        "an admin approves '{name}' in the SealGate dashboard: {}",
        cfg.backend_url.as_deref().unwrap_or("the dashboard")
    ));
    rep.result(json!({ "registered": false, "pending": true, "name": name }));
    Ok(EXIT_NOT_YET)
}

/// A second account on the same backend may already own `beeper`; the
/// install scripts fall back to a name with the account's id in it.
fn alternate_name(cfg: &PersistedConfig) -> Option<String> {
    cfg.authenticated_user_id
        .as_deref()
        .map(|uid| format!("{NAME}-{}", uid.chars().take(3).collect::<String>()))
}

/// The Beeper server's name, once it is approved for this device.
async fn approved_name(cfg: &PersistedConfig, client: &BackendClient) -> Result<Option<String>> {
    let existing = approved_names(cfg, client).await?;
    Ok([Some(NAME.to_string()), alternate_name(cfg)]
        .into_iter()
        .flatten()
        .find(|n| existing.contains(n)))
}

#[derive(Deserialize)]
struct RequestList {
    #[serde(default)]
    requests: Vec<RequestEntry>,
}

#[derive(Deserialize)]
struct RequestEntry {
    name: String,
    status: String,
}

/// Whether this device's Beeper request was declined. Asked best-effort: an
/// older backend, or an API key, may not answer.
async fn declined(cfg: &PersistedConfig, client: &BackendClient) -> bool {
    let Ok(list) = client
        .get_json::<RequestList>("/api/v1/client/mcp-requests")
        .await
    else {
        return false;
    };
    let names = [Some(NAME.to_string()), alternate_name(cfg)];
    // Newest first: only the latest request for the name counts.
    list.requests
        .iter()
        .find(|r| names.iter().flatten().any(|n| *n == r.name))
        .is_some_and(|r| r.status == "rejected")
}

/// Open the dashboard's request list, where an admin approves the request,
/// and wait for it.
pub async fn wait_approved(rep: &Reporter, timeout: Duration, open: bool) -> Result<i32> {
    let cfg = PersistedConfig::load()?;
    if cfg.usable_credential().is_none() {
        rep.warn("this computer is not signed in to SealGate yet");
        rep.result(json!({ "approved": false, "signed_in": false }));
        return Ok(EXIT_NOT_YET);
    }
    let client = http::from_config(&cfg)?;
    if let Some(name) = approved_name(&cfg, &client).await? {
        rep.ok(&format!("'{name}' is approved"));
        rep.result(json!({ "approved": true, "name": name }));
        return Ok(EXIT_OK);
    }
    let backend = cfg
        .backend_url
        .as_deref()
        .unwrap_or_default()
        .trim_end_matches('/');
    let url = format!("{backend}/dashboard/servers?view=requests");
    rep.action(&format!("approve Beeper in SealGate: {url}"));
    if open && crate::auth::validate_http_url(&url).is_ok() && webbrowser::open(&url).is_err() {
        rep.info("could not open a browser; open the link above");
    }
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        tokio::time::sleep(Duration::from_secs(3)).await;
        // A failed check (network blip) is retried on the next tick.
        if let Ok(Some(name)) = approved_name(&cfg, &client).await {
            rep.ok(&format!("'{name}' is approved"));
            rep.result(json!({ "approved": true, "name": name }));
            return Ok(EXIT_OK);
        }
        if declined(&cfg, &client).await {
            rep.warn("the Beeper request was declined in SealGate");
            rep.result(json!({ "approved": false, "declined": true }));
            return Ok(EXIT_DECLINED);
        }
    }
    rep.warn(&format!(
        "Beeper was not approved within {}s",
        timeout.as_secs()
    ));
    rep.result(json!({ "approved": false }));
    Ok(EXIT_NOT_YET)
}

fn is_conflict<T>(outcome: &Result<T>) -> bool {
    outcome.as_ref().err().is_some_and(|e| {
        e.downcast_ref::<HttpError>().and_then(HttpError::status) == Some(StatusCode::CONFLICT)
    })
}
