# Windows installer funnel telemetry (MVP)

Status: MVP for review. It is off by default and needs a privacy (GDPR) review before a release build turns it on.

Users log in on the dashboard, but some never get the desktop app installed and running. This feature reports a few anonymous events so that we can see where the Windows install stops.

## The funnel

| # | Event | Sent by | When |
|---|-------|---------|------|
| 0 | `desktop_installer_download_clicked` | dashboard (frontend-v2) | The user clicks "Download the installer". This is a proposed change in the other repository, see below. |
| 1 | `installer_started` | NSIS installer | End of `.onInit`, before any page shows. |
| 2 | `installer_step` `step=install_clicked` | NSIS installer | The user leaves the folder page with Install. |
| 3 | `installer_step` `step=old_version_checked` | NSIS installer | The uninstaller of the previous version finished (`exit_code`). It also runs on a fresh install. |
| 4 | `installer_step` `step=files_installed` | NSIS installer | End of the install section. Files, registry and shortcuts are in place. |
| 5 | `installer_finished` `outcome=success\|failed\|cancelled` | NSIS installer | The wizard closes, or the old uninstaller failed (`exit_code`), or NSIS aborted (`error_level`). |
| 6 | `app_first_launch` | desktop app (main process) | The first app start after an install. It carries the installer's `install_id`. |

All installer events carry these properties:

- `install_id`, `app_version`, `pkg_arch` and `os_arch`.
- `os_build`, the Windows build number.
- `upgrade`, and `silent` (true for auto-updates).
- The last `step`, and `duration_ms` since the installer started.

### How to read a run

- A run with `installer_started` and no `installer_finished` stopped on one of the hard `Quit` paths of electron-builder. Those paths skip every NSIS callback. Examples are "decompression failed" and "SealGate cannot be closed". The last `step` tells you where the run was.
- `outcome=cancelled` with `step=started` means that the user closed the wizard on the folder page.
- `installer_finished outcome=success` with no `app_first_launch` for the same `install_id` means that the app did not start or did not reach the endpoint. The app tries three times, on three starts.
- Step 0 cannot be joined to steps 1 to 6 per user. The dashboard links straight to the GitHub release asset, so nothing passes from the click into the `.exe`. Compare counts per day and per version instead. A per-download join needs a redirect endpoint that sets an id, which is a separate decision.

## Privacy

- `install_id` is a random GUID that the installer makes for each run. It is not linked to the dashboard user or to any account.
- No user name, machine name, path, e-mail, account id or IP-derived location is sent. Every event sets `$process_person_profile: false` (PostHog makes no person) and `$geoip_disable: true`.
- PostHog still receives the client IP at the HTTP level. To drop it, set "Discard client IP data" in the PostHog project settings. This is for the compliance review.
- Opt-out: the installer flag `/NOTELEMETRY`, or `DO_NOT_TRACK=1` or `SEALGATE_NO_TELEMETRY=1` in the environment. If the app backend is `custom`, `local` or `dev`, the app sends nothing.

## Safety

- The installer sends with WinHTTP in-process (no `curl`, no PowerShell), with a 1.5 s timeout for each phase. All errors are ignored.
- If the endpoint refuses the connection, the install takes the same time as without telemetry (measured under wine: 8.0 s against 8.2 s). If a firewall drops packets, each event can wait up to the connect timeout. That is about 1.5 s for each of the five events.
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

If either variable is empty, the script deletes `build/installer-telemetry.config.nsh` and the build has no telemetry. The script accepts plain `http` only for `127.0.0.1` and `localhost`. No CI workflow sets these variables yet.

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
| A. Clean install | Run the installer. Click Next on the folder page. Keep "Run SealGate" checked and click Finish. | `installer_started` (upgrade=false), `install_clicked`, `old_version_checked` (exit_code=0), `files_installed`, `installer_finished` (success), then `app_first_launch` with the same `install_id`. `%LOCALAPPDATA%\SealGate\install-telemetry.json` is gone after the app starts. |
| B. Upgrade | After case A, run the installer again (or a newer version). | The same events with `upgrade=true`, and a new `install_id`. |
| C. Silent update | After case A, run `SealGate-...-setup.exe /S --updated`. | The same events with `silent=true`. No `install_clicked` (no wizard). |
| D. Cancel | Run the installer. Click Cancel on the folder page. | `installer_started`, `installer_finished` (outcome=cancelled, step=started). |
| E. App running | Start SealGate. Run the installer. Click Next, then Cancel on "SealGate cannot be closed". | `installer_started`, `install_clicked`, and no `installer_finished`. This is a known gap. |
| F. Forced failure | After case A, replace `%LOCALAPPDATA%\Programs\SealGate\Uninstall SealGate.exe` with any program that exits with code 1. Run the installer and click Next. | `installer_finished` (outcome=failed, exit_code=1) before the "Failed to uninstall" dialog. |
| G. Offline | Stop the mock. Run case A. | The install time is the same as without telemetry. The marker stays. Start the mock and start the app: `app_first_launch` arrives with `attempt=2`. |
| H. Opt-out | Run the installer with `/NOTELEMETRY`. Then repeat with `DO_NOT_TRACK=1` set. | No events. No marker file. |
| I. Telemetry off | Build without the two variables. Run case A. | No events. No marker file. |

## Known gaps

- The hard `Quit` paths (case E, decompression failure) send no `installer_finished`. The only way to cover them is to replace electron-builder's `customCheckAppRunning`, which is out of scope for the MVP.
- If the old uninstaller fails, electron-builder shows its error dialog even with `/S`, because that `MessageBox` has no `/SD` default. A silent auto-update can then wait on a dialog. We send the failure event before the dialog. The dialog behavior is unchanged from electron-builder and is worth a separate fix.
- `customUnInstallCheck` replaces electron-builder's default handling of the old uninstaller result. The macro reproduces that default from app-builder-lib 26.x. When you upgrade electron-builder, check the macro again.
- The installer events say nothing about the user's account, so the dashboard cannot show "this user installed the app". This is by design for the MVP.
