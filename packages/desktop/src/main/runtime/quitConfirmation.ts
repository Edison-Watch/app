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

let quitConfirmed = false
let confirmationInFlight = false

/**
 * Skip the confirmation dialog for the next quit. Used by flows where the quit
 * is an explicit, already-confirmed action (e.g. installing a downloaded update).
 */
export function bypassQuitConfirmation(): void {
  quitConfirmed = true
}

/** Best-effort org quarantine flag, bounded so the dialog never hangs on network. */
async function isQuarantineEnabled(): Promise<boolean> {
  try {
    const apiBaseUrl = getApiBaseUrl()
    const creds = getCredentialsForEnv()
    if (!apiBaseUrl || !creds?.apiKey) return false
    return await Promise.race([
      fetchAutoQuarantineEnabled(apiBaseUrl, creds.apiKey),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), QUARANTINE_LOOKUP_TIMEOUT_MS))
    ])
  } catch {
    return false
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
    quitConfirmed = true
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
    if (quitConfirmed) return
    event.preventDefault()
    // A second Cmd+Q while the dialog is up must not stack another dialog.
    if (confirmationInFlight) return
    confirmationInFlight = true
    void confirmQuit().finally(() => {
      confirmationInFlight = false
    })
  })
}
