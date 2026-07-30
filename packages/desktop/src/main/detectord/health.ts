// Whether the detector daemon is answering, and what the app should say when
// it isn't.
//
// The daemon is not an optimisation - it is where discovery, quarantine, hook
// injection and every config write live. When it can't be reached the app has
// no fallback and cannot substitute for it: an empty server list means "we
// don't know", not "nothing is configured", and hook coverage of 0/0 means
// "unanswered", not "nothing installed". Presenting either as fact would tell
// the user their machine is clean when nobody looked. So every daemon call
// reports its outcome here, and the UI shows a warning for as long as the
// daemon is down.

import { app, BrowserWindow, dialog } from 'electron'

import { detectordBinaryExists, getDetectordBinaryPath } from './binary'

export type DetectordFailureKind =
  /** The binary isn't in the bundle at all - a packaging fault. */
  | 'missing-binary'
  /** The binary is there, but nothing is listening on the socket. */
  | 'unreachable'
  /** Connected, but the daemon refused or failed the request. */
  | 'error'

export interface DetectordHealth {
  ok: boolean
  kind?: DetectordFailureKind
  /** One line, safe to show verbatim in the UI. */
  message?: string
  /** The underlying error, for logs and the debug window. */
  detail?: string
  /** When the current state began (epoch ms). */
  since: number
}

let health: DetectordHealth = { ok: true, since: Date.now() }

// One line each. The banner is a persistent strip at the top of the window, so
// it states the condition and nothing else - the full explanation and the
// remedy live in the missing-binary dialog, and the raw error goes to the log
// (and the banner's tooltip) rather than on screen.
function classify(err: unknown): { kind: DetectordFailureKind; message: string } {
  if (!detectordBinaryExists()) {
    return {
      kind: 'missing-binary',
      message: 'Degraded: the agent and MCP detection daemon is missing.'
    }
  }
  const detail = err instanceof Error ? err.message : String(err)
  if (/ENOENT|ECONNREFUSED|EPIPE|socket closed|not running/i.test(detail)) {
    return {
      kind: 'unreachable',
      message: 'Degraded: the agent and MCP detection daemon is not running.'
    }
  }
  return {
    kind: 'error',
    message: 'Degraded: the agent and MCP detection daemon is not responding.'
  }
}

type HealthListener = (h: DetectordHealth) => void
const listeners = new Set<HealthListener>()

/** Subscribe to health changes (the tray re-renders its warning row). */
export function onDetectordHealthChange(listener: HealthListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function broadcast(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('detectord:health', health)
  }
  for (const l of listeners) {
    try {
      l(health)
    } catch (err) {
      console.error(`[detectord] health listener failed: ${String(err)}`)
    }
  }
}

/**
 * Record a failed daemon interaction. `op` names the call for the log; the
 * user-facing message comes from the failure kind, not the raw error.
 */
// The missing-binary dialog is shown once per session: it's an installation
// fault, so repeating it on every failed call would just be noise on top of a
// condition the user already knows about and can only fix by reinstalling.
let missingBinaryDialogShown = false

/**
 * Interrupt the user when the daemon is *absent* rather than merely
 * unreachable.
 *
 * The distinction is deliberate. "Unreachable" is often transient - the daemon
 * restarts during an install or an app update - and the banner plus the tray
 * row carry that. A missing binary is a broken installation: nothing will
 * detect or quarantine anything, no amount of waiting fixes it, and the app
 * would otherwise sit there looking like a security tool that's working.
 */
function showMissingBinaryDialog(): void {
  if (missingBinaryDialogShown) return
  missingBinaryDialogShown = true

  const show = (): void => {
    console.error('[detectord] showing missing-binary dialog')
    const parent = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
    const options = {
      type: 'error' as const,
      title: 'Edison Watch is not protecting this machine',
      message: 'The Edison Watch detector daemon is missing from this installation.',
      detail:
        'Without it, Edison Watch cannot detect MCP servers, review them, or quarantine ' +
        'unapproved ones - the app will run but it is not protecting anything.\n\n' +
        `Expected at:\n${getDetectordBinaryPath()}\n\n` +
        'Reinstall Edison Watch to restore protection.',
      buttons: ['Quit', 'Continue Without Protection'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    }
    const result = parent
      ? dialog.showMessageBox(parent, options)
      : dialog.showMessageBox(options)
    void result.then(({ response }) => {
      if (response === 0) app.quit()
    })
  }

  // The failure can land before the app is ready (bootstrap runs early), and
  // dialogs need a ready app.
  if (app.isReady()) show()
  else void app.whenReady().then(show)
}

export function reportDetectordFailure(op: string, err: unknown): void {
  const detail = err instanceof Error ? err.message : String(err)
  const { kind, message } = classify(err)
  console.error(`[detectord] ${op} failed (${kind}): ${detail}`)
  // Keep `since` pointing at the start of the outage, not the latest symptom.
  const changed = health.ok || health.kind !== kind
  health = { ok: false, kind, message, detail, since: changed ? Date.now() : health.since }
  if (changed) broadcast()
  if (kind === 'missing-binary') showMissingBinaryDialog()
}

/** Record a successful daemon interaction, clearing any warning. */
export function reportDetectordOk(): void {
  if (health.ok) return
  console.log('[detectord] reachable again')
  health = { ok: true, since: Date.now() }
  broadcast()
}

export function getDetectordHealth(): DetectordHealth {
  return health
}

/**
 * Run a daemon call, recording the outcome. Rethrows: callers that can degrade
 * gracefully catch it themselves, but nobody gets to swallow a failure without
 * the warning being raised first.
 */
export async function withDetectordHealth<T>(op: string, fn: () => Promise<T>): Promise<T> {
  try {
    const result = await fn()
    reportDetectordOk()
    return result
  } catch (err) {
    reportDetectordFailure(op, err)
    throw err
  }
}
