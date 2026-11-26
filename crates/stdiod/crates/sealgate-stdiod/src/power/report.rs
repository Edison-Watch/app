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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::tests::mock_server;

    fn target(backend: String) -> ReportTarget {
        ReportTarget {
            backend,
            credential: "test-key".into(),
            device_id: "dev-1".into(),
        }
    }

    #[tokio::test]
    async fn a_200_returns_the_dashboard_value_and_sends_both_fields() {
        let (base, bodies, handle) =
            mock_server(vec![(200, r#"{"device_settings":{"keep_awake":true}}"#)]).await;
        let desired = report(&target(base), LocalChoice::Off, Effective::Inactive)
            .await
            .unwrap();
        handle.await.unwrap();
        assert_eq!(desired, Some(true));
        let body: serde_json::Value = serde_json::from_str(&bodies.lock().unwrap()[0]).unwrap();
        assert_eq!(
            body,
            serde_json::json!({"keep_awake_local": "off", "keep_awake_effective": "inactive"})
        );
    }

    #[tokio::test]
    async fn a_404_or_405_is_not_retried() {
        for status in [404, 405] {
            let (base, _, handle) = mock_server(vec![(status, "{}")]).await;
            let result = report(&target(base), LocalChoice::Auto, Effective::Active).await;
            handle.await.unwrap();
            assert_eq!(result.unwrap(), None, "HTTP {status}");
        }
    }

    #[tokio::test]
    async fn other_failures_are_errors_to_retry() {
        let (base, _, handle) = mock_server(vec![(500, "{}")]).await;
        let result = report(&target(base), LocalChoice::Auto, Effective::Active).await;
        handle.await.unwrap();
        assert!(result.is_err());
    }
}
