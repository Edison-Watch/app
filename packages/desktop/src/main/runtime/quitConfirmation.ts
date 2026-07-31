/**
 * macOS quit confirmation.
 *
 * Cmd+Q, the tray "Quit" item, and the dock menu all funnel through Electron's
 * 'before-quit' event. On macOS we intercept the first attempt and ask the user
 * to confirm, because quitting the app can make MCP servers that run on this
 * machine unreachable for remote agents. When the org has quarantine enabled we
 * additionally explain that the quarantine daemon keeps running after quit, but
 * that approval requests for quarantined servers need the app open.
 *
 * Programmatic quits that must not be interrupted (auto-update install) call
 * bypassQuitConfirmation() first. app.exit() paths (clear-data restart) never
 * fire 'before-quit', so they are unaffected.
 */

import { app, dialog } from 'electron'
import { getApiBaseUrl, getCredentialsForEnv } from '../infra/setupConfig'
import { fetchAutoQuarantineEnabled } from '../infra/domainConfig'

// How long the quit dialog waits for the org-config lookup before assuming
// quarantine is off. Keeps Cmd+Q responsive when the backend is slow/offline.
const QUARANTINE_LOOKUP_TIMEOUT_MS = 1_500

export const QUIT_BASE_DETAIL =
  'MCP servers running on this computer may become unavailable to your remote ' +
  'AI agents while Edison Watch is closed.'

export const QUIT_QUARANTINE_DETAIL =
  'Heads up: your organization has quarantine turned on. Quitting does NOT stop ' +
  'the quarantine protection - it keeps running in the background and new MCP ' +
  'servers will still be held for review. However, you need Edison Watch open ' +
  'to send approval requests for quarantined servers, so consider keeping it open.'

export function buildQuitConfirmationDetail(quarantineEnabled: boolean): string {
  return quarantineEnabled ? `${QUIT_BASE_DETAIL}\n\n${QUIT_QUARANTINE_DETAIL}` : QUIT_BASE_DETAIL
}

// One-shot: consumed by the next 'before-quit'. Never left armed across a
// failed quit, so a bypassed quit that doesn't happen (e.g. the updater threw)
// can't silently disable the dialog for the rest of the process lifetime.
let skipConfirmationOnce = false
let confirmationInFlight = false

/**
 * Skip the confirmation dialog for the NEXT quit only. Used by flows where the
 * quit is an explicit, already-confirmed action (e.g. installing a downloaded
 * update). Callers whose quit attempt fails without ever firing 'before-quit'
 * should call resetQuitConfirmationBypass() so the bypass doesn't stay armed.
 */
export function bypassQuitConfirmation(): void {
  skipConfirmationOnce = true
}

/** Undo bypassQuitConfirmation() after a quit attempt that failed to quit. */
export function resetQuitConfirmationBypass(): void {
  skipConfirmationOnce = false
}

/** Best-effort org quarantine flag, bounded so the dialog never hangs on network. */
async function isQuarantineEnabled(): Promise<boolean> {
  const controller = new AbortController()
  // Abort the request when the deadline hits (fetchAutoQuarantineEnabled maps
  // the abort to false), rather than racing a timer and leaving the fetch
  // running in the background. unref so a pending timer can't hold the process.
  const timer = setTimeout(() => controller.abort(), QUARANTINE_LOOKUP_TIMEOUT_MS)
  timer.unref?.()
  try {
    const apiBaseUrl = getApiBaseUrl()
    const creds = getCredentialsForEnv()
    if (!apiBaseUrl || !creds?.apiKey) return false
    return await fetchAutoQuarantineEnabled(apiBaseUrl, creds.apiKey, {
      signal: controller.signal
    })
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

async function confirmQuit(): Promise<void> {
  const quarantineEnabled = await isQuarantineEnabled()
  const { response } = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Cancel', 'Quit'],
    defaultId: 0,
    cancelId: 0,
    title: 'Quit Edison Watch',
    message: 'Are you sure you want to quit Edison Watch?',
    detail: buildQuitConfirmationDetail(quarantineEnabled)
  })
  if (response === 1) {
    skipConfirmationOnce = true
    app.quit()
  }
}

/**
 * Register the macOS 'before-quit' interceptor. No-op on other platforms
 * (Windows/Linux keep running in the tray when the window closes, so quit
 * there is already a deliberate tray-menu action).
 */
export function initQuitConfirmation(): void {
  if (process.platform !== 'darwin') return
  app.on('before-quit', (event) => {
    if (skipConfirmationOnce) {
      skipConfirmationOnce = false
      return
    }
    event.preventDefault()
    // A second Cmd+Q while the dialog is up must not stack another dialog.
    if (confirmationInFlight) return
    confirmationInFlight = true
    void confirmQuit()
      .catch((err) => {
        // The dialog itself failed (not a user cancel). Never trap the user in
        // an app they can't quit: log and let this quit proceed unconfirmed.
        console.error('[QuitConfirmation] dialog failed - quitting without confirmation:', err)
        skipConfirmationOnce = true
        app.quit()
      })
      .finally(() => {
        confirmationInFlight = false
      })
  })
}
