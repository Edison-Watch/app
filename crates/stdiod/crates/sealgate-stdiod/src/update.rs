//! Version reporting and update hints.
//!
//! The daemon ships as ONE version with the desktop app and detectord, so
//! "outdated" means "not the newest release on this daemon's channel". The
//! backend decides that and tells the daemon in two places:
//!
//! - `server_hello.update` on the tunnel (handled in `daemon.rs`), and
//! - the `X-SealGate-Update` header on REST responses ([`observe_response`]),
//!   which it adds only for requests carrying our [`user_agent`].
//!
//! The daemon keeps the tunnel hint in `state.json` for `status`, `doctor`
//! and the desktop app; CLI commands print a REST hint once on stderr.
//! Nothing here updates anything: `sealgate-stdiod update`
//! ([`crate::cli::update`]) does that, and only when someone runs it.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use once_cell::sync::Lazy;
use sealgate_tunnel_protocol::{UpdateChannel, UpdateHint, UpdateLevel};
use serde::{Deserialize, Serialize};

use crate::paths;

/// How this binary got onto the machine, which decides who updates it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstallSource {
    /// `install-beeper.sh` / `.ps1`: updated by `sealgate-stdiod update` or
    /// by re-running the script.
    Oneliner,
    /// The Windows setup program (its receipt says so; the folder is shared
    /// with the PowerShell script). Updated only by running a newer setup
    /// program, which installs the version it carries.
    Installer,
    /// Inside the SealGate desktop app: updated by updating the app.
    Desktop,
    /// `cargo install`: rebuilt from a checkout.
    Source,
    Unknown,
}

impl InstallSource {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Oneliner => "oneliner",
            Self::Installer => "windows-installer",
            Self::Desktop => "desktop",
            Self::Source => "source",
            Self::Unknown => "unknown",
        }
    }

    /// Whether `sealgate-stdiod update` may replace this binary.
    pub fn self_updatable(self) -> bool {
        matches!(self, Self::Oneliner | Self::Unknown)
    }

    /// One line telling a person how to update a daemon from this source.
    pub fn how_to_update(self) -> &'static str {
        match self {
            Self::Desktop => {
                "update the SealGate desktop app; it ships the daemon at the same version"
            }
            Self::Source => "rebuild it from an up-to-date checkout (cargo install)",
            Self::Installer => {
                "run a newer SealGate for Beeper setup program; it installs the version it carries"
            }
            _ => "run: sealgate-stdiod update",
        }
    }
}

/// `install-receipt.json`, written next to `config.toml` by the install
/// scripts. Only the fields read here; the scripts write more.
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct Receipt {
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub tag: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub channel: Option<String>,
    #[serde(default)]
    pub repo: Option<String>,
    #[serde(default)]
    pub bin: Option<String>,
    #[serde(default)]
    pub script_url: Option<String>,
    #[serde(default)]
    pub installed_at: Option<String>,
}

pub fn receipt_path() -> Option<PathBuf> {
    paths::config_dir()
        .ok()
        .map(|d| d.join("install-receipt.json"))
}

pub fn read_receipt() -> Option<Receipt> {
    let body = std::fs::read_to_string(receipt_path()?).ok()?;
    serde_json::from_str(&body).ok()
}

/// Classify a binary path. Pure, so it is testable for every platform's
/// layout from any platform.
pub fn classify_path(exe: &Path, home: &Path, local_app_data: Option<&Path>) -> InstallSource {
    let s = exe.to_string_lossy().replace('\\', "/");
    let lower = s.to_ascii_lowercase();
    let under = |dir: PathBuf| {
        let d = dir
            .to_string_lossy()
            .replace('\\', "/")
            .to_ascii_lowercase();
        lower.starts_with(&format!("{}/", d.trim_end_matches('/')))
    };
    // macOS: inside the app bundle. Linux: the AppImage copies it to a stable
    // path (packages/desktop/src/main/runtime/stdiodBinary.ts). Windows:
    // resources\bin inside the installed app.
    if lower.contains(".app/contents/")
        || under(home.join(".local/share/sealgate/bin"))
        || lower.ends_with("/resources/bin/sealgate-stdiod.exe")
    {
        return InstallSource::Desktop;
    }
    if under(home.join(".cargo/bin")) {
        return InstallSource::Source;
    }
    if under(home.join(".local/bin")) {
        return InstallSource::Oneliner;
    }
    // The PowerShell script's folder, shared with the Windows setup program.
    // Only a receipt can say the setup program put it there (install_source);
    // without one it is treated as the script's, as the script itself does.
    if let Some(lad) = local_app_data {
        if under(lad.join("Programs/sealgate-stdiod")) {
            return InstallSource::Oneliner;
        }
    }
    InstallSource::Unknown
}

