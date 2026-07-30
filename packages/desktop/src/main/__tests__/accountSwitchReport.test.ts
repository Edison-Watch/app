import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * Switching accounts changes credentials, so `applied` - not `ok` - is what
 * says the MCP clients on the machine were re-pointed. When re-enrollment
 * fails, the app is on the new account while every agent still carries the
 * previous account's URL and key: the user's traffic keeps routing through the
 * account they just left, and nothing on screen says so.
 *
 * The report has to keep two facts apart, because they really can differ:
 *
 *   ok               - the switch happened (persisted setup, subscription, stdiod)
 *   agentsRepointed  - the agents followed it
 *
 * Collapsing them either way causes a bug. Reporting `ok: false` on a failed
 * re-enrollment is not a safe default: MainMenu returns early on `!ok` and
 * skips its reload, so the window would keep showing the account the main
 * process has already left, and the outgoing installation credential would
 * never be revoked.
 */

const ipcHandlers = new Map<string, (...args: unknown[]) => unknown>()

let applied = true
let bootstrapThrows = false

// vi.mock factories are hoisted above the module body, so the spies they close
// over have to be hoisted with them.
const { warnAgentsNotRepointed, reprovision } = vi.hoisted(() => ({
  warnAgentsNotRepointed: vi.fn(() => Promise.resolve()),
  reprovision: vi.fn(() => Promise.resolve())
}))

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', isReady: () => true, whenReady: () => Promise.resolve() },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: { showMessageBox: () => Promise.resolve({ response: 0 }) },
  safeStorage: { isEncryptionAvailable: () => false },
  shell: { openExternal: () => Promise.resolve() },
  ipcMain: {
    handle: (ch: string, fn: (...a: unknown[]) => unknown) => ipcHandlers.set(ch, fn),
    on: (ch: string, fn: (...a: unknown[]) => unknown) => ipcHandlers.set(ch, fn)
  }
}))

vi.mock('../detectord/bootstrap', () => ({
  bootstrapDetectord: () => {
    if (bootstrapThrows) return Promise.reject(new Error('daemon exploded'))
    return Promise.resolve(
      applied ? { ok: true, applied: true } : { ok: true, applied: false, reason: 'backend unreachable' }
    )
  },
  setDetectordSecret: () => Promise.resolve({ ok: true }),
  warnAgentsNotRepointed
}))

vi.mock('../infra/setupConfig', async () => {
  const actual = { ALL_SUPPORTED_APPS: [], DRY_RUN: false, ENV_DOCS_URL: '' }
  return {
    ...actual,
    getSetupData: () => ({ userId: 'old-user' }),
    switchToAccount: () => ({ userId: 'new-user', userEmail: 'new@example.com' }),
    getSavedAccounts: () => [],
    removeAccount: () => {},
    getActiveEnv: () => 'dev',
    getApiBaseUrl: () => 'https://api.example',
    getMcpBaseUrl: () => 'https://mcp.example',
    getMcpConfig: () => null,
    getMcpUrl: () => null,
    getIsServerOnline: () => true,
    checkClaudeCodeMcpConnection: () => Promise.resolve(false),
    markSetupComplete: () => {},
    markSetupIncomplete: () => {},
    getCredentialsForEnv: () => ({ apiKey: 'k' })
  }
})

vi.mock('../stdiod/accountSwitch', () => ({
  reprovisionStdiodForActiveAccount: reprovision,
  teardownStdiodForSignOut: () => Promise.resolve()
}))

