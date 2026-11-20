# Windows installer funnel telemetry (MVP)

Status: MVP for review. It is off by default and needs a privacy (GDPR) review before a release build turns it on.

Users log in on the dashboard, but some never get the desktop app installed and running. This feature reports a few anonymous events so that we can see where the Windows install stops.

## The funnel

| # | Event | Sent by | When |
|---|-------|---------|------|
| 0 | `desktop_installer_download_clicked` | dashboard (frontend-v2) | The user clicks a desktop app download button. Properties: `platform`, `found`, `app_version`, `asset`. See Edison-Watch/edison-watch#1846. |
| 1 | `installer_started` | NSIS installer | End of `.onInit`, before any page shows. |
| 2 | `installer_step` `step=install_clicked` | NSIS installer | The user leaves the folder page with Install. |
| 3 | `installer_step` `step=old_version_handled` | NSIS installer | The uninstaller of the previous version finished (`exit_code`). It also runs on a fresh install. |
| 4 | `installer_step` `step=files_installed` | NSIS installer | End of the install section. Files, registry and shortcuts are in place. |
| 5 | `installer_finished` `outcome=success\|failed\|cancelled` | NSIS installer | The wizard closes, or the old uninstaller failed (`exit_code`), or NSIS aborted (`error_level`). |
| 6 | `app_first_launch` | desktop app (main process) | The first app start after an install. It carries the installer's `install_id`. |
| - | `installer_previous_run_incomplete` | NSIS installer | The next installer run finds that an earlier run never sent `installer_finished`. It carries `previous_install_id` and `previous_step`. |

All installer events carry these properties:

- `install_id`, `app_version`, `pkg_arch` and `os_arch`.
- `os_build`, the Windows build number.
- `upgrade`, and `silent` (true for auto-updates).
- The last `step`, and `duration_ms` since the installer started.
- `download_id` and `download_id_source`, only when the installer has a per-download id (see below).

### Per-download id

The dashboard can serve the installer under a name that carries a random id: `SealGate-<version>-<arch>-setup_dl-<16 hex digits>.exe`. The backend makes the id for each download, does not store it, and does not link it to the user. The edison-watch side builds this endpoint.

- The installer reads the id from its own file name. A browser suffix such as ` (1)` does not matter.
- If the name has no id, the installer looks for the same `_dl-<id>` token in the `HostUrl` and `ReferrerUrl` lines of its Zone.Identifier stream (the mark of the web). This works only if the download URL contains the token, for example as the last path segment.
- If it finds an id, every installer event carries `download_id` and `download_id_source` (`filename` or `zone_identifier`), and the marker passes both to `app_first_launch`.
- If it finds no id, or the id is not exactly 16 hex digits, no field is sent and nothing else changes.
- The dashboard event that is linked to the logged-in user does not carry the id. This keeps the per-download funnel anonymous.

### How to read a run

- A run with `installer_started` and no `installer_finished` stopped on one of the hard `Quit` paths of electron-builder, or the process was killed. Those paths skip every NSIS callback. Examples are "decompression failed", locked files, a full disk and "SealGate cannot be closed". The installer keeps the run id and the last step in `HKCU\Software\SealGate\InstallTelemetry` until the run reports its end. If the user tries again, the next run sends `installer_previous_run_incomplete` with that id and step.
- `previous_step=old_version_handled` means that the run stopped during file extraction (locked files, full disk, decompression error). `previous_step=install_clicked` on an upgrade means that it stopped at "SealGate cannot be closed". A failure of the old uninstaller is reported in the same run, as `installer_finished outcome=failed` with `exit_code`.
- `installer_finished outcome=failed` with `blocking_dialog=true` is a silent auto-update that now waits on electron-builder's "Failed to uninstall" dialog. See the known gaps.
- `outcome=cancelled` with `step=started` means that the user closed the wizard on the folder page.
- `installer_finished outcome=success` with no `app_first_launch` for the same `install_id` means that the app did not start or did not reach the endpoint. The app tries three times, on three starts. The app sends the event once, whether the user starts it from the finish page or later from the Start menu, because it deletes the marker after a successful send. A newer install overwrites the marker, so the newest `install_id` wins.
- Step 0 cannot be joined to steps 1 to 6 per user. The dashboard links straight to the GitHub release asset, so nothing passes from the click into the `.exe`. Compare counts per day and per version instead. A per-download join needs a redirect endpoint that sets an id, which is a separate decision.

## Privacy

- `install_id` is a random GUID that the installer makes for each run. It is not linked to the dashboard user or to any account.
- No user name, machine name, path, e-mail, account id or IP-derived location is sent. Every event sets `$process_person_profile: false` (PostHog makes no person) and `$geoip_disable: true`.
- PostHog still receives the client IP at the HTTP level. The installer project must have "Discard client IP data" turned on (see "Setting up the PostHog project").
- Opt-out: the installer flag `/NOTELEMETRY`, or `DO_NOT_TRACK=1` or `SEALGATE_NO_TELEMETRY=1` in the environment. If the app backend is `custom`, `local` or `dev`, the app sends nothing.

