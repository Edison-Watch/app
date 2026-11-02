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
`.github/workflows/stdiod-ci.yml`. Unsigned for now, so Windows shows "Windows
protected your PC" (More info, then Run anyway).

## Images

The banner, header icon and `setup.ico` in `assets/` are generated from the two
sources in `assets/src/`. After changing a source, regenerate them:

```
cd assets && uv run --with pillow python make_images.py
```
