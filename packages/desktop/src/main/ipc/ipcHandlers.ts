/**
 * IPC handler registration for the main process.
 *
 * Extracted from index.ts to keep the main entry point under the 800-line CI limit.
 * Call registerIpcHandlers() once after app.whenReady().
 */

import { app, BrowserWindow, ipcMain, shell } from 'electron'

import { getHookStatus } from '../runtime/hookStatus'
import { getAgentFacts } from '../detectord/agents'
import { getDetectordHealth } from '../detectord/health'
import { getDetectordClient } from '../detectord/lifecycle'
import { CLIENT_DISPLAY } from '../clients/displayMeta'
import { bootstrapDetectord, warnAgentsNotRepointed } from '../detectord/bootstrap'
import { uninstallService as uninstallDetectord } from '../detectord/controller'
import {
  getUpdateState,
  checkForUpdates,
  downloadUpdate,
  quitAndInstall,
  getSettings as getUpdateSettings,
  updateSettings as setUpdateSettings
} from '../infra/updateManager'
import { showFeedbackWindow } from '../dialogs/feedbackWindow'
import {
  reprovisionStdiodForActiveAccount,
  teardownStdiodForSignOut
} from '../stdiod/accountSwitch'
import { registerMcpSubmitHandlers } from './ipcHandlersMcpSubmit'
import { registerStdiodHandlers } from './ipcHandlersStdiod'
import {
  ENV_DOCS_URL,
  type SetupData,
  getActiveEnv,
  getApiBaseUrl,
  getMcpBaseUrl,
  getMcpConfig,
  getMcpUrl,
  getSetupData,
  getIsServerOnline,
  checkClaudeCodeMcpConnection,
  markSetupComplete,
  markSetupIncomplete,
  getSavedAccounts,
  switchToAccount,
  removeAccount,
  getCredentialsForEnv,
  getCustomBackend,
  setCustomBackend,
  setDebugEnvOverride
} from '../infra/setupConfig'
import { handleApproval, pendingApprovals, resizeApprovalWindow } from './approvalsHandler'

export interface IpcHandlerDeps {
  getMainWindow: () => BrowserWindow | null
  getAuthLoopbackUrl: () => string | null
  createTray: () => void
  startEventSubscription: () => void
  /** Rebuild the native app menu (env switcher state) after config changes. */
  updateAppMenu: () => void
}