## Safety

- The installer sends with WinHTTP in-process (no `curl`, no PowerShell). It uses the user's proxy settings (Windows 8.1 and later), and falls back to WinHTTP's own proxy setting.
- Timeouts: 1 s to resolve, 1 s to connect, 1 s to send, 1.5 s to receive, and 1.5 s for the response headers. The last one has its own WinHTTP option with a 90 s default, so the installer sets it explicitly.
- After the first failed send, the installer sends nothing more in that run. Measured under wine: a refused connection costs no time (8.0 s against 8.2 s). An endpoint that accepts the connection and never answers costs one wait of about 1.5 s (10.6 s in total, one request).
- The app sends with `net.fetch`, which uses the system proxy. The request has a 3 s abort signal and a hard 3.5 s race. It does not block startup.
- When telemetry is off, `build/installerTelemetry.nsh` defines only an empty `sgItInit` macro. The installer then has the same logic as before.

## Turning it on

The switch is a generated, git-ignored include file. You write it before you run electron-builder:

```sh
cd packages/desktop
SG_INSTALL_TELEMETRY_URL=https://us.i.posthog.com/i/v0/e/ \
SG_INSTALL_TELEMETRY_KEY=phc_... \
node scripts/installer-telemetry-config.mjs
npx electron-builder --win --x64
```

If either variable is empty, the script deletes `build/installer-telemetry.config.nsh` and the build has no telemetry. The script accepts plain `http` only for `127.0.0.1` and `localhost`.

No CI workflow sets these variables, so dev, demo and release builds all stay off until the compliance review.

The installer and first-launch events go to their own PostHog project. They never use the dashboard key in `packages/shared/src/config/env-config.ts`. The app reads the endpoint and key from the marker that the installer wrote, so both always report to the same project.

| Build | PostHog project | State |
|-------|-----------------|-------|
| Local and test builds | none, the mock server | Use `scripts/mock-capture-server.mjs`. |
| Demo (`desktop-release-demo.yml`) | The installer funnel project | Off. Turn on first, after the review. |
| Release (`desktop-release.yml`) | The same project | Off until the review. |
| Custom or self-hosted backend | none | The app never sends. The installer cannot know the backend, so a build for a self-hosted customer must leave the variables unset. |

Each event carries `app_version`, so demo and release events can be told apart in one project.

### Setting up the PostHog project

Somebody with PostHog admin rights does these steps once. Claude cannot create the project.

1. Create a new project, for example "SealGate installer funnel". Choose the region on purpose: the EU cloud (`eu.i.posthog.com`) keeps the data in the EU, and the dashboard project uses the US cloud.
2. In the project settings, turn on "Discard client IP data". PostHog then drops the IP before it stores the event, and GeoIP has nothing to use.
3. Leave autocapture, session replay, heatmaps and surveys off. They do not apply to this project, and only the capture API is used.
4. Set the data retention to the shortest period that the funnel analysis needs, for example 12 months.
5. Copy the project API key (`phc_...`). It is a write-only key, but keep it out of the repository: store it as a GitHub Actions secret, for example `SG_INSTALL_TELEMETRY_KEY`.
6. To turn telemetry on for one workflow, set `SG_INSTALL_TELEMETRY_URL` (for example `https://eu.i.posthog.com/i/v0/e/`) and `SG_INSTALL_TELEMETRY_KEY` from the secret, and run `node scripts/installer-telemetry-config.mjs` before electron-builder.

The `build:win`, `build:win:x64` and `build:win:arm64` scripts in `package.json` run the config script first. With the variables unset, it deletes a config file left over from an earlier test build, so a local build never ships a stale test endpoint.

## Testing against a mock endpoint

Never point a test build at the production PostHog key or the Sentry DSN.

```sh
cd packages/desktop
node scripts/mock-capture-server.mjs 8787          # shows events at http://127.0.0.1:8787/
SG_INSTALL_TELEMETRY_URL=http://127.0.0.1:8787/i/v0/e/ \
SG_INSTALL_TELEMETRY_KEY=phc_local_test \
node scripts/installer-telemetry-config.mjs
```

Unit tests: `npx vitest run src/main/__tests__/installTelemetry.test.ts`.

## Manual test on a Windows VM

You need a Windows 10 or 11 VM with a snapshot of a clean state, and a Linux or Windows machine that builds the installer.

1. On the VM, install Node 22. Copy `scripts/mock-capture-server.mjs` to the VM.
2. On the VM, start the mock: `node mock-capture-server.mjs 8787`. Open `http://127.0.0.1:8787/` in a browser and keep it open.
3. Build a test installer with `SG_INSTALL_TELEMETRY_URL=http://127.0.0.1:8787/i/v0/e/` and `SG_INSTALL_TELEMETRY_KEY=phc_local_test`, as shown above. Copy the `.exe` to the VM.

