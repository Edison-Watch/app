//! `sealgate-stdiod setup ...`: the Beeper side of setup, one step per command.
//!
//! Built for the Windows installer, which runs the steps in turn and shows a
//! page of its own while each one waits, and usable from the install scripts.
//! Signing in (`login`) and the logon task (`install`) are existing commands;
//! these are the steps that used to exist only in `scripts/install-beeper.*`.
//!
//! Every step prints readable lines, or with `--json` one JSON object per line
//! (`kind` = ok | info | warn | action | progress | result), and exits with a
//! code a caller can branch on: [`EXIT_OK`], [`EXIT_NOT_YET`] (it needs the
//! person, or Beeper, first), [`EXIT_UNSUPPORTED`], or 1 on an error.

mod approve;
mod beeper;
mod exe_arch;
mod install;
// Read only by the Windows installer path; its tests run everywhere.
#[cfg_attr(not(windows), allow(dead_code))]
mod publisher;
mod register;
mod report;
#[cfg(windows)]
mod signature;
pub mod stepio;

use std::time::Duration;

use clap::{Args, Subcommand};
use serde_json::json;

use report::Reporter;

/// The step is done.
pub const EXIT_OK: i32 = 0;
/// Not done yet, and nothing failed: it needs the person (sign in to Beeper,
/// click Allow, an admin's approval) and can be run again afterwards.
pub const EXIT_NOT_YET: i32 = 2;
/// The step does not apply on this platform or architecture.
pub const EXIT_UNSUPPORTED: i32 = 3;

#[derive(Debug, Subcommand)]
pub enum SetupCommand {
    /// Report whether Beeper Desktop is installed (and which build) and whether
    /// its local API answers. Exits 0 when it answers, 2 when not yet.
    Status(CommonArgs),
    /// Install Beeper Desktop for this machine's architecture, after checking
    /// the installer is signed by Beeper. Windows only.
    InstallBeeper(CommonArgs),
    /// Ask Beeper to let SealGate in, and wait for the person to click Allow.
    Approve(ApproveArgs),
    /// Register the Beeper connector with SealGate for this device.
    Register(CommonArgs),
    /// Whether this device is signed in to SealGate (to `--backend`, when
    /// given) with a credential the backend still accepts. Exits 0 when it
    /// is, 2 when `login` is needed.
    SignedIn(SignedInArgs),
    /// Open Beeper Desktop, so the person can sign in to it. Exits 2 when it
    /// is not installed.
    OpenBeeper(CommonArgs),
    /// Close and reopen Beeper Desktop, then wait for its local API. A request
    /// to let SealGate in made during Beeper's first-run setup never shows,
    /// and only a fresh start clears it. Exits 2 when Beeper is not installed
    /// or did not answer in time.
    RestartBeeper(RestartArgs),
    /// Wait for an admin to approve the Beeper server request, opening the
    /// dashboard first with `--open`. Exits 0 once approved, 3 when declined,
    /// 2 on timeout.
    WaitApproved(WaitApprovedArgs),
}

#[derive(Debug, Args)]
pub struct WaitApprovedArgs {
    #[command(flatten)]
    pub common: CommonArgs,
    /// Seconds to wait for the approval.
    #[arg(long, default_value_t = 600)]
    pub timeout: u64,
    /// Open the dashboard in the browser first.
    #[arg(long)]
    pub open: bool,
}

#[derive(Debug, Args)]
pub struct RestartArgs {
    #[command(flatten)]
    pub common: CommonArgs,
    /// Seconds to wait for Beeper to answer again.
    #[arg(long, default_value_t = 60)]
    pub timeout: u64,
}

#[derive(Debug, Args)]
pub struct SignedInArgs {
    #[command(flatten)]
    pub common: CommonArgs,
    /// The backend the device should be signed in to.
    #[arg(long)]
    pub backend: Option<String>,
}

#[derive(Debug, Args)]
pub struct CommonArgs {
    /// One JSON object per line instead of readable text.
    #[arg(long)]
    pub json: bool,
}

#[derive(Debug, Args)]
pub struct ApproveArgs {
    #[command(flatten)]
    pub common: CommonArgs,
    /// Seconds to wait for the person to click Allow.
    #[arg(long, default_value_t = 120)]
    pub timeout: u64,
}

/// Run one step and return its exit code.
pub async fn run(command: SetupCommand) -> i32 {
    let json = match &command {
        SetupCommand::Status(a)
        | SetupCommand::InstallBeeper(a)
        | SetupCommand::Register(a)
        | SetupCommand::OpenBeeper(a) => a.json,
        SetupCommand::Approve(a) => a.common.json,
        SetupCommand::SignedIn(a) => a.common.json,
        SetupCommand::RestartBeeper(a) => a.common.json,
        SetupCommand::WaitApproved(a) => a.common.json,
    };
    let rep = Reporter::new(json);
    let outcome = match command {
        SetupCommand::Status(_) => status(&rep).await,
        SetupCommand::InstallBeeper(_) => install::run(&rep).await,
        SetupCommand::Approve(a) => approve::run(&rep, Duration::from_secs(a.timeout)).await,
        SetupCommand::Register(_) => register::run(&rep).await,
        SetupCommand::SignedIn(a) => signed_in(&rep, a.backend.as_deref()).await,
        SetupCommand::OpenBeeper(_) => open_beeper(&rep),
        SetupCommand::RestartBeeper(a) => {
            restart_beeper(&rep, Duration::from_secs(a.timeout)).await
        }
        SetupCommand::WaitApproved(a) => {
            register::wait_approved(&rep, Duration::from_secs(a.timeout), a.open).await
        }
    };
    match outcome {
        Ok(code) => code,
        Err(e) => {
            rep.warn(&format!("{e:#}"));
            rep.result(json!({ "error": format!("{e:#}") }));
            1
        }
    }
}

