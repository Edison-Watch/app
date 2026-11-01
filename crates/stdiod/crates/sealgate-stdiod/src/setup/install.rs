//! `setup install-beeper`: put the right Beeper Desktop on this machine.
//!
//! Windows only. Downloads Beeper's own build for this machine's architecture
//! rather than going through winget, whose package lists only an x64 installer
//! and so installs the emulated build on ARM. With no checksum to compare, the
//! installer runs only when its Authenticode signature is Beeper's
//! ([`super::publisher`]).

use anyhow::Result;
use serde_json::json;

use super::report::Reporter;
use super::{beeper, exe_arch, EXIT_NOT_YET, EXIT_OK, EXIT_UNSUPPORTED};

/// Beeper's download link for a Windows architecture; redirects to the newest
/// stable build.
#[cfg_attr(not(windows), allow(dead_code))]
const DOWNLOAD: &str =
    "https://api.beeper.com/desktop/download/windows/{arch}/stable/com.automattic.beeper.desktop";

pub async fn run(rep: &Reporter) -> Result<i32> {
    let Some(arch) = beeper::machine_arch() else {
        rep.warn("this machine's architecture is not one Beeper builds for");
        return Ok(EXIT_UNSUPPORTED);
    };
    if let Some(app) = beeper::find_app() {
        let built = exe_arch::read(&app);
        let data = json!({ "app": app, "app_arch": built.map(|a| a.as_str()) });
        if cfg!(windows) && built.is_some() && built != Some(arch) {
            rep.warn(&format!(
                "Beeper Desktop is the {} build, running under emulation on this {} PC",
                built.map_or("?", |a| a.as_str()),
                arch.as_str()
            ));
            rep.action(&format!(
                "uninstall it, then run this again to install the {} build",
                arch.as_str()
            ));
            rep.result(data);
            return Ok(EXIT_NOT_YET);
        }
        rep.ok(&format!(
            "Beeper Desktop is already installed: {}",
            app.display()
        ));
        rep.result(data);
        return Ok(EXIT_OK);
    }
    install(rep, arch).await
}

#[cfg(not(windows))]
async fn install(rep: &Reporter, _arch: exe_arch::Arch) -> Result<i32> {
    rep.warn("installing Beeper Desktop is automated on Windows only");
    rep.action("install it from https://www.beeper.com/download");
    Ok(EXIT_UNSUPPORTED)
}

#[cfg(windows)]
async fn install(rep: &Reporter, arch: exe_arch::Arch) -> Result<i32> {
    use anyhow::{anyhow, bail};
    use tokio::io::AsyncWriteExt;

    if !matches!(arch, exe_arch::Arch::X64 | exe_arch::Arch::Arm64) {
        rep.warn("Beeper publishes Windows builds for x64 and ARM64 only");
        return Ok(EXIT_UNSUPPORTED);
    }
    let url = DOWNLOAD.replace("{arch}", arch.as_str());
    rep.info(&format!(
        "downloading Beeper Desktop ({}) from {url}",
        arch.as_str()
    ));
    let setup = std::env::temp_dir().join(format!(
        "beeper-setup-{}-{}.exe",
        std::process::id(),
        chrono::Utc::now().timestamp_millis()
    ));
    // Removed on every way out, including an error.
    let _cleanup = RemoveOnDrop(setup.clone());

    let mut response = reqwest::get(&url).await?.error_for_status()?;
    let total = response.content_length();
    let mut file = tokio::fs::File::create(&setup).await?;
    let (mut written, mut shown) = (0u64, 0u8);
    while let Some(chunk) = response.chunk().await? {
        file.write_all(&chunk).await?;
        written += chunk.len() as u64;
        if let Some(total) = total.filter(|t| *t > 0) {
            let percent = (written * 100 / total).min(100) as u8;
            if percent >= shown + 5 {
                shown = percent;
                rep.progress(percent);
            }
        }
    }
    file.flush().await?;
    drop(file);

    let path = setup.clone();
    let checked = tokio::task::spawn_blocking(move || {
        super::signature::signer(&path).and_then(|s| super::publisher::check(&s))
    })
    .await?;
    if let Err(why) = checked {
        bail!("the downloaded installer is not signed by Beeper ({why}); not running it");
    }
    rep.ok("the installer is signed by Beeper");

    rep.info("running the Beeper installer (per-user, no admin)");
    let status = tokio::process::Command::new(&setup)
        .arg("/S")
        .status()
        .await
        .map_err(|e| anyhow!("could not start the Beeper installer: {e}"))?;
    if !status.success() {
        bail!("the Beeper installer failed ({status})");
    }
    let Some(app) = beeper::find_app() else {
        bail!("the Beeper installer finished but Beeper Desktop was not found afterwards");
    };
    // The signature says whose installer it is, not which build: the
    // installer is an x86 stub either way.
    let built = exe_arch::read(&app);
    if built != Some(arch) {
        bail!(
            "installed Beeper Desktop is the {} build, not {}",
            built.map_or("unknown", |a| a.as_str()),
            arch.as_str()
        );
    }
    rep.ok(&format!(
        "installed Beeper Desktop ({}): {}",
        arch.as_str(),
        app.display()
    ));
    rep.result(json!({ "app": app, "app_arch": arch.as_str() }));
    Ok(EXIT_OK)
}

#[cfg(windows)]
struct RemoveOnDrop(std::path::PathBuf);

#[cfg(windows)]
impl Drop for RemoveOnDrop {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}
