//! Finding Beeper Desktop on this machine: where it is installed, which build,
//! and whether its local API answers. Same probes as `scripts/install-beeper.*`.

use std::path::{Path, PathBuf};
use std::time::Duration;

use super::exe_arch::Arch;

/// Beeper's stdio-to-HTTP OAuth proxy, fetched by npx. It is what the daemon
/// spawns for the `beeper` server, so the approval it caches is the one the
/// daemon's child reuses.
pub const MCP_PKG: &str = "@beeper/mcp-remote";

/// Where the Beeper Desktop API answers by default, and the range it may move
/// to when the port is taken.
const DEFAULT_BASE: &str = "http://127.0.0.1:23373";
const PORTS: std::ops::RangeInclusive<u16> = 23373..=23378;
const HOSTS: [&str; 3] = ["127.0.0.1", "localhost", "[::1]"];
const WELL_KNOWN: &str = "/.well-known/oauth-authorization-server";

/// This machine's native architecture: on Windows the OS's, not this process's,
/// so an x64 daemon under emulation on an ARM PC still answers arm64.
pub fn machine_arch() -> Option<Arch> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::System::Threading::{GetCurrentProcess, IsWow64Process2};
        let (mut process, mut native) = (0u16, 0u16);
        // SAFETY: both out-params are valid u16s; the pseudo-handle needs no close.
        let ok = unsafe { IsWow64Process2(GetCurrentProcess(), &mut process, &mut native) };
        if ok != 0 {
            return match native {
                0x8664 => Some(Arch::X64),
                0xAA64 => Some(Arch::Arm64),
                0x014C => Some(Arch::X86),
                _ => None,
            };
        }
    }
    match std::env::consts::ARCH {
        "x86_64" => Some(Arch::X64),
        "aarch64" => Some(Arch::Arm64),
        "x86" => Some(Arch::X86),
        _ => None,
    }
}

/// The installed Beeper Desktop app, or None.
///
/// Windows: the per-user installer records itself under the Uninstall keys
/// with `DisplayIcon` naming the exe; `%LOCALAPPDATA%\Programs\*beeper*` is the
/// fallback. macOS: the `.app` in `/Applications` or `~/Applications`.
pub fn find_app() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        windows_app()
    }
    #[cfg(target_os = "macos")]
    {
        let mut candidates = vec![PathBuf::from("/Applications/Beeper Desktop.app")];
        if let Some(home) = dirs::home_dir() {
            candidates.push(home.join("Applications/Beeper Desktop.app"));
        }
        candidates.into_iter().find(|p| p.exists())
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        None
    }
}

#[cfg(windows)]
fn windows_app() -> Option<PathBuf> {
    use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
    use winreg::RegKey;

    const UNINSTALL: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall";
    const UNINSTALL_32: &str = r"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall";
    let roots = [
        (HKEY_CURRENT_USER, UNINSTALL),
        (HKEY_LOCAL_MACHINE, UNINSTALL),
        (HKEY_LOCAL_MACHINE, UNINSTALL_32),
    ];
    for (hive, path) in roots {
        let Ok(root) = RegKey::predef(hive).open_subkey(path) else {
            continue;
        };
        for name in root.enum_keys().flatten() {
            let Ok(key) = root.open_subkey(&name) else {
                continue;
            };
            let display: String = key.get_value("DisplayName").unwrap_or_default();
            if !display.starts_with("Beeper") {
                continue;
            }
            let icon: String = key.get_value("DisplayIcon").unwrap_or_default();
            if let Some(exe) = exe_from_icon(&icon) {
                return Some(exe);
            }
            let location: String = key.get_value("InstallLocation").unwrap_or_default();
            if let Some(exe) = beeper_exe_in(&PathBuf::from(location)) {
                return Some(exe);
            }
        }
    }
    let programs = dirs::data_local_dir()?.join("Programs");
    std::fs::read_dir(programs)
        .ok()?
        .flatten()
        .filter(|e| {
            e.file_name()
                .to_string_lossy()
                .to_lowercase()
                .contains("beeper")
        })
        .find_map(|e| beeper_exe_in(&e.path()))
}

/// The exe a `DisplayIcon` value names: `"C:\path\Beeper.exe",0` -> the path.
#[cfg_attr(not(windows), allow(dead_code))]
fn exe_from_icon(icon: &str) -> Option<PathBuf> {
    let trimmed = icon.trim();
    let without_index = match trimmed.rsplit_once(',') {
        Some((path, index)) if index.trim().trim_start_matches('-').parse::<i32>().is_ok() => path,
        _ => trimmed,
    };
    let path = PathBuf::from(without_index.trim().trim_matches('"'));
    let is_exe = path
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("exe"));
    (is_exe && path.exists()).then_some(path)
}

#[cfg(windows)]
fn beeper_exe_in(dir: &std::path::Path) -> Option<PathBuf> {
    std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .find(|p| {
            let name = p
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            name.starts_with("Beeper")
                && name.to_lowercase().ends_with(".exe")
                && !name.contains("Uninstall")
        })
}