Run each case from the clean snapshot unless the case says otherwise. Write down the events that arrive.

| Case | Steps | Expected events |
|------|-------|-----------------|
| A. Clean install | Run the installer. Click Next on the folder page. Keep "Run SealGate" checked and click Finish. | `installer_started` (upgrade=false), `install_clicked`, `old_version_handled` (exit_code=0), `files_installed`, `installer_finished` (success), then `app_first_launch` with the same `install_id`. `%LOCALAPPDATA%\SealGate\install-telemetry.json` is gone after the app starts. |
| B. Upgrade | After case A, run the installer again (or a newer version). | The same events with `upgrade=true`, and a new `install_id`. |
| C. Silent update | After case A, run `SealGate-...-setup.exe /S --updated`. | The same events with `silent=true`. No `install_clicked` (no wizard). |
| D. Cancel | Run the installer. Click Cancel on the folder page. | `installer_started`, `installer_finished` (outcome=cancelled, step=started). |
| E. App running | Start SealGate. Run the installer. Click Next, then Cancel on "SealGate cannot be closed". | `installer_started`, `install_clicked`, and no `installer_finished`. This is a known gap. |
| F. Forced failure | After case A, replace `%LOCALAPPDATA%\Programs\SealGate\Uninstall SealGate.exe` with any program that exits with code 1. Run the installer and click Next. | `installer_finished` (outcome=failed, exit_code=1) before the "Failed to uninstall" dialog. |
| G. Offline | Stop the mock. Run case A. | The install time is the same as without telemetry. The marker stays. Start the mock and start the app: `app_first_launch` arrives with `attempt=2`. |
| G2. Endpoint hangs | Start the mock with `MOCK_CAPTURE_HANG=1`. Run case A. | The install takes at most about 2 s longer. The mock logs one request only. |
| G3. Blocking proxy | Set a system proxy that does not exist (Settings, Network, Proxy). Run case A. | Same as G2. The install takes at most a few seconds longer. |
| G4. Slow proxy discovery | Turn on "Automatically detect settings" on a network without a WPAD server. Run case A. | The first send can be slow. After one send over 1 s, the run sends nothing more. |
| J. Killed run | Run the installer and end it in Task Manager during "Installing". Run it again to the end. | The second run sends `installer_previous_run_incomplete` with the first `install_id`. |
| K. Start menu launch | Run case A, but clear "Run SealGate" on the finish page. Start SealGate from the Start menu. Close it and start it again. | One `app_first_launch` only. |
| M. Download id | Rename the installer to `SealGate-0.6.23-x64-setup_dl-0123456789abcdef.exe`. Run case A. | Every event and `app_first_launch` carry `download_id=0123456789abcdef`, `download_id_source=filename`. With a plain name, or `_dl-` followed by 15 or 17 digits, no event has the field. |
| N. Download id from Zone.Identifier | Use the plain file name. In PowerShell: `Set-Content -Path .\SealGate-0.6.23-x64-setup.exe -Stream Zone.Identifier -Value "[ZoneTransfer]`nZoneId=3`nHostUrl=https://example.test/x_dl-feedfacecafebeef.exe"`. Run case A. | Every event carries `download_id=feedfacecafebeef`, `download_id_source=zone_identifier`. Wine cannot run this case. |
| L. Locked file | After case A, open `resources\app.asar` in the install folder with a program that locks it. Run the installer, click Next, then Cancel on the retry dialog. Run it again. | No `installer_finished` in the first run. The second run sends `installer_previous_run_incomplete` with `previous_step=old_version_handled`. |
| H. Opt-out | Run the installer with `/NOTELEMETRY`. Then repeat with `DO_NOT_TRACK=1` set. | No events. No marker file. |
| I. Telemetry off | Build without the two variables. Run case A. | No events. No marker file. |

## Known gaps

- The hard `Quit` paths (cases E and L) send no `installer_finished` in the same run. They show up only if the user runs the installer again (`installer_previous_run_incomplete`). To report them in the same run, we would have to replace electron-builder's `customCheckAppRunning` and the extraction macros, which is out of scope for the MVP.
- If the old uninstaller fails, electron-builder shows its error dialog even with `/S`, because that `MessageBox` has no `/SD` default. A silent auto-update can then wait on a dialog that the user did not expect, and the update looks stuck. The event carries `blocking_dialog=true` in that case. The fix is one line in `sgItUninstallCheck`: add `/SD IDOK` to the `MessageBox`. That changes electron-builder's default behavior, so it is left for a separate decision. The fix must also apply when telemetry is off.
- `customUnInstallCheck` replaces electron-builder's default handling of the old uninstaller result. The macro reproduces that default from app-builder-lib 26.x. When you upgrade electron-builder, check the macro again.
- The installer events say nothing about the user's account, so the dashboard cannot show "this user installed the app". This is by design for the MVP.
