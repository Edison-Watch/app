//! `sealgate-stdiod update` - replace this binary with the newest release on
//! its channel (or a pinned tag) and restart the supervised daemon onto it.
//!
//! Same model as the install scripts' `update` (see the "Updates" section of
//! `scripts/install-beeper.sh`):
//!
//! - One version for app, stdiod and detectord. `update` moves to the newest
//!   release on the channel only when it is NEWER than this binary; a binary
//!   at or ahead of it is current. It never downgrades on its own: moving to
//!   an older release takes `--tag <tag> --allow-downgrade`.
//! - Stable (`vX.Y.Z`) and beta (`vX.Y.Z-beta.N`) are separate lineages. The
//!   channel follows this binary's own version unless `--channel` says
//!   otherwise.
//! - Only a binary the scripts or the Windows setup program installed is
//!   replaced. The desktop app's copy updates with the app; a cargo build is
//!   rebuilt.
//! - The download is the release asset, checked against the release's
//!   `SHA256SUMS-<platform>-<arch>` before it replaces anything.
//!
//! `--check` only reports: exit 0 when current (or ahead), 10 when a newer
//! release exists. Not 2: clap exits 2 for a usage error, which a caller
//! must not mistake for "an update exists".

use std::io::Write;
use std::path::Path;
use std::time::Duration;

use anyhow::{anyhow, bail, Context, Result};
use clap::{Args, ValueEnum};
use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::platform;
use crate::update;

const DEFAULT_REPO: &str = "Edison-Watch/app";
const EXIT_UPDATE_AVAILABLE: i32 = 10;

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum ChannelArg {
    Stable,
    Beta,
}

#[derive(Debug, Args)]
pub struct UpdateArgs {
    /// Only report whether an update exists: exit 0 when current, 10 when not.
    #[arg(long)]
    pub check: bool,
    /// Move to this release tag instead of the newest, e.g. v0.6.22.
    #[arg(long, value_name = "TAG")]
    pub tag: Option<String>,
    /// Release channel (default: the one this binary's version belongs to).
    #[arg(long, value_enum)]
    pub channel: Option<ChannelArg>,
    /// Print one JSON object on stdout.
    #[arg(long)]
    pub json: bool,
    /// Allow moving to an OLDER release. Only with --tag, so a downgrade is
    /// always to a release someone named; without it, `update` never
    /// downgrades.
    #[arg(long, requires = "tag")]
    pub allow_downgrade: bool,
    /// GitHub repo carrying the releases (env STDIOD_REPO).
    #[arg(long, env = "STDIOD_REPO", default_value = DEFAULT_REPO, hide = true)]
    pub repo: String,
}

#[derive(Debug, Deserialize)]
struct Release {
    tag_name: String,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
}

/// `(binary asset, checksum file)` for this platform, as the release
/// workflows name them.
fn release_assets() -> Option<(&'static str, &'static str)> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => Some(("sealgate-stdiod-macos-arm64", "SHA256SUMS-macos-arm64")),
        ("linux", "x86_64") => Some(("sealgate-stdiod-linux-x64", "SHA256SUMS-linux-x64")),
        ("linux", "aarch64") => Some(("sealgate-stdiod-linux-arm64", "SHA256SUMS-linux-arm64")),
        ("windows", "x86_64") => {
            Some(("sealgate-stdiod-windows-x64.exe", "SHA256SUMS-windows-x64"))
        }
        ("windows", "aarch64") => Some((
            "sealgate-stdiod-windows-arm64.exe",
            "SHA256SUMS-windows-arm64",
        )),
        _ => None,
    }
}

fn client() -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent(update::user_agent())
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(300))
        .build()
        .context("building HTTP client")
}

/// Newest tag on the channel. Stable uses GitHub's single "Latest" pointer;
/// beta scans the list, which GitHub does not order by version.
async fn latest_tag(http: &reqwest::Client, repo: &str, beta: bool) -> Result<String> {
    let api = format!("https://api.github.com/repos/{repo}");
    if !beta {
        let rel: Release = http
            .get(format!("{api}/releases/latest"))
            .send()
            .await
            .and_then(|r| r.error_for_status())
            .context("asking GitHub for the latest release")?
            .json()
            .await
            .context("reading GitHub's latest release")?;
        return Ok(rel.tag_name);
    }
    let rels: Vec<Release> = http
        .get(format!("{api}/releases?per_page=100"))
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .context("listing GitHub releases")?
        .json()
        .await
        .context("reading GitHub's release list")?;
    pick_newest_beta(&rels).ok_or_else(|| anyhow!("no beta release found on {repo}"))
}