async fn status(rep: &Reporter) -> anyhow::Result<i32> {
    let machine = beeper::machine_arch();
    let app = beeper::find_app();
    let app_arch = app.as_deref().and_then(exe_arch::read);
    let base = beeper::api_base().await;
    match &app {
        Some(path) => rep.ok(&format!(
            "Beeper Desktop: {}{}",
            path.display(),
            app_arch
                .map(|a| format!(" ({})", a.as_str()))
                .unwrap_or_default()
        )),
        None => rep.warn("Beeper Desktop is not installed"),
    }
    match &base {
        Some(url) => rep.ok(&format!("Beeper is answering at {url}")),
        None => {
            rep.warn("Beeper is not answering on this computer");
            rep.action("open Beeper, sign in, and turn on Settings > Developers > MCP");
        }
    }
    rep.result(json!({
        "machine_arch": machine.map(|a| a.as_str()),
        "app": app,
        "app_arch": app_arch.map(|a| a.as_str()),
        "api_base": base,
    }));
    Ok(if base.is_some() {
        EXIT_OK
    } else {
        EXIT_NOT_YET
    })
}

async fn signed_in(rep: &Reporter, backend: Option<&str>) -> anyhow::Result<i32> {
    let cfg = crate::config::PersistedConfig::load()?;
    if cfg.usable_credential().is_none() {
        rep.info("this computer is not signed in to SealGate");
        rep.result(json!({ "signed_in": false }));
        return Ok(EXIT_NOT_YET);
    }
    let saved = cfg.backend_url.clone().unwrap_or_default();
    if let Some(wanted) = backend {
        if !crate::config::same_backend(cfg.backend_url.as_deref(), wanted) {
            rep.info(&format!(
                "this computer is signed in to {saved}, not {wanted}"
            ));
            rep.result(json!({ "signed_in": false, "backend": saved }));
            return Ok(EXIT_NOT_YET);
        }
    }
    let client = crate::http::from_config(&cfg)?;
    match crate::cli::server::approved_names(&cfg, &client).await {
        Ok(_) => {
            let email = account_email(&client).await;
            match &email {
                Some(email) => rep.ok(&format!("this computer is signed in to {saved} as {email}")),
                None => rep.ok(&format!("this computer is signed in to {saved}")),
            }
            rep.result(json!({ "signed_in": true, "backend": saved, "email": email }));
            Ok(EXIT_OK)
        }
        Err(e)
            if e.downcast_ref::<crate::http::HttpError>()
                .is_some_and(crate::http::HttpError::is_auth_rejection) =>
        {
            rep.info("this computer's SealGate sign-in has expired or was revoked");
            rep.result(json!({ "signed_in": false, "backend": saved }));
            Ok(EXIT_NOT_YET)
        }
        Err(e) => Err(e),
    }
}

fn open_beeper(rep: &Reporter) -> anyhow::Result<i32> {
    let Some(app) = beeper::find_app() else {
        rep.warn("Beeper Desktop is not installed");
        return Ok(EXIT_NOT_YET);
    };
    beeper::launch(&app).map_err(|e| anyhow::anyhow!("could not open Beeper: {e}"))?;
    rep.ok(&format!("opened {}", app.display()));
    Ok(EXIT_OK)
}

async fn restart_beeper(rep: &Reporter, timeout: Duration) -> anyhow::Result<i32> {
    let Some(app) = beeper::find_app() else {
        rep.warn("Beeper Desktop is not installed");
        return Ok(EXIT_NOT_YET);
    };
    rep.info("restarting Beeper");
    // A Beeper that survived would answer the probe below and pass for the
    // restarted one, with SealGate's request still lost.
    if !beeper::quit(&app).await {
        rep.warn("Beeper did not close");
        rep.action("quit Beeper yourself (also from the tray or menu bar), then try again");
        rep.result(json!({ "api_base": null }));
        return Ok(EXIT_NOT_YET);
    }
    beeper::launch(&app).map_err(|e| anyhow::anyhow!("could not open Beeper: {e}"))?;
    let deadline = tokio::time::Instant::now() + timeout;
    loop {
        if let Some(url) = beeper::api_base().await {
            rep.ok(&format!("Beeper restarted and is answering at {url}"));
            rep.result(json!({ "api_base": url }));
            return Ok(EXIT_OK);
        }
        if tokio::time::Instant::now() >= deadline {
            rep.warn("Beeper restarted but is not answering yet");
            rep.action("check Beeper is signed in, with Settings > Developers > MCP on");
            rep.result(json!({ "api_base": null }));
            return Ok(EXIT_NOT_YET);
        }
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
}

#[derive(serde::Deserialize)]
struct Whoami {
    email: Option<String>,
}

/// The signed-in account's email, from `GET /api/v1/client/whoami`. None
/// when the backend predates that endpoint (404) or cannot say.
async fn account_email(client: &crate::http::BackendClient) -> Option<String> {
    client
        .get_json::<Whoami>("/api/v1/client/whoami")
        .await
        .ok()
        .and_then(|w| w.email)
}
