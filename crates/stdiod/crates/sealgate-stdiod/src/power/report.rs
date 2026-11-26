//! `PUT /api/v1/client/device-state`: the keep-awake controller's report of
//! the local choice and the effective state (PROTOCOL.md T-78).

use std::time::Duration;

use serde::{Deserialize, Serialize};
use tracing::debug;

use super::controller::ReportTarget;
use super::{Effective, LocalChoice};

const REPORT_PATH: &str = "/api/v1/client/device-state";

#[derive(Serialize)]
struct ReportBody {
    keep_awake_local: LocalChoice,
    keep_awake_effective: Effective,
}

#[derive(Deserialize)]
struct ReportResponse {
    device_settings: sealgate_tunnel_protocol::DeviceSettings,
}

/// `PUT /api/v1/client/device-state`. Returns the dashboard value from the
/// response, `Ok(None)` when the backend does not know the endpoint or the
/// device (older backend, or no device row yet), and `Err` for failures
/// worth a retry.
pub(super) async fn report(
    target: &ReportTarget,
    local: LocalChoice,
    effective: Effective,
) -> anyhow::Result<Option<bool>> {
    let base = crate::config::normalize_backend_url(&target.backend)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent(crate::update::user_agent())
        .build()?;
    let response = client
        .put(format!("{base}{REPORT_PATH}"))
        .bearer_auth(&target.credential)
        .header("X-SealGate-Device-Id", &target.device_id)
        .json(&ReportBody {
            keep_awake_local: local,
            keep_awake_effective: effective,
        })
        .send()
        .await?;
    let status = response.status();
    if status == reqwest::StatusCode::NOT_FOUND || status == reqwest::StatusCode::METHOD_NOT_ALLOWED
    {
        debug!(%status, "keep-awake: the backend has no device state for this device");
        return Ok(None);
    }
    if !status.is_success() {
        anyhow::bail!("PUT {REPORT_PATH} returned HTTP {status}");
    }
    let body: ReportResponse = response.json().await?;
    Ok(Some(body.device_settings.keep_awake))
}
