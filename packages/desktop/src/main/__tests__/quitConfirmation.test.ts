import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Electron mock: capture the before-quit handler and drive the dialog result.
const appOnMock = vi.fn()
const appQuitMock = vi.fn()
const showMessageBoxMock = vi.fn<(opts: unknown) => Promise<{ response: number }>>()
vi.mock('electron', () => ({
  app: { on: (...args: unknown[]) => appOnMock(...args), quit: () => appQuitMock() },
  dialog: { showMessageBox: (opts: unknown) => showMessageBoxMock(opts) }
}))

let apiBaseUrl: string | null = 'https://api.example.test'
let creds: { apiKey: string } | null = { apiKey: 'sg-key' }
vi.mock('../infra/setupConfig', () => ({
  getApiBaseUrl: () => apiBaseUrl,
  getCredentialsForEnv: () => creds
}))

const fetchAutoQuarantineEnabledMock = vi.fn<() => Promise<boolean>>()
vi.mock('../infra/domainConfig', () => ({
  fetchAutoQuarantineEnabled: () => fetchAutoQuarantineEnabledMock()
}))

const realPlatform = process.platform
function setPlatform(platform: string): void {
  Object.defineProperty(process, 'platform', { value: platform })
}

type QuitConfirmationModule = typeof import('../runtime/quitConfirmation')

async function loadModule(): Promise<QuitConfirmationModule> {
  // Fresh module per test so the quitConfirmed/confirmationInFlight state resets.
  vi.resetModules()
  return await import('../runtime/quitConfirmation')
}

function getBeforeQuitHandler(): ((event: { preventDefault: () => void }) => void) | undefined {
  const call = appOnMock.mock.calls.find(([event]) => event === 'before-quit')
  return call?.[1] as ((event: { preventDefault: () => void }) => void) | undefined
}

async function flushAsync(): Promise<void> {
  // Enough microtask/macrotask turns for confirmQuit's awaits to settle.
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve))
}

