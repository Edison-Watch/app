// Full Disk Access for the detector daemon (macOS only).
//
// The daemon watches the parent directory of every MCP config it knows about.
// One of those configs is `~/.mcp.json` - Claude Code lists `$HOME` itself in
// its projects map - so the daemon ends up watching `$HOME`, and an FSEvents
// stream on `$HOME` reaches into ~/Documents, ~/Desktop and ~/Downloads. That
// is three separate TCC services, so the user is asked three times, with three
// near-identical dialogs, and again for every protected folder added later.
//
// Full Disk Access (kTCCServiceSystemPolicyAllFiles) supersedes all of them:
// one grant, no per-folder prompts, and it keeps working as the watch set
// grows. This is why electron-builder.yml deletes the per-folder usage strings
// rather than filling them in - they would describe the wrong binary anyway.
//
// The catch is that macOS has no API to REQUEST Full Disk Access. There is no
// prompt; it is granted by hand in System Settings -> Privacy & Security ->
// Full Disk Access. All the app can do is notice the absence and open the pane.
//
// IMPORTANT: none of this helps unless the daemon binary carries a valid code
// signature with a designated requirement. A `lipo`-merged universal Mach-O
// whose x86_64 slice is unsigned has none, and tccd writes such a grant but can
// never re-verify it - including the Full Disk Access one, which is why the
// folder prompts kept coming back even after it was granted. scripts/
// build-detectord.sh now stages a thin arm64 binary and signs it; the CI
// "Verify bundled daemons" steps fail the build if that regresses.

import { shell } from 'electron'

import type { Status } from './protocol'
import { getDetectordBinaryPath } from './binary'
import { getDetectordClient } from './lifecycle'

// The pane deep link. `Privacy_AllFiles` is the Full Disk Access anchor and has
// been stable across the System Preferences -> System Settings rename.
const FDA_PANE_URL =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles'

/** Tri-state, because "we could not ask" must not be shown as "denied". */
export type FullDiskAccessState = 'granted' | 'denied' | 'unknown'

/**
 * Read the daemon's Full Disk Access state out of a status reply.
 *
 * `status` is null when the daemon is down or unreachable, and
 * `full_disk_access` is undefined on a daemon predating the field - both are
 * `unknown`, never `denied`. A "grant Full Disk Access" banner that appears
 * during a routine daemon restart is worse than no banner at all.
 *
 * Off macOS the question does not apply, so nothing is ever missing: `granted`.
 */
function fullDiskAccessState(status: Status | null): FullDiskAccessState {
  if (process.platform !== 'darwin') return 'granted'
  if (!status) return 'unknown'
  const fda = status.full_disk_access
  if (fda === true) return 'granted'
  if (fda === false) return 'denied'
  return 'unknown'
}

/**
 * Open System Settings at the Full Disk Access pane.
 *
 * The user still has to add the daemon by hand: the pane's `+` opens a file
 * picker, and the binary lives inside the .app bundle, which the picker hides
 * by default (Cmd-Shift-G and paste the path, or drag it in). The path to show
 * alongside it is `binaryPath` on the [`FullDiskAccessInfo`] the renderer
 * already holds.
 */
export async function openFullDiskAccessSettings(): Promise<void> {
  if (process.platform !== 'darwin') return
  await shell.openExternal(FDA_PANE_URL)
}

/** The path the user must add to the Full Disk Access list. */
function fullDiskAccessBinaryPath(): string {
  return getDetectordBinaryPath()
}

/** What the renderer needs to decide whether to show the banner, and what to put in it. */
export interface FullDiskAccessInfo {
  state: FullDiskAccessState
  /** The path to add in System Settings. Shown so the user can copy it. */
  binaryPath: string
}

/**
 * Ask the daemon whether it holds Full Disk Access.
 *
 * Deliberately NOT routed through `withDetectordHealth`: a daemon that is down
 * is already reported by DaemonWarningBanner, and a second banner saying
 * "permission unknown" on top of it would be noise. An unreachable daemon
 * resolves to `unknown` here, which shows nothing.
 */
export async function getFullDiskAccessInfo(): Promise<FullDiskAccessInfo> {
  const binaryPath = fullDiskAccessBinaryPath()
  if (process.platform !== 'darwin') return { state: 'granted', binaryPath }
  const status = await getDetectordClient()
    .status()
    .catch(() => null)
  return { state: fullDiskAccessState(status), binaryPath }
}