/// This binary's real path (symlinks resolved), in the plain form the
/// supervisor units and receipts use: on Windows `canonicalize` returns a
/// `\\?\C:\...` verbatim path, which would never match them.
pub fn current_exe() -> Option<PathBuf> {
    std::env::current_exe().ok().map(|p| plain(&p))
}

fn plain(p: &Path) -> PathBuf {
    let real = std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf());
    match real.to_str().and_then(|s| s.strip_prefix(r"\\?\")) {
        Some(rest) if !rest.starts_with("UNC\\") => PathBuf::from(rest),
        _ => real,
    }
}

/// The source of the running binary. The receipt wins when it describes this
/// exact file; otherwise the path decides.
pub fn install_source() -> InstallSource {
    let Some(exe) = current_exe() else {
        return InstallSource::Unknown;
    };
    if let Some(r) = read_receipt() {
        let same = r.bin.as_deref().is_some_and(|b| {
            let b = plain(Path::new(b));
            if cfg!(windows) {
                b.to_string_lossy()
                    .eq_ignore_ascii_case(&exe.to_string_lossy())
            } else {
                b == exe
            }
        });
        match r.source.as_deref() {
            Some("oneliner") if same => return InstallSource::Oneliner,
            Some("windows-installer") if same => return InstallSource::Installer,
            _ => {}
        }
    }
    let home = dirs::home_dir().unwrap_or_default();
    let lad = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
    classify_path(&exe, &home, lad.as_deref())
}

/// The channel a version belongs to: any prerelease suffix is beta.
pub fn channel_of(version: &str) -> UpdateChannel {
    if version.contains('-') {
        UpdateChannel::Beta
    } else {
        UpdateChannel::Stable
    }
}

pub fn channel_str(c: UpdateChannel) -> &'static str {
    match c {
        UpdateChannel::Stable => "stable",
        UpdateChannel::Beta => "beta",
    }
}

/// `sealgate-stdiod/<version> (<os>; <arch>; <channel>; <source>)`. The
/// backend matches only the `sealgate-stdiod/<version>` token; the comment
/// is for its logs and the dashboard.
pub fn user_agent() -> &'static str {
    static UA: Lazy<String> = Lazy::new(|| {
        format!(
            "sealgate-stdiod/{} ({}; {}; {}; {})",
            crate::DAEMON_VERSION,
            std::env::consts::OS,
            std::env::consts::ARCH,
            channel_str(channel_of(crate::DAEMON_VERSION)),
            install_source().as_str(),
        )
    });
    &UA
}

pub const UPDATE_HEADER: &str = "x-sealgate-update";

/// Parse `latest=0.6.24; min=0.6.10; level=recommended; channel=stable`.
/// `None` for anything malformed: a hint is advice, never worth an error.
pub fn parse_update_header(value: &str) -> Option<UpdateHint> {
    let (mut latest, mut min, mut level, mut channel) = (None, None, None, None);
    for part in value.split(';') {
        let Some((k, v)) = part.split_once('=') else {
            continue;
        };
        let v = v.trim();
        match k.trim() {
            "latest" if !v.is_empty() => latest = Some(v.to_string()),
            "min" if !v.is_empty() => min = Some(v.to_string()),
            "level" => {
                level = match v {
                    "recommended" => Some(UpdateLevel::Recommended),
                    "required" => Some(UpdateLevel::Required),
                    _ => None,
                }
            }
            "channel" => {
                channel = match v {
                    "stable" => Some(UpdateChannel::Stable),
                    "beta" => Some(UpdateChannel::Beta),
                    _ => None,
                }
            }
            _ => {}
        }
    }
    Some(UpdateHint {
        latest: latest?,
        min,
        level: level?,
        channel: channel?,
    })
}

