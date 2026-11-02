//! `setup register`: register the Beeper connector with SealGate for this
//! device. Idempotent: an approved `beeper` server bound to this device is
//! left as it is.

use anyhow::Result;
use reqwest::StatusCode;
use serde_json::json;

use super::report::Reporter;
use super::{beeper, EXIT_NOT_YET, EXIT_OK};
use crate::cli::server::{approved_names, submit};
use crate::config::PersistedConfig;
use crate::http::{self, HttpError};

const NAME: &str = "beeper";

pub async fn run(rep: &Reporter) -> Result<i32> {
    let cfg = PersistedConfig::load()?;
    if cfg.usable_credential().is_none() {
        rep.warn("this computer is not signed in to SealGate yet");
        rep.action("run: sealgate-stdiod login");
        rep.result(json!({ "registered": false, "signed_in": false }));
        return Ok(EXIT_NOT_YET);
    }
    let client = http::from_config(&cfg)?;
    // A second account on the same backend may already own `beeper`; the
    // install scripts fall back to a name with the account's id in it.
    let alternate = cfg
        .authenticated_user_id
        .as_deref()
        .map(|uid| format!("{NAME}-{}", uid.chars().take(3).collect::<String>()));

    let existing = approved_names(&cfg, &client).await?;
    if let Some(name) = [Some(NAME.to_string()), alternate.clone()]
        .into_iter()
        .flatten()
        .find(|n| existing.contains(n))
    {
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

fn is_conflict<T>(outcome: &Result<T>) -> bool {
    outcome.as_ref().err().is_some_and(|e| {
        e.downcast_ref::<HttpError>().and_then(HttpError::status) == Some(StatusCode::CONFLICT)
    })
}