export function registerIpcHandlers(deps: IpcHandlerDeps): void {
  const {
    getMainWindow,
    getAuthLoopbackUrl,
    createTray,
    startEventSubscription,
    updateAppMenu
  } = deps

  // Auth: open SAML/SSO URL in a separate BrowserWindow
  ipcMain.on('auth:open-saml', (_event, samlUrl: string) => {
    const mainWindow = getMainWindow()
    const authWindow = new BrowserWindow({
      width: 500,
      height: 700,
      show: true,
      modal: true,
      parent: mainWindow || undefined,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    })

    authWindow.loadURL(samlUrl)

    authWindow.webContents.on('did-finish-load', () => {
      const currentUrl = authWindow.webContents.getURL()
      if (currentUrl.includes('access_token=') || currentUrl.includes('code=')) {
        getMainWindow()?.webContents.send('auth:callback', currentUrl)
        authWindow.close()
      }
    })

    authWindow.webContents.on('will-navigate', (_event, url) => {
      if (url.startsWith('sealgate://')) {
        getMainWindow()?.webContents.send('auth:callback', url)
        authWindow.close()
      }
    })

    authWindow.webContents.on('will-redirect', (_event, url) => {
      if (url.startsWith('sealgate://')) {
        getMainWindow()?.webContents.send('auth:callback', url)
        authWindow.close()
      }
    })
  })

  // Auth: expose dev localhost callback URL (null in production)
  ipcMain.handle('auth:getLoopbackUrl', () => getAuthLoopbackUrl())

  // Config: active env name (for renderer to sync its localStorage env override)
  ipcMain.handle('config:getActiveEnv', () => getActiveEnv())

  // Config: effective base URLs (respects debug env override)
  ipcMain.handle('config:getEffectiveBaseUrls', () => {
    const apiBaseUrl = getApiBaseUrl()
    const mcpBaseUrl = getMcpBaseUrl()
    if (!apiBaseUrl)
      console.warn(
        '[config:getEffectiveBaseUrls] apiBaseUrl is null - renderer will have no API URL.'
      )
    if (!mcpBaseUrl)
      console.warn(
        '[config:getEffectiveBaseUrls] mcpBaseUrl is null - server health checks will fail.'
      )
    return {
      mcpBaseUrl,
      apiBaseUrl,
      docsBaseUrl: ENV_DOCS_URL
    }
  })

  // Re-enroll the detector daemon so already-configured agents follow an env
  // switch (same contract as the Developer menu's switcher): enrollment hands
  // the daemon the target env's credentials and its install step rewrites the
  // sealgate entry with the new URL. Skipped when the target env has no
  // stored API key yet - there is nothing to repoint agents to.
  const repointAgents = async (env: string, context: string): Promise<void> => {
    if (!getCredentialsForEnv(env)?.apiKey || !getMcpBaseUrl()) return
    const outcome = await bootstrapDetectord().catch((err) => {
      console.error(`[${context}] MCP integrations update failed:`, err)
      return null
    })
    if (!outcome?.applied) {
      // Same visible warning the account switcher uses: a silent partial
      // failure would leave agents talking to the previous backend while the
      // app claims the switch succeeded.
      await warnAgentsNotRepointed(
        env === 'custom' ? 'the self-hosted server' : `the ${env} environment`,
        outcome?.reason
      )
    }
  }

  // Config: stored custom (self-hosted) backend URLs, if any
  ipcMain.handle('config:getCustomBackend', () => getCustomBackend())

  // Config: connect to a custom (self-hosted) backend. Persists the URLs,
  // switches the active env to "custom" and tells the renderer to reload.
  // The same daemon re-enrollment as the menu's env switcher runs afterwards
  // so already-configured agents get repointed at the new backend.
  ipcMain.handle('config:setCustomBackend', async (_event, apiBaseUrl: string) => {
    let urls: { apiBaseUrl: string; mcpBaseUrl: string }
    try {
      urls = setCustomBackend(apiBaseUrl)
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
    }
    console.log(`[config:setCustomBackend] custom backend set to ${urls.apiBaseUrl}`)
    updateAppMenu()
    getMainWindow()?.webContents.send('env:changed', 'custom')
    await repointAgents('custom', 'config:setCustomBackend')
    return { ok: true as const, urls }
  })

  // Config: drop the env override and return to the build's default backend.
  // The stored custom URLs survive (setDebugEnvOverride only clears the env),
  // so the Developer menu can switch back to them later.
  ipcMain.handle('config:useDefaultBackend', async () => {
    setDebugEnvOverride(null)
    const env = getActiveEnv()
    updateAppMenu()
    getMainWindow()?.webContents.send('env:changed', env)
    await repointAgents(env, 'config:useDefaultBackend')
    return { env }
  })

  // Setup: get persisted setup data
  ipcMain.handle('setup:getData', () => {
    return getSetupData()
  })

  // Setup lifecycle
  ipcMain.on('setup:reached-final', () => {
    createTray()
  })

  ipcMain.on('setup:complete', (_event, data: Partial<SetupData>) => {
    markSetupComplete(data)
    console.log('[setup:complete] Setup data saved')

    // Start background services
    startEventSubscription()
    // Install + enroll the detector daemon and mirror its work into the client logs.
    bootstrapDetectord().catch((err) => console.error('[detectord] bootstrap failed:', err))

    const win = getMainWindow()
    if (win) {
      win.hide()
      // Re-show after a tick so the renderer can transition to MainMenu
      setTimeout(() => {
        if (!win.isDestroyed()) win.show()
      }, 500)
    }
  })

  ipcMain.handle('setup:reset', async () => {
    // In-app sign-out. Stop the daemon like the tray sign-out does, else it
    // keeps tunneling under the old account.
    await teardownStdiodForSignOut()
    markSetupIncomplete()
    return { ok: true }
  })

  // Renderer pushes credentials right after sign-in so the daemon can enroll on
  // login. A returning login keeps its API key only in the renderer's auth
  // state (never persisted to the setup file), so app-ready's bootstrap can't
  // read it, so mirror stdiod.login and let the renderer hand them over.
  ipcMain.handle(
    'detectord:enroll',
    async (
      _event,
      input: { apiUrl?: string; mcpUrl?: string; apiKey?: string }
    ) => {
      const outcome = await bootstrapDetectord(input).catch((err) => {
        console.error('[detectord] enroll (push) failed:', err)
        return null
      })
      // This caller only needs "is the daemon usable" - it isn't changing
      // credentials, so `ok` (not `applied`) is the right question.
      return { ok: outcome?.ok === true }
    }
  )

  // Stop + remove the detector daemon. purge=true also deletes all its data
  // (enrollment, seen-store, quarantine records, logs, socket).
  ipcMain.handle('detectord:uninstall', async (_event, opts?: { purge?: boolean }) => {
    const r = await uninstallDetectord(opts ?? {})
    return { ok: r.code === 0, stdout: r.stdout, stderr: r.stderr }
  })

  // Multi-account management
  ipcMain.handle('accounts:list', () => {
    return getSavedAccounts().map(({ userId, userEmail, savedAt }) => ({
      userId,
      userEmail,
      savedAt
    }))
  })

  ipcMain.handle('accounts:switch', async (_event, userId: string) => {
    const current = getSetupData()
    if (current.userId === userId) return { ok: true }
    const data = switchToAccount(userId)
    if (!data) return { ok: false }
    // Clear stale approvals from the previous account
    pendingApprovals.clear()
    // Restart background services for the new account
    startEventSubscription()

    // Re-point the agents at the new account: re-enrolling hands the daemon the
    // new credentials, and its install step rewrites the sealgate entry
    // with the new URL and key. Without this the configs would keep the
    // previous account's.
    const reEnrolled = await bootstrapDetectord().catch((err) => {
      console.error('[accounts:switch] Failed to update MCP integrations:', err)
      return null
    })
    const agentsRepointed = reEnrolled?.applied === true

    // Re-point the daemon at the new account (or stop it) so it doesn't keep
    // tunneling under the old credentials.
    await reprovisionStdiodForActiveAccount()

    if (!agentsRepointed) {
      // `ok` stays true and that is deliberate: the switch DID happen. Persisted
      // setup, the event subscription and stdiod are all on the new account, and
      // the renderer bails out of its reload on `ok: false` - reporting failure
      // here would leave the window showing the account we already left, with
      // the outgoing installation credential never revoked. The partial failure
      // is a separate fact, so it gets a separate field.
      await warnAgentsNotRepointed('the new account', reEnrolled?.reason)
    }

    return { ok: true, agentsRepointed, ...(agentsRepointed ? {} : { reason: reEnrolled?.reason }) }
  })

  ipcMain.handle('accounts:remove', (_event, userId: string) => {
    try {
      removeAccount(userId)
    } catch {
      // best-effort; non-critical feature
    }
    return { ok: true }
  })

  // Approval IPC from approval window
  ipcMain.handle('approval:approve', async (_event, approvalId: string) => {
    await handleApproval(approvalId, 'approve')
  })

  ipcMain.handle('approval:deny', async (_event, approvalId: string) => {
    await handleApproval(approvalId, 'deny')
  })

  // Renderer reports its content height so the window can fit the approval list.
  ipcMain.on('approval:resize', (_event, contentHeight: number) => {
    resizeApprovalWindow(contentHeight)
  })

  // Server health check
  ipcMain.handle('menu:check-health', async () => {
    return getIsServerOnline()
  })

  // Shell operations
  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    await shell.openExternal(url)
  })

  // Open feedback window from renderer
  ipcMain.handle('menu:openFeedback', () => {
    showFeedbackWindow()
  })

  // Resize the main window (used by post-setup menu to shrink to content size)
  ipcMain.handle('menu:resizeWindow', (_event, width: number, height: number) => {
    const mainWindow = getMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setMinimumSize(Math.min(width, 480), Math.min(height, 300))
      mainWindow.setSize(width, height, true)
      mainWindow.center()
    }
  })

  // Get app version
  ipcMain.handle('menu:getVersion', () => {
    return app.getVersion()
  })

  // Auto-update: state, manual check/download/install, and settings.
  ipcMain.handle('update:getState', () => getUpdateState())
  ipcMain.handle('update:check', () => checkForUpdates())
  ipcMain.handle('update:download', () => downloadUpdate())
  ipcMain.handle('update:install', () => quitAndInstall())
  ipcMain.handle('update:getSettings', () => getUpdateSettings())
  ipcMain.handle(
    'update:setSettings',
    (_event, patch: { autoDownload?: boolean; autoInstallOnQuit?: boolean }) =>
      setUpdateSettings(patch)
  )

  // Get MCP config as VSCode JSON
  ipcMain.handle('menu:getMcpConfig', () => {
    return getMcpConfig()
  })

  // Get raw MCP URL
  ipcMain.handle('menu:getMcpUrl', () => {
    return getMcpUrl()
  })

  // MCP: which agents are installed. The daemon probes for them - it already
  // enumerates every agent, and the probe used to stat other apps' support
  // directories.
  ipcMain.handle('mcp:detectClients', async () => {
    const facts = await getAgentFacts()
    // Distinguish "no agents installed" from "nobody answered": the renderer
    // shows the daemon warning for the latter instead of an empty app list.
    if (!facts) return { clients: [], daemonUnavailable: true }
    const clients: Array<{ id: string; name: string; configPath: string; manageable: boolean }> = []
    for (const [id, f] of facts) {
      if (!f.installed) continue
      clients.push({
        id,
        name: CLIENT_DISPLAY[id]?.name ?? id,
        // A client with no local config gets an advisory label in place of the
        // path, saying where its MCP config actually lives.
        configPath: f.configPath ?? CLIENT_DISPLAY[id]?.configLabel ?? '',
        // Drives whether the wizard offers a checkbox at all: selecting a
        // client SealGate can't configure does nothing.
        manageable: f.manageable
      })
    }
    return { clients, daemonUnavailable: false }
  })

  // Daemon health: the renderer shows a persistent warning while it's down.
  ipcMain.handle('detectord:health', () => getDetectordHealth())
  // MCP discovery, submission, removal, and config management handlers
  registerMcpSubmitHandlers()

  // sealgate-stdiod daemon control (install / login / uninstall / status).
  registerStdiodHandlers()

  ipcMain.handle('mcp:getHookStatus', async () => {
    const claudeCodeMcpStatus = await checkClaudeCodeMcpConnection()
    try {
      const statuses = await getHookStatus(getMcpUrl(), getIsServerOnline(), claudeCodeMcpStatus)
      return { statuses, daemonUnavailable: false }
    } catch {
      // getHookStatus only fails when the daemon didn't answer, and it already
      // reported that to the health tracker. Say so rather than claiming every
      // client is unhooked.
      return { statuses: [], daemonUnavailable: true }
    }
  })

  // Debug window actions
  ipcMain.handle('debug:resetQuarantine', async () => {
    try {
      // The daemon quarantined them (it holds the records and the writers), so
      // it is what puts them back.
      const daemon = getDetectordClient()
      await daemon.connect()
      const result = await daemon.restoreQuarantined()
      return { success: true, restored: result.restored, errors: result.errors }
    } catch (err) {
      return {
        success: false,
        restored: 0,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })
}