vi.mock('./ipcHandlersMcpSubmit', () => ({ registerMcpSubmitHandlers: () => {} }))
vi.mock('./ipcHandlersStdiod', () => ({ registerStdiodHandlers: () => {} }))
vi.mock('../ipc/ipcHandlersMcpSubmit', () => ({ registerMcpSubmitHandlers: () => {} }))
vi.mock('../ipc/ipcHandlersStdiod', () => ({ registerStdiodHandlers: () => {} }))
vi.mock('../runtime/hookStatus', () => ({ getHookStatus: () => Promise.resolve([]) }))
vi.mock('../detectord/integrations', () => ({
  applyIntegrations: () => Promise.resolve([]),
  integrationErrors: () => []
}))
vi.mock('../detectord/agents', () => ({ getAgentFacts: () => Promise.resolve(null) }))
vi.mock('../detectord/health', () => ({ getDetectordHealth: () => ({ ok: true, since: 0 }) }))
vi.mock('../detectord/lifecycle', () => ({ getDetectordClient: () => ({}) }))
vi.mock('../detectord/controller', () => ({ uninstallService: () => Promise.resolve({ code: 0 }) }))
vi.mock('../clients/displayMeta', () => ({ CLIENT_DISPLAY: {} }))
vi.mock('../infra/updateManager', () => ({
  getUpdateState: () => ({}),
  checkForUpdates: () => Promise.resolve({}),
  downloadUpdate: () => Promise.resolve(),
  quitAndInstall: () => {},
  getSettings: () => ({}),
  updateSettings: () => ({})
}))
vi.mock('../dialogs/feedbackWindow', () => ({ showFeedbackWindow: () => {} }))
vi.mock('./approvalsHandler', () => ({
  handleApproval: () => Promise.resolve(),
  pendingApprovals: new Map(),
  resizeApprovalWindow: () => {}
}))

import { registerIpcHandlers } from '../ipc/ipcHandlers'

interface SwitchResult {
  ok: boolean
  agentsRepointed?: boolean
  reason?: string
}

async function invokeSwitch(): Promise<SwitchResult> {
  const handler = ipcHandlers.get('accounts:switch')
  if (!handler) throw new Error('accounts:switch was never registered')
  return (await handler({}, 'new-user')) as SwitchResult
}

describe('accounts:switch reporting', () => {
  beforeEach(() => {
    applied = true
    bootstrapThrows = false
    ipcHandlers.clear()
    warnAgentsNotRepointed.mockClear()
    reprovision.mockClear()
    registerIpcHandlers({
      getMainWindow: () => null,
      getAuthLoopbackUrl: () => null,
      createTray: () => {},
      startEventSubscription: () => {}
    })
  })

  it('reports the agents as re-pointed when re-enrollment applied', async () => {
    const r = await invokeSwitch()
    expect(r).toMatchObject({ ok: true, agentsRepointed: true })
    expect(warnAgentsNotRepointed).not.toHaveBeenCalled()
  })

  it('reports agentsRepointed:false with a reason when re-enrollment did not apply', async () => {
    applied = false
    const r = await invokeSwitch()
    expect(r.agentsRepointed).toBe(false)
    expect(r.reason).toBe('backend unreachable')
  })

  it('reports agentsRepointed:false when bootstrap throws outright', async () => {
    bootstrapThrows = true
    const r = await invokeSwitch()
    expect(r.agentsRepointed).toBe(false)
  })

  it('tells the user their apps still use the old account', async () => {
    applied = false
    await invokeSwitch()
    // A console line does not reach the user, and MainMenu reloads the renderer
    // immediately after the switch - only a main-process dialog survives that.
    expect(warnAgentsNotRepointed).toHaveBeenCalledTimes(1)
  })

  it('keeps ok:true so the renderer completes the switch it already made', async () => {
    applied = false
    const r = await invokeSwitch()
    // MainMenu: `if (!result.ok) { setSwitching(false); return }` - skipping the
    // reload would strand the window on the account the main process just left.
    expect(r.ok).toBe(true)
    // ...and the daemon still gets re-pointed regardless of the enroll outcome.
    expect(reprovision).toHaveBeenCalledTimes(1)
  })

  it('does no work when the target account is already active', async () => {
    const handler = ipcHandlers.get('accounts:switch')
    const r = (await handler?.({}, 'old-user')) as SwitchResult
    expect(r).toEqual({ ok: true })
    expect(reprovision).not.toHaveBeenCalled()
  })
})
