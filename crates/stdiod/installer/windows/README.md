# SealGate for Beeper: Windows setup program

A wizard that installs the `sealgate-stdiod` daemon with a private Node runtime,
then takes the person through the steps only they can do: approve this PC in
the browser, sign in to Beeper (installed for them, native build, signature
checked), and click Allow in Beeper. The PowerShell one-liner stays as the
alternative (`scripts/install-beeper.ps1`); both install into
`%LOCALAPPDATA%\Programs\sealgate-stdiod`.

| File | What it is |
| --- | --- |
| `SealGateBeeper.iss` | The Inno Setup wizard. Each step runs a `sealgate-stdiod setup ...` command (`crates/sealgate-stdiod/src/setup/`) and shows its output. |
| `build.ps1` | Stages both daemon builds and a checksum-verified Node for x64 and ARM64, then compiles the wizard for one deployment. |
| `release.ps1` | The release workflows' `beeper-setup` job: fetches the daemons from a release, builds one setup program per backend and uploads it. |

One setup program per deployment: the backend is compiled in (`-Backend`),
since a downloaded `.exe` cannot tell where it came from. `/backend=URL` on the
command line overrides it for testing. `/VERYSILENT` installs the files only.
`-DebugUi` builds `SealGate-Beeper-Setup-debug.exe`, with a button that cycles the sign-in page through its versions (not signed in, signed in, signed in with an email) without a real sign-in.

Build (Windows, Inno Setup 6.3+):

```powershell
./build.ps1 -X64Exe <x64 sealgate-stdiod.exe> -Arm64Exe <arm64 sealgate-stdiod.exe> -Backend https://beeper.sealgate.ai
```

CI builds it, installs it silently, checks and uninstalls it, and keeps the
`.exe` as an artifact: the `installer-windows` job in
`.github/workflows/stdiod-ci.yml`.

## Releases

Each release carries the setup program for its own deployment, named by the
host table in `release.ps1` and the desktop app's version:

| Workflow | Deployment | File | Signed |
| --- | --- | --- | --- |
| `desktop-release.yml` (stable, manual) | `beeper.sealgate.ai` | `SealGate-BeeperEdition-Setup-v<version>.exe` | by default (`sign` input) |
| | `dashboard.sealgate.ai`, for sealgate.ai/connect | `SealGate-Beeper-Setup-v<version>.exe` | |
| `desktop-release-demo.yml` (every push to main) | `demo-beeper-backend.up.railway.app` | `SealGate-BeeperEdition-demo-Setup-v<version>.exe` | only when a manual run asks |

A new deployment needs three entries, or its setup program is not built or
not found:

1. Its host and label in the `$labels` table in `release.ps1`. Without it the
   release job stops with "no setup program label".
2. Its origin in the `BACKENDS` list of the workflow that releases it
   (`desktop-release.yml` or `desktop-release-demo.yml`, `beeper-setup` job),
   so a setup program is built for it.
3. The same host and label in `_SETUP_LABELS` in edison-watch
   (`src/api/installer_scripts.py`), which finds the file by that name.

A deployment's `/get_sealgate_for_beeper` redirects to the newest published
release carrying its file (edison-watch `src/api/installer_scripts.py`), so
demo gets the newest prerelease and stable the newest release.

Signing uses the repo variable `WINDOWS_SIGN_COMMAND`, an Inno Setup sign tool
command in which `$f` is the file; it signs the setup program, its uninstaller
and the bundled daemon. For Azure Trusted Signing, `signtool sign /fd SHA256
/tr http://timestamp.acs.microsoft.com /td SHA256 /dlib <Azure.CodeSigning.Dlib.dll>
/dmdf <metadata.json> $f`, with `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` and
`AZURE_CLIENT_SECRET` as secrets. A run asked to sign without the variable fails
rather than ship unsigned. Unsigned, Windows shows "Windows protected your PC"
(More info, then Run anyway).

## Images

The banner, header icon and `setup.ico` in `assets/` are generated from the two
sources in `assets/src/`. After changing a source, regenerate them:

```
cd assets && uv run --with pillow python make_images.py
```