/// Close Beeper Desktop and wait until it is gone: a new start while the old
/// one is still exiting is refused by Beeper's single-instance lock.
pub async fn quit(app: &Path) {
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let Some(name) = app.file_name().map(|n| n.to_string_lossy().to_string()) else {
            return;
        };
        let _ = tokio::process::Command::new("taskkill")
            .args(["/F", "/T", "/IM", &name])
            .creation_flags(CREATE_NO_WINDOW)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .await;
        let filter = format!("IMAGENAME eq {name}");
        for _ in 0..20 {
            let listed = tokio::process::Command::new("tasklist")
                .args(["/FI", &filter, "/NH", "/FO", "CSV"])
                .creation_flags(CREATE_NO_WINDOW)
                .output()
                .await;
            let running = listed
                .map(|o| String::from_utf8_lossy(&o.stdout).contains(&format!("\"{name}\"")))
                .unwrap_or(false);
            if !running {
                return;
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
    }
    #[cfg(target_os = "macos")]
    {
        let Some(name) = app.file_stem().map(|n| n.to_string_lossy().to_string()) else {
            return;
        };
        let _ = tokio::process::Command::new("osascript")
            .args(["-e", &format!("quit app \"{name}\"")])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .await;
        let main = format!("{}/Contents/MacOS/", app.display());
        for i in 0..20 {
            let running = tokio::process::Command::new("pgrep")
                .args(["-f", &main])
                .stdout(std::process::Stdio::null())
                .status()
                .await
                .is_ok_and(|s| s.success());
            if !running {
                return;
            }
            // Asked politely for 5s; then it is stuck (on a dialog, say).
            if i == 10 {
                let _ = tokio::process::Command::new("pkill")
                    .args(["-f", &main])
                    .status()
                    .await;
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    let _ = app;
}

/// Start Beeper Desktop without waiting for it.
pub fn launch(app: &Path) -> std::io::Result<()> {
    #[cfg(target_os = "macos")]
    let spawned = std::process::Command::new("open").arg(app).spawn();
    #[cfg(not(target_os = "macos"))]
    let spawned = std::process::Command::new(app).spawn();
    spawned.map(|_| ())
}

/// The base URL the Beeper Desktop API answers on, or None. `BEEPER_API_URL`
/// overrides the probe, loopback only: the API is local by design.
pub async fn api_base() -> Option<String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(1500))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .ok()?;
    let mut candidates: Vec<String> = Vec::new();
    if let Ok(url) = std::env::var("BEEPER_API_URL") {
        if is_loopback(&url) {
            candidates.push(url.trim_end_matches('/').to_string());
        }
    }
    for host in HOSTS {
        for port in PORTS {
            candidates.push(format!("http://{host}:{port}"));
        }
    }
    // All at once rather than one by one: with Beeper closed every probe
    // times out, and in series that is half a minute.
    let probes = candidates.iter().map(|base| {
        let client = &client;
        async move {
            client
                .get(format!("{base}{WELL_KNOWN}"))
                .send()
                .await
                .is_ok()
        }
    });
    let answered = futures_util::future::join_all(probes).await;
    candidates
        .into_iter()
        .zip(answered)
        .find_map(|(base, ok)| ok.then_some(base))
}

/// The MCP endpoint to hand the proxy, when Beeper answers somewhere other
/// than the default the proxy already assumes.
pub fn mcp_endpoint(base: &str) -> Option<String> {
    let default = matches!(base, DEFAULT_BASE | "http://localhost:23373");
    (!default).then(|| format!("{base}/v0/mcp"))
}

fn is_loopback(url: &str) -> bool {
    url::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(str::to_owned))
        .is_some_and(|h| matches!(h.as_str(), "127.0.0.1" | "localhost" | "::1" | "[::1]"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_machine_architecture_is_known_on_the_platforms_we_ship() {
        assert!(machine_arch().is_some());
    }

    #[test]
    fn the_default_port_needs_no_endpoint() {
        assert_eq!(mcp_endpoint("http://127.0.0.1:23373"), None);
        assert_eq!(mcp_endpoint("http://localhost:23373"), None);
    }

    #[test]
    fn another_port_is_passed_to_the_proxy() {
        assert_eq!(
            mcp_endpoint("http://127.0.0.1:23375").as_deref(),
            Some("http://127.0.0.1:23375/v0/mcp")
        );
    }

    #[test]
    fn only_loopback_overrides_are_probed() {
        assert!(is_loopback("http://127.0.0.1:23373"));
        assert!(is_loopback("http://[::1]:23373"));
        assert!(!is_loopback("http://example.com:23373"));
        assert!(!is_loopback("not a url"));
    }

    #[test]
    fn display_icon_values_resolve_to_the_exe() {
        let dir = std::env::temp_dir().join(format!("beeper-icon-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let exe = dir.join("Beeper.exe");
        std::fs::write(&exe, b"MZ").unwrap();
        let shown = exe.display().to_string();
        assert_eq!(exe_from_icon(&format!("\"{shown}\",0")), Some(exe.clone()));
        assert_eq!(exe_from_icon(&format!("{shown},-1")), Some(exe.clone()));
        assert_eq!(exe_from_icon(&shown), Some(exe.clone()));
        assert_eq!(exe_from_icon(&format!("{shown}.ico")), None);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