/// The newest beta release: a published prerelease tagged exactly
/// `vX.Y.Z-beta.N`, in SemVer order. Other prereleases (`-rc.1`, `-alpha.1`,
/// ...) are not the beta channel and are never picked.
fn pick_newest_beta(rels: &[Release]) -> Option<String> {
    rels.iter()
        .filter(|r| !r.draft && r.prerelease)
        .map(|r| r.tag_name.as_str())
        .filter(|t| is_beta_tag(t))
        .max_by(|a, b| update::compare_versions(a, b))
        .map(str::to_string)
}

/// `vX.Y.Z-beta.N`, every part numeric.
fn is_beta_tag(tag: &str) -> bool {
    let digits = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
    let Some((core, n)) = tag.strip_prefix('v').and_then(|t| t.split_once("-beta.")) else {
        return false;
    };
    let parts: Vec<&str> = core.split('.').collect();
    parts.len() == 3 && parts.iter().all(|p| digits(p)) && digits(n)
}

/// The expected hash of `asset` from a `SHA256SUMS` listing
/// (`<hex>  <name>` or `<hex> *<name>`).
fn expected_sha256(listing: &str, asset: &str) -> Option<String> {
    listing.lines().find_map(|line| {
        let mut parts = line.split_whitespace();
        let hash = parts.next()?;
        let name = parts.next()?.trim_start_matches('*');
        (name == asset).then(|| hash.to_ascii_lowercase())
    })
}

async fn download(http: &reqwest::Client, url: &str) -> Result<Vec<u8>> {
    let resp = http
        .get(url)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .with_context(|| format!("downloading {url}"))?;
    Ok(resp
        .bytes()
        .await
        .with_context(|| format!("reading {url}"))?
        .to_vec())
}

/// Put `new_bytes` in place of `exe`. The new file is written next to it and
/// renamed over it, so the swap is atomic and the old inode is never
/// rewritten (rewriting a signed Mach-O in place gets it SIGKILLed). Windows
/// cannot replace a running exe but can rename it, so the running one is
/// moved aside first and deleted on a later run.
fn replace_binary(exe: &Path, new_bytes: &[u8]) -> Result<()> {
    let dir = exe
        .parent()
        .ok_or_else(|| anyhow!("{} has no parent directory", exe.display()))?;
    let staged = dir.join(format!(".sealgate-stdiod.new-{}", std::process::id()));
    std::fs::write(&staged, new_bytes).with_context(|| format!("writing {}", staged.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&staged, std::fs::Permissions::from_mode(0o755))?;
    }
    // Refuse a binary that does not start here (wrong arch, truncated).
    let runs = std::process::Command::new(&staged)
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    if !runs {
        let _ = std::fs::remove_file(&staged);
        bail!("the downloaded binary does not run on this machine ('--version' failed)");
    }
    #[cfg(windows)]
    {
        let aside = dir.join(format!("sealgate-stdiod.exe.old-{}", std::process::id()));
        std::fs::rename(exe, &aside)
            .with_context(|| format!("moving the running {} aside", exe.display()))?;
        if let Err(e) = std::fs::rename(&staged, exe) {
            let _ = std::fs::rename(&aside, exe);
            let _ = std::fs::remove_file(&staged);
            return Err(e).with_context(|| format!("putting the new {} in place", exe.display()));
        }
    }
    #[cfg(not(windows))]
    std::fs::rename(&staged, exe).with_context(|| format!("replacing {}", exe.display()))?;
    Ok(())
}

/// Exes an earlier Windows update renamed aside while they were running.
/// One that still runs cannot be deleted yet; a later run gets it.
fn remove_stale_copies(exe: &Path) {
    let Some(dir) = exe.parent() else { return };
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for e in entries.flatten() {
        let name = e.file_name();
        let name = name.to_string_lossy();
        if name.starts_with("sealgate-stdiod.exe.old-") || name.starts_with(".sealgate-stdiod.new-")
        {
            let _ = std::fs::remove_file(e.path());
        }
    }
}

/// Record this update in the receipt: `source` says who last put the binary
/// there, now this command. Written even when there was no receipt (an older
/// setup program wrote none), and keeps the fields only the scripts know.
fn refresh_receipt(exe: &Path, tag: &str) {
    let Some(path) = update::receipt_path() else {
        return;
    };
    let mut r = update::read_receipt().unwrap_or_default();
    r.source = Some("self-update".to_string());
    r.tag = Some(tag.to_string());
    r.version = Some(tag.trim_start_matches('v').to_string());
    r.channel = Some(update::channel_str(update::channel_of(tag)).to_string());
    r.bin = Some(exe.to_string_lossy().into_owned());
    r.installed_at = Some(chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string());
    if let Ok(body) = serde_json::to_string(&r) {
        let _ = std::fs::write(path, body + "\n");
    }
}

