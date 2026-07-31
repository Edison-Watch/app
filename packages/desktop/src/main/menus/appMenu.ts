// Native application menu (the OS menu bar on macOS, the window menu
// elsewhere). Extracted from index.ts so the main entry stays under the
// project's file-size CI cap.

import { app, BrowserWindow, Menu } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'

import { bootstrapDetectord } from '../detectord/bootstrap'
import {
  DEBUG_ENV_NAMES,
  getBuildDefaultEnv,
  getCredentialsForEnv,
  getCustomBackend,
  getDebugEnvOverride,
  getMcpBaseUrl,
  setDebugEnvOverride,
  startServerStatusChecks
} from '../infra/setupConfig'

export interface AppMenuDeps {
  getMainWindow: () => BrowserWindow | null
  updateAppMenu: () => void
  updateTrayMenu: () => void
  logEnvConfig: (context: string) => void
  slog: (msg: string) => void
  handleClearDataAndRestart: () => void
  buildTrayMenuItems: () => MenuItemConstructorOptions[]
}

export function buildAppMenu(deps: AppMenuDeps): Menu {
  // Hide the Developer menu (which includes the env switcher) on release builds.
  const showDeveloperMenu = getBuildDefaultEnv() !== 'release'
  const currentEnv = getDebugEnvOverride() ?? getBuildDefaultEnv()
  // "custom" is only selectable once a self-hosted URL has been stored (the
  // welcome screen's "Connect by URL" flow writes it); switching to it here
  // reuses that URL.
  const customBackend = getCustomBackend()
  const envSubmenu: MenuItemConstructorOptions[] = DEBUG_ENV_NAMES.map((name) => ({
    label:
      name === 'dev'
        ? 'dev (localhost)'
        : name === 'custom'
          ? customBackend
            ? `custom (${customBackend.apiBaseUrl})`
            : 'custom (set via the sign-in screen)'
          : name,
    type: 'radio' as const,
    checked: currentEnv === name,
    enabled: name !== 'custom' || customBackend !== null,
    click: async () => {
      setDebugEnvOverride(name)
      deps.logEnvConfig(`switch→${name}`)
      deps.updateAppMenu()
      deps.getMainWindow()?.webContents.send('env:changed', name)

      // Re-point the agents at the new env: re-enrolling hands the daemon the
      // env's credentials, and its install step rewrites the edison-watch entry
      // with the new URL. The daemon owns those config writes.
      const creds = getCredentialsForEnv(name)
      if (getMcpBaseUrl() && creds?.apiKey) {
        const outcome = await bootstrapDetectord().catch((err) => {
          deps.slog(`[env:switch] Failed to update MCP integrations: ${err}`)
          return null
        })
        // `applied`, not `ok`: a daemon still enrolled from the previous env
        // reports ok=true while its agents keep the old env's URL and key.
        if (outcome?.applied) {
          deps.slog(`[env:switch] MCP integrations updated for ${name}`)
        } else {
          deps.slog(
            `[env:switch] MCP integrations NOT updated for ${name} - agents still point at the ` +
              `previous environment: ${outcome?.reason ?? 'enrollment failed'}`
          )
        }
      } else if (getMcpBaseUrl() && !creds?.apiKey) {
        deps.slog(`[env:switch] No API key stored for env "${name}" - MCP integrations not updated`)
      }

      // Re-check server liveness against the new env URL.
      startServerStatusChecks(deps.updateTrayMenu)
    }
  }))

  const devSubmenu: MenuItemConstructorOptions[] = [
    { label: 'Switch Environment', submenu: envSubmenu },
    { type: 'separator' },
    { label: 'Clear App Data & Restart', click: () => deps.handleClearDataAndRestart() }
  ]
  const developerItem: MenuItemConstructorOptions = { label: 'Developer', submenu: devSubmenu }

  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin'
      ? ([
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              ...(showDeveloperMenu
                ? ([developerItem, { type: 'separator' }] as MenuItemConstructorOptions[])
                : []),
              { role: 'quit' }
            ]
          }
        ] as MenuItemConstructorOptions[])
      : []),
    { label: 'Actions', submenu: deps.buildTrayMenuItems() },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        ...(process.platform !== 'darwin' && showDeveloperMenu
          ? ([{ type: 'separator' }, developerItem] as MenuItemConstructorOptions[])
          : [])
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ] as MenuItemConstructorOptions[]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(process.platform === 'darwin'
          ? ([{ type: 'separator' }, { role: 'front' }] as MenuItemConstructorOptions[])
          : ([{ role: 'close' }] as MenuItemConstructorOptions[]))
      ] as MenuItemConstructorOptions[]
    }
  ]

  return Menu.buildFromTemplate(template)
}