describe('quitConfirmation', () => {
  beforeEach(() => {
    appOnMock.mockReset()
    appQuitMock.mockReset()
    showMessageBoxMock.mockReset()
    fetchAutoQuarantineEnabledMock.mockReset().mockResolvedValue(false)
    apiBaseUrl = 'https://api.example.test'
    creds = { apiKey: 'sg-key' }
    setPlatform('darwin')
  })

  afterEach(() => {
    setPlatform(realPlatform)
  })

  it('does nothing on non-macOS platforms', async () => {
    setPlatform('win32')
    const mod = await loadModule()
    mod.initQuitConfirmation()
    expect(appOnMock).not.toHaveBeenCalled()
  })

  it('prevents the quit and does not quit when the user cancels', async () => {
    showMessageBoxMock.mockResolvedValue({ response: 0 })
    const mod = await loadModule()
    mod.initQuitConfirmation()
    const handler = getBeforeQuitHandler()
    expect(handler).toBeDefined()

    const preventDefault = vi.fn()
    handler!({ preventDefault })
    await flushAsync()

    expect(preventDefault).toHaveBeenCalled()
    expect(showMessageBoxMock).toHaveBeenCalledTimes(1)
    expect(appQuitMock).not.toHaveBeenCalled()
  })

  it('re-quits once confirmed and lets the second before-quit through', async () => {
    showMessageBoxMock.mockResolvedValue({ response: 1 })
    const mod = await loadModule()
    mod.initQuitConfirmation()
    const handler = getBeforeQuitHandler()!

    const first = vi.fn()
    handler({ preventDefault: first })
    await flushAsync()
    expect(first).toHaveBeenCalled()
    expect(appQuitMock).toHaveBeenCalledTimes(1)

    // The app.quit() we issued fires before-quit again; it must pass through.
    const second = vi.fn()
    handler({ preventDefault: second })
    expect(second).not.toHaveBeenCalled()
  })

  it('does not stack dialogs while a confirmation is already showing', async () => {
    let resolveDialog: (value: { response: number }) => void = () => {}
    showMessageBoxMock.mockReturnValue(
      new Promise<{ response: number }>((resolve) => {
        resolveDialog = resolve
      })
    )
    const mod = await loadModule()
    mod.initQuitConfirmation()
    const handler = getBeforeQuitHandler()!

    handler({ preventDefault: vi.fn() })
    await flushAsync()
    handler({ preventDefault: vi.fn() })
    await flushAsync()
    expect(showMessageBoxMock).toHaveBeenCalledTimes(1)

    resolveDialog({ response: 0 })
    await flushAsync()
    expect(appQuitMock).not.toHaveBeenCalled()
  })

  it('mentions quarantine only when the org has it enabled', async () => {
    fetchAutoQuarantineEnabledMock.mockResolvedValue(true)
    showMessageBoxMock.mockResolvedValue({ response: 0 })
    const mod = await loadModule()
    mod.initQuitConfirmation()
    getBeforeQuitHandler()!({ preventDefault: vi.fn() })
    await flushAsync()

    const opts = showMessageBoxMock.mock.lastCall?.[0] as { detail: string }
    expect(opts.detail).toContain(mod.QUIT_BASE_DETAIL)
    expect(opts.detail).toContain(mod.QUIT_QUARANTINE_DETAIL)
    expect(mod.buildQuitConfirmationDetail(false)).not.toContain(mod.QUIT_QUARANTINE_DETAIL)
  })

  it('treats missing credentials as quarantine off without calling the backend', async () => {
    creds = null
    showMessageBoxMock.mockResolvedValue({ response: 0 })
    const mod = await loadModule()
    mod.initQuitConfirmation()
    getBeforeQuitHandler()!({ preventDefault: vi.fn() })
    await flushAsync()

    expect(fetchAutoQuarantineEnabledMock).not.toHaveBeenCalled()
    const opts = showMessageBoxMock.mock.lastCall?.[0] as { detail: string }
    expect(opts.detail).not.toContain(mod.QUIT_QUARANTINE_DETAIL)
  })

  it('bypassQuitConfirmation skips the dialog entirely', async () => {
    const mod = await loadModule()
    mod.initQuitConfirmation()
    mod.bypassQuitConfirmation()

    const preventDefault = vi.fn()
    getBeforeQuitHandler()!({ preventDefault })
    await flushAsync()

    expect(preventDefault).not.toHaveBeenCalled()
    expect(showMessageBoxMock).not.toHaveBeenCalled()
  })

  it('bypass is one-shot: the quit after a bypassed quit asks again', async () => {
    showMessageBoxMock.mockResolvedValue({ response: 0 })
    const mod = await loadModule()
    mod.initQuitConfirmation()
    const handler = getBeforeQuitHandler()!

    mod.bypassQuitConfirmation()
    handler({ preventDefault: vi.fn() })

    const preventDefault = vi.fn()
    handler({ preventDefault })
    await flushAsync()
    expect(preventDefault).toHaveBeenCalled()
    expect(showMessageBoxMock).toHaveBeenCalledTimes(1)
  })

  it('resetQuitConfirmationBypass disarms a pending bypass', async () => {
    showMessageBoxMock.mockResolvedValue({ response: 0 })
    const mod = await loadModule()
    mod.initQuitConfirmation()

    mod.bypassQuitConfirmation()
    mod.resetQuitConfirmationBypass()

    const preventDefault = vi.fn()
    getBeforeQuitHandler()!({ preventDefault })
    await flushAsync()
    expect(preventDefault).toHaveBeenCalled()
    expect(showMessageBoxMock).toHaveBeenCalledTimes(1)
  })

  it('quits without confirmation if the dialog itself fails', async () => {
    showMessageBoxMock.mockRejectedValue(new Error('dialog broken'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const mod = await loadModule()
    mod.initQuitConfirmation()

    getBeforeQuitHandler()!({ preventDefault: vi.fn() })
    await flushAsync()

    expect(appQuitMock).toHaveBeenCalledTimes(1)
    consoleError.mockRestore()
  })
})