/// One sentence describing a hint, for logs, `status` and stderr notes.
pub fn describe(hint: &UpdateHint) -> String {
    let what = match hint.level {
        UpdateLevel::Recommended => "is outdated",
        UpdateLevel::Required => "is below the minimum this SealGate deployment supports",
    };
    format!(
        "sealgate-stdiod {} {what}: newest {} is {}",
        crate::DAEMON_VERSION,
        channel_str(hint.channel),
        hint.latest
    )
}

static NOTED: AtomicBool = AtomicBool::new(false);

/// Look for the backend's update header on a REST response and, the first
/// time in this process, print it on stderr for the person running the CLI.
/// The long-running daemon gets the same hint over the tunnel instead.
pub fn observe_response(resp: &reqwest::Response) {
    let Some(hint) = resp
        .headers()
        .get(UPDATE_HEADER)
        .and_then(|v| v.to_str().ok())
        .and_then(parse_update_header)
    else {
        return;
    };
    if NOTED.swap(true, Ordering::Relaxed) {
        return;
    }
    tracing::debug!(latest = %hint.latest, "backend reports an update");
    eprintln!(
        "note: {} ({})",
        describe(&hint),
        install_source().how_to_update()
    );
}

/// `[0, 6, 24, 10]` for `v0.6.24-beta.10`: numeric, so beta.10 > beta.9.
pub fn version_key(tag: &str) -> Vec<u64> {
    tag.split(|c: char| !c.is_ascii_digit())
        .filter(|s| !s.is_empty())
        .filter_map(|s| s.parse().ok())
        .collect()
}