pub async fn run(args: UpdateArgs) -> Result<()> {
    let installed = crate::DAEMON_VERSION;
    let source = update::install_source();
    let beta = match args.channel {
        Some(c) => c == ChannelArg::Beta,
        None => update::channel_of(installed) == sealgate_tunnel_protocol::UpdateChannel::Beta,
    };
    let channel = if beta { "beta" } else { "stable" };
    let http = client()?;
    let tag = match &args.tag {
        Some(t) => t.clone(),
        None => latest_tag(&http, &args.repo, beta).await?,
    };
    let want = tag.trim_start_matches('v');
    let order = update::compare_versions(want, installed);
    let newer = order == std::cmp::Ordering::Greater;
    let downgrade = order == std::cmp::Ordering::Less;

    if args.json {
        println!(
            "{}",
            serde_json::json!({
                "installed": installed,
                "latest": want,
                "channel": channel,
                "owner": source.as_str(),
                "update_available": newer,
            })
        );
    }
    let target = if args.tag.is_some() {
        "requested"
    } else {
        "newest"
    };
    eprintln!("sealgate-stdiod {installed} installed; {target} {channel}: {want}");
    if order == std::cmp::Ordering::Equal {
        eprintln!("up to date");
        return Ok(());
    }
    // Never downgrade unless someone named the release AND said so.
    let downgrade_allowed = args.allow_downgrade && !args.check;
    if downgrade && !downgrade_allowed {
        if args.tag.is_some() && !args.check {
            bail!(
                "{tag} is older than the installed {installed}; \
                 to move to it anyway: sealgate-stdiod update --tag {tag} --allow-downgrade"
            );
        }
        eprintln!("up to date ({installed} is newer than {want}; update never downgrades)");
        return Ok(());
    }
    if args.check {
        eprintln!(
            "update available: {installed} -> {want} ({})",
            source.how_to_update()
        );
        let _ = std::io::stdout().flush();
        std::process::exit(EXIT_UPDATE_AVAILABLE);
    }
    if !source.self_updatable() {
        bail!(
            "this sealgate-stdiod ({}) is not one this command updates: {}",
            source.as_str(),
            source.how_to_update()
        );
    }

    let (asset, sums) = release_assets().ok_or_else(|| {
        anyhow!(
            "no prebuilt sealgate-stdiod exists for {}/{}",
            std::env::consts::OS,
            std::env::consts::ARCH
        )
    })?;
    let exe = update::current_exe().ok_or_else(|| anyhow!("could not locate this binary"))?;
    remove_stale_copies(&exe);

    let base = format!("https://github.com/{}/releases/download/{tag}", args.repo);
    eprintln!("downloading {asset} ({tag})");
    let listing = String::from_utf8(download(&http, &format!("{base}/{sums}")).await?)
        .context("checksum file is not text")?;
    let expected = expected_sha256(&listing, asset)
        .ok_or_else(|| anyhow!("{sums} in {tag} lists no checksum for {asset}"))?;
    let bytes = download(&http, &format!("{base}/{asset}")).await?;
    let got = hex(&Sha256::digest(&bytes));
    if got != expected {
        bail!(
            "checksum mismatch for {asset} from {tag} (expected {expected}, got {got}); \
             the release assets may be corrupt or tampered with, so nothing was replaced"
        );
    }
    replace_binary(&exe, &bytes)?;
    refresh_receipt(&exe, &tag);
    eprintln!("replaced {} with {tag} (sha256 verified)", exe.display());

    // An unreadable unit is not "no unit": the old daemon may still be
    // running, so say so (and fail) rather than report nothing to restart.
    let unit = platform::unit_definition().with_context(|| {
        format!(
            "replaced {} with {tag}, but could not read the supervisor unit to restart \
             the daemon onto it; restart it yourself: sealgate-stdiod restart",
            exe.display()
        )
    })?;
    match unit {
        None => eprintln!("no supervisor unit installed, so nothing to restart"),
        // The unit runs this path, so a restart picks up the new file without
        // re-registering anything.
        Some(unit) if unit_runs(&unit, &exe) => {
            platform::restart().context("restarting the daemon onto the new binary")?;
            eprintln!("daemon restarted; check it with: sealgate-stdiod status");
        }
        // Another copy (usually the desktop app's) is the one supervised.
        // Restarting would restart THAT copy, not this one, so leave it.
        Some(_) => eprintln!(
            "the supervised daemon runs a different sealgate-stdiod than {}, so it was not \
             restarted; that copy updates the way it was installed",
            exe.display()
        ),
    }
    Ok(())
}

