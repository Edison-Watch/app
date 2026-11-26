// Build the "Local tunnel" subsection of the tray menu. Extracted from
// index.ts so the main entry stays under the project's file-size CI cap.

import { clipboard, Notification, shell } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'

import { pendingKeepAwake, setKeepAwake } from './keepAwake'
import { getStdiodLogDir } from './stdiodLog'
import { getCachedStdiodStatus } from './trayCache'
import type { KeepAwakeEffective, KeepAwakeLocal, StdiodKeepAwake } from './types'

const KEEP_AWAKE_NOW: Record<KeepAwakeEffective, string> = {
  active: 'Now: keeping this computer awake',
  on_battery: 'Now: paused on battery',
  inactive: 'Now: off',
  unsupported: 'Now: not supported by this system'
}

// "Keep Awake When Plugged In" submenu. The daemon holds the sleep block;
// this only writes the local choice. See keepAwake.ts.
function buildKeepAwakeItem(
  keepAwake: StdiodKeepAwake,
  daemonRunning: boolean | null | undefined
): MenuItemConstructorOptions {
  const choose = (choice: KeepAwakeLocal) => (): void => {
    void setKeepAwake(choice).then((result) => {
      if (!result.ok && Notification.isSupported()) {
        new Notification({
          title: 'SealGate',
          body: `Could not change Keep Awake: ${result.errorMessage ?? 'unknown error'}`
        }).show()
      }
    })
  }
  // Until the daemon applies a new choice, show the one just made.
  const local = pendingKeepAwake(keepAwake.local) ?? keepAwake.local
  const dashboard = keepAwake.desired ? 'on' : 'off'
  return {
    label: 'Keep Awake When Plugged In',
    submenu: [
      {
        label: `Follow dashboard (${dashboard})`,
        type: 'radio',
        checked: local === 'auto',
        click: choose('auto')
      },
      { label: 'On', type: 'radio', checked: local === 'on', click: choose('on') },
      { label: 'Off', type: 'radio', checked: local === 'off', click: choose('off') },
      { type: 'separator' },
      {
        // state.json keeps its last value after the daemon stops, and the
        // sleep block ends with the daemon.
        label:
          daemonRunning === false
            ? 'Now: off (local tunnel not running)'
            : (KEEP_AWAKE_NOW[keepAwake.effective] ?? keepAwake.effective),
        enabled: false
      }
    ]
  }
}

const CONNECTION_LABELS: Record<string, string> = {
  starting: 'starting',
  connected: 'connected',
  reconnecting: 'reconnecting',
  needs_reauth: 'needs reauth (Sign In)',
  needs_upgrade: 'needs upgrade (update SealGate)'
}

export function buildStdiodMenuItems(
  trayIconPath: string,
  onReset?: () => void,
  // compact (Linux) drops the status/device/servers/last-error/reset rows,
  // leaving just "Open logs folder", to keep the tall native tray menu short.
  compact = false
): MenuItemConstructorOptions[] {
  const status = getCachedStdiodStatus()
  const items: MenuItemConstructorOptions[] = []

  if (!status.binaryAvailable) {
    if (!compact) items.push({ label: 'Local tunnel: binary missing', enabled: false })
    return items
  }

  // Shared "View logs / Reset" footer, appended to whichever status branch
  // we end up in. Reset is the heavy-hammer recovery, so it's offered
  // whenever there's anything to reset (signed in or running) - including
  // the "off" branch below, where a wedged half-install is exactly the
  // case a reset is meant to clear.
  const buildActions = (): MenuItemConstructorOptions[] => {
    const actions: MenuItemConstructorOptions[] = [
      {
        label: 'Open logs folder',
        click: () => {
          shell.openPath(getStdiodLogDir()).catch(() => {})
        }
      }
    ]
    if (!compact && onReset && (status.installed || status.loggedIn)) {
      actions.push({ label: 'Reset Local Tunnel…', click: onReset })
    }
    return actions
  }

  // installed (launchctl) is the source of truth for "is the daemon on".
  // loggedIn (config.toml present) is sticky across Disable so re-enable is
  // one click - checking it first would mislead users into seeing
  // "starting" forever after they toggled the daemon off.
  if (!status.installed) {
    if (!compact)
      items.push({
        label: status.loggedIn ? 'Local tunnel: off' : 'Local tunnel: not signed in',
        enabled: false
      })
    if (status.loggedIn) items.push(...buildActions())
    return items
  }

  const conn = status.state?.connection_state ?? 'starting'
  if (!compact)
    items.push({
      label: `Local tunnel: ${CONNECTION_LABELS[conn] ?? conn}`,
      enabled: false
    })

  if (!compact && status.state?.device_id) {
    const deviceId = status.state.device_id
    // On Linux the native menu has no width cap, so a long
    // `id (label)` (often id == label == hostname) blows the menu wide.
    // Show just the id there; win/mac keep the labelled form.
    const label =
      status.state.device_label && process.platform !== 'linux'
        ? `${deviceId} (${status.state.device_label})`
        : deviceId
    items.push({
      label: `Device: ${label}`,
      click: () => {
        clipboard.writeText(deviceId)
        if (Notification.isSupported()) {
          new Notification({
            title: 'SealGate',
            body: 'Device ID copied to clipboard',
            ...(process.platform !== 'darwin' && { icon: trayIconPath })
          }).show()
        }
      }
    })
  }

  const servers = status.state?.servers ?? []
  if (!compact && servers.length > 0) {
    const running = servers.filter((s) => s.state === 'running').length
    items.push({
      label: `Tunneled servers: ${running}/${servers.length} running`,
      enabled: false
    })
  }

  if (!compact && status.state?.last_error) {
    items.push({ label: `Last error: ${status.state.last_error}`, enabled: false })
  }

  // Keep-awake is Windows-only (the daemon writes keep_awake to state.json
  // only there). The check on the platform also hides a stale value.
  if (process.platform === 'win32' && status.state?.keep_awake) {
    items.push(buildKeepAwakeItem(status.state.keep_awake, status.daemonRunning))
  }

  items.push(...buildActions())

  return items
}