/// SemVer order for `X.Y.Z[-pre]`, a leading `v` allowed: the core
/// numerically, then a release above its own prereleases
/// (`0.6.23-beta.4 < 0.6.23`), then prerelease parts, numeric ones
/// numerically. Something that is not a version sorts below every version.
/// The install scripts carry the same rules (`version_cmp`,
/// `Compare-StdiodVersion`).
pub fn compare_versions(a: &str, b: &str) -> std::cmp::Ordering {
    use std::cmp::Ordering;
    fn parse(v: &str) -> Option<([u64; 3], Vec<&str>)> {
        let v = v.trim().trim_start_matches('v');
        let (core, pre) = match v.split_once('-') {
            Some((c, p)) if !p.is_empty() => (c, p.split('.').collect()),
            Some(_) => return None,
            None => (v, Vec::new()),
        };
        let mut nums = core.split('.').map(|n| n.parse::<u64>().ok());
        let parsed = [nums.next()??, nums.next()??, nums.next()??];
        nums.next().is_none().then_some((parsed, pre))
    }
    match (parse(a), parse(b)) {
        (None, None) => Ordering::Equal,
        (None, Some(_)) => Ordering::Less,
        (Some(_), None) => Ordering::Greater,
        (Some((ca, pa)), Some((cb, pb))) => {
            ca.cmp(&cb)
                .then_with(|| match (pa.is_empty(), pb.is_empty()) {
                    (true, true) => Ordering::Equal,
                    (true, false) => Ordering::Greater,
                    (false, true) => Ordering::Less,
                    (false, false) => {
                        for (x, y) in pa.iter().zip(&pb) {
                            let o = match (x.parse::<u64>(), y.parse::<u64>()) {
                                (Ok(x), Ok(y)) => x.cmp(&y),
                                _ => x.cmp(y),
                            };
                            if o != Ordering::Equal {
                                return o;
                            }
                        }
                        pa.len().cmp(&pb.len())
                    }
                })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn header_parses_with_and_without_min() {
        let h = parse_update_header("latest=0.6.24; min=0.6.10; level=required; channel=stable")
            .unwrap();
        assert_eq!(h.latest, "0.6.24");
        assert_eq!(h.min.as_deref(), Some("0.6.10"));
        assert_eq!(h.level, UpdateLevel::Required);
        assert_eq!(h.channel, UpdateChannel::Stable);
        let h = parse_update_header("latest=0.6.24-beta.3;level=recommended;channel=beta").unwrap();
        assert_eq!((h.min, h.channel), (None, UpdateChannel::Beta));
    }

    #[test]
    fn malformed_headers_are_ignored() {
        for bad in [
            "",
            "latest=0.6.24",
            "latest=0.6.24; level=urgent; channel=stable",
            "latest=; level=recommended; channel=stable",
            "garbage",
        ] {
            assert!(parse_update_header(bad).is_none(), "{bad:?}");
        }
    }

    #[test]
    fn classify_known_layouts() {
        let home = Path::new("/Users/u");
        let lad = Path::new("C:/Users/u/AppData/Local");
        let c = |p: &str| classify_path(Path::new(p), home, Some(lad));
        assert_eq!(
            c("/Applications/SealGate.app/Contents/Resources/bin/sealgate-stdiod"),
            InstallSource::Desktop
        );
        assert_eq!(
            c("/Users/u/.local/share/sealgate/bin/sealgate-stdiod"),
            InstallSource::Desktop
        );
        assert_eq!(
            c(r"C:\Users\u\AppData\Local\Programs\SealGate\resources\bin\sealgate-stdiod.exe"),
            InstallSource::Desktop
        );
        assert_eq!(
            c("/Users/u/.local/bin/sealgate-stdiod"),
            InstallSource::Oneliner
        );
        assert_eq!(
            c("/Users/u/.cargo/bin/sealgate-stdiod"),
            InstallSource::Source
        );
        assert_eq!(
            c(r"C:\Users\u\AppData\Local\Programs\sealgate-stdiod\sealgate-stdiod.exe"),
            InstallSource::Oneliner
        );
        assert_eq!(c("/usr/local/bin/sealgate-stdiod"), InstallSource::Unknown);
        // A sibling directory sharing a prefix is not "under" it.
        assert_eq!(
            c("/Users/u/.local/binx/sealgate-stdiod"),
            InstallSource::Unknown
        );
    }

    #[test]
    fn desktop_setup_program_and_source_refuse_self_update() {
        assert!(InstallSource::Oneliner.self_updatable());
        assert!(!InstallSource::Installer.self_updatable());
        assert!(!InstallSource::Desktop.self_updatable());
        assert!(!InstallSource::Source.self_updatable());
    }

    #[test]
    fn channel_and_version_keys() {
        assert_eq!(channel_of("0.6.23"), UpdateChannel::Stable);
        assert_eq!(channel_of("0.6.23-beta.4"), UpdateChannel::Beta);
        assert!(version_key("v0.6.24-beta.10") > version_key("v0.6.24-beta.9"));
        assert!(version_key("v0.6.10") > version_key("v0.6.9"));
    }

    #[test]
    fn versions_compare_in_semver_order() {
        use std::cmp::Ordering::*;
        for (a, b, want) in [
            ("0.6.22", "0.6.23", Less),
            ("0.6.23", "v0.6.23", Equal),
            ("0.6.10", "0.6.9", Greater),
            ("0.6.23-beta.4", "0.6.23", Less),
            ("0.6.23-beta.9", "0.6.23-beta.10", Less),
            ("0.6.24-beta.3", "0.6.23", Greater),
            ("", "0.0.1", Less),
            ("garbage", "0.6.1", Less),
            ("0.6", "0.6.1", Less),
        ] {
            assert_eq!(compare_versions(a, b), want, "{a} vs {b}");
        }
    }

    #[test]
    fn user_agent_leads_with_the_token_the_backend_matches() {
        assert!(user_agent().starts_with(&format!("sealgate-stdiod/{} (", crate::DAEMON_VERSION)));
    }
}
