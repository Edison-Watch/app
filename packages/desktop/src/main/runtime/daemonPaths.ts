import path from 'node:path'

// Where the two Rust daemons live on disk, as pure path math: no `electron`
// import and no filesystem access, so it unit-tests without mocks or a running
// app. Both daemons resolved their own copy of this list until the detectord
// copy rotted (it still pointed at the pre-monorepo packages/detectord long
// after the daemon moved to crates/), so the list lives here once.

export interface DaemonSpec {
  /** Directory under crates/ in this monorepo. */
  crate: string
  /** Binary name cargo emits - detectord's differs from the name it ships as. */
  cargoBin: string
  /** Binary name once staged by a build-<daemon> script or packaged. */
  shippedName: string
}

export const STDIOD: DaemonSpec = {
  crate: 'stdiod',
  cargoBin: 'sealgate-stdiod',
  shippedName: 'sealgate-stdiod'
}

export const DETECTORD: DaemonSpec = {
  crate: 'detectord',
  cargoBin: 'mcp_detector_daemon',
  shippedName: 'sealgate-detectord'
}

const exe = (name: string, win: boolean): string => (win ? `${name}.exe` : name)

/** The daemon's filename in a packaged build, under <resources>/bin. */
export function shippedExeName(
  spec: DaemonSpec,
  win = process.platform === 'win32'
): string {
  return exe(spec.shippedName, win)
}

/**
 * Dev-mode locations of a daemon binary, most-preferred first:
 *
 *   1. crates/<daemon>       - the monorepo location, plain `cargo build --release`
 *   2. desktop/bin           - staged by scripts/build-<daemon>.sh
 *   3. packages/<daemon>     - pre-monorepo sibling checkout, kept as a fallback
 *
 * `outMainDir` is the caller's __dirname (<pkg>/out/main), passed in rather than
 * read here so tests can drive it. Baking in __dirname is what let the detectord
 * list rot unnoticed: under vitest these modules resolve from src/main/..., so
 * the paths a test observed were never the paths the app used at runtime.
 *
 * Packaged builds never reach here - electron-builder maps bin/<daemon>/<arch>/
 * into resources/bin (see electron-builder.yml), which callers resolve from
 * process.resourcesPath.
 */
export function devDaemonCandidates(
  spec: DaemonSpec,
  outMainDir: string,
  win = process.platform === 'win32'
): string[] {
  const packagesDir = path.resolve(outMainDir, '..', '..', '..')
  const repoRoot = path.resolve(packagesDir, '..')
  const cargoBin = exe(spec.cargoBin, win)
  return [
    path.join(repoRoot, 'crates', spec.crate, 'target', 'release', cargoBin),
    path.resolve(outMainDir, '..', '..', 'bin', exe(spec.shippedName, win)),
    path.join(packagesDir, spec.crate, 'target', 'release', cargoBin)
  ]
}