/// Whether a unit definition (plist, systemd unit, task XML) names `exe`.
/// Whether the supervisor unit runs `exe`. Compares the program the unit
/// names, decoded from its format, not a search through the raw text: the
/// Task Scheduler XML and the launchd plist escape `&`, `<` and `>`, so a path
/// like `C:\Users\A&B\...` is stored as `A&amp;B` there.
fn unit_runs(unit: &str, exe: &Path) -> bool {
    let Some(program) = unit_program(unit) else {
        return false;
    };
    let exe = exe.to_string_lossy();
    if cfg!(windows) {
        // Windows paths are case-insensitive.
        program.to_lowercase() == exe.to_lowercase()
    } else {
        program == exe.as_ref()
    }
}

/// The program a unit definition starts, in any of the three formats
/// `platform::unit_definition` returns:
/// - Task Scheduler XML: `<Command>...</Command>`.
/// - launchd plist: the first `<string>` after `<key>ProgramArguments</key>`.
/// - systemd unit: `ExecStart="..."` (or unquoted, up to the first space).
fn unit_program(unit: &str) -> Option<String> {
    fn between<'a>(text: &'a str, open: &str, close: &str) -> Option<&'a str> {
        let start = text.find(open)? + open.len();
        let len = text[start..].find(close)?;
        Some(&text[start..start + len])
    }
    if let Some(command) = between(unit, "<Command>", "</Command>") {
        return Some(xml_unescape(command.trim()));
    }
    if let Some(at) = unit.find("<key>ProgramArguments</key>") {
        return between(&unit[at..], "<string>", "</string>").map(|s| xml_unescape(s.trim()));
    }
    let exec = unit
        .lines()
        .find_map(|line| line.trim_start().strip_prefix("ExecStart="))?
        .trim_start();
    let program = match exec.strip_prefix('"') {
        Some(rest) => rest.split('"').next()?,
        None => exec.split_whitespace().next()?,
    };
    (!program.is_empty()).then(|| program.to_string())
}

/// Decodes the five predefined XML entities and numeric character references.
/// Anything else is kept as written.
fn xml_unescape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(amp) = rest.find('&') {
        out.push_str(&rest[..amp]);
        rest = &rest[amp..];
        let decoded = rest.find(';').and_then(|semi| {
            let entity = &rest[1..semi];
            let ch = match entity {
                "amp" => Some('&'),
                "lt" => Some('<'),
                "gt" => Some('>'),
                "quot" => Some('"'),
                "apos" => Some('\''),
                _ => entity
                    .strip_prefix("#x")
                    .or_else(|| entity.strip_prefix("#X"))
                    .map(|hex| u32::from_str_radix(hex, 16).ok())
                    .unwrap_or_else(|| entity.strip_prefix('#').and_then(|d| d.parse().ok()))
                    .and_then(char::from_u32),
            };
            ch.map(|c| (c, semi + 1))
        });
        match decoded {
            Some((c, used)) => {
                out.push(c);
                rest = &rest[used..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unit_program_reads_each_unit_format() {
        let task = "<Exec>\n      <Command>C:\\Users\\A&amp;B\\AppData\\Local\\Programs\\sealgate-stdiod\\sealgate-stdiod.exe</Command>\n      <Arguments>run</Arguments>\n    </Exec>";
        assert_eq!(
            unit_program(task).as_deref(),
            Some(r"C:\Users\A&B\AppData\Local\Programs\sealgate-stdiod\sealgate-stdiod.exe")
        );
        let plist = "<key>Label</key>\n  <string>com.sealgate.stdiod</string>\n  <key>ProgramArguments</key>\n  <array>\n    <string>/Users/a&amp;b/.local/bin/sealgate-stdiod</string>\n    <string>run</string>\n  </array>";
        assert_eq!(
            unit_program(plist).as_deref(),
            Some("/Users/a&b/.local/bin/sealgate-stdiod")
        );
        let quoted = "[Service]\nExecStart=\"/home/a b/.local/bin/sealgate-stdiod\" run\n";
        assert_eq!(
            unit_program(quoted).as_deref(),
            Some("/home/a b/.local/bin/sealgate-stdiod")
        );
        let bare = "[Service]\nExecStart=/usr/bin/sealgate-stdiod run\n";
        assert_eq!(
            unit_program(bare).as_deref(),
            Some("/usr/bin/sealgate-stdiod")
        );
        assert_eq!(unit_program("[Service]\nRestart=on-failure\n"), None);
    }

    #[test]
    fn unit_runs_matches_the_decoded_path_exactly() {
        let task = "<Command>/opt/a&amp;b/sealgate-stdiod</Command>";
        assert!(unit_runs(task, Path::new("/opt/a&b/sealgate-stdiod")));
        // A longer path that merely contains this one is a different program.
        assert!(!unit_runs(task, Path::new("/a&b/sealgate-stdiod")));
        assert!(!unit_runs(task, Path::new("/opt/a&b/sealgate-stdiod.old")));
    }

    #[test]
    fn xml_unescape_decodes_entities_and_keeps_the_rest() {
        assert_eq!(xml_unescape("a&amp;b&lt;c&gt;&quot;&apos;"), "a&b<c>\"'");
        assert_eq!(xml_unescape("&#38;&#x26;&#X26;"), "&&&");
        assert_eq!(xml_unescape("a & b &unknown; &"), "a & b &unknown; &");
        // One pass: an escaped entity stays an entity.
        assert_eq!(xml_unescape("&amp;lt;"), "&lt;");
    }

    fn rel(tag: &str, prerelease: bool, draft: bool) -> Release {
        Release {
            tag_name: tag.into(),
            prerelease,
            draft,
        }
    }

    #[test]
    fn newest_beta_is_numeric_and_ignores_stables_and_drafts() {
        let rels = [
            rel("v0.6.24-beta.9", true, false),
            rel("v0.6.24-beta.10", true, false),
            rel("v0.6.25", false, false),
            rel("v0.6.25-beta.1", true, true),
            rel("stdiod-v9.9.9-beta.1", true, false),
        ];
        assert_eq!(pick_newest_beta(&rels).as_deref(), Some("v0.6.24-beta.10"));
        assert_eq!(pick_newest_beta(&[]), None);
        // Only vX.Y.Z-beta.N is the beta channel, whatever the version.
        let rels = vec![
            rel("v0.6.24-beta.2", true, false),
            rel("v0.7.0-rc.1", true, false),
            rel("v0.7.0-alpha.1", true, false),
            rel("v0.7.0-beta.1.hotfix", true, false),
            rel("0.7.0-beta.1", true, false),
        ];
        assert_eq!(pick_newest_beta(&rels).as_deref(), Some("v0.6.24-beta.2"));
        // SemVer order across versions, not just the beta number.
        let rels = vec![
            rel("v0.6.24-beta.30", true, false),
            rel("v0.6.25-beta.1", true, false),
        ];
        assert_eq!(pick_newest_beta(&rels).as_deref(), Some("v0.6.25-beta.1"));
    }

    #[test]
    fn checksum_lines_in_both_sha256sum_formats() {
        let listing = "ABC123  sealgate-stdiod-linux-x64\n\
                       def456 *sealgate-stdiod-macos-arm64\n";
        assert_eq!(
            expected_sha256(listing, "sealgate-stdiod-linux-x64").as_deref(),
            Some("abc123")
        );
        assert_eq!(
            expected_sha256(listing, "sealgate-stdiod-macos-arm64").as_deref(),
            Some("def456")
        );
        assert_eq!(
            expected_sha256(listing, "sealgate-stdiod-linux-arm64"),
            None
        );
    }

    #[cfg(unix)]
    #[test]
    fn replace_swaps_the_file_atomically_and_refuses_a_broken_binary() {
        let dir = std::env::temp_dir().join(format!("stdiod-update-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let exe = dir.join("sealgate-stdiod");
        std::fs::write(&exe, "old").unwrap();

        let err = replace_binary(&exe, b"not a program").unwrap_err();
        assert!(err.to_string().contains("does not run"), "{err}");
        assert_eq!(
            std::fs::read(&exe).unwrap(),
            b"old",
            "a broken download must not land"
        );

        let script = b"#!/bin/sh\necho sealgate-stdiod 9.9.9\n";
        replace_binary(&exe, script).unwrap();
        assert_eq!(std::fs::read(&exe).unwrap(), script);
        let leftovers: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .filter(|e| e.file_name() != "sealgate-stdiod")
            .collect();
        assert!(leftovers.is_empty(), "staged file left behind");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
