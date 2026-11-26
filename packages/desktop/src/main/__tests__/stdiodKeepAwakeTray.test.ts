// The tray's "Keep Awake When Plugged In" submenu writes the daemon's local
// keep-awake choice. It must appear only when the daemon reports keep-awake
// state, mark the current local choice, and write the clicked choice.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MenuItemConstructorOptions } from 'electron'

import type { StdiodKeepAwake, StdiodStatus } from '../stdiod/types'

let status: StdiodStatus
const { setKeepAwake, pendingKeepAwake, notify } = vi.hoisted(() => ({
  setKeepAwake: vi.fn(() => Promise.resolve<{ ok: boolean; errorMessage?: string }>({ ok: true })),
  pendingKeepAwake: vi.fn((): string | null => null),
  notify: vi.fn()
}))

vi.mock('electron', () => ({
  clipboard: {},
  shell: {},
  Notification: Object.assign(
    function (this: { show: () => void }, options: unknown) {
      this.show = () => notify(options)
    },
    { isSupported: () => true }
  )
}))
vi.mock('../stdiod/trayCache', () => ({
  getCachedStdiodStatus: () => status,
  refreshStdiodStatusCache: () => Promise.resolve(status)
}))
vi.mock('../stdiod/keepAwake', () => ({ setKeepAwake, pendingKeepAwake }))
vi.mock('../stdiod/stdiodLog', () => ({ getStdiodLogDir: () => '/tmp' }))

import { buildStdiodMenuItems } from '../stdiod/trayMenu'

function installedStatus(keepAwake?: StdiodKeepAwake): StdiodStatus {
  return {
    binaryAvailable: true,
    installed: true,
    loggedIn: true,
    stateAgeMs: 0,
    state: {
      connection_state: 'connected',
      backend_url: 'http://localhost:3001',
      device_id: 'dev-1',
      device_label: 'Laptop',
      last_connected_at: null,
      last_error: null,
      servers: [],
      generation: 1,
      ...(keepAwake ? { keep_awake: keepAwake } : {})
    }
  }
}

function keepAwakeItem(items: MenuItemConstructorOptions[]): MenuItemConstructorOptions | undefined {
  return items.find((item) => item.label === 'Keep Awake When Plugged In')
}

const realPlatform = process.platform

function setPlatform(platform: string): void {
  Object.defineProperty(process, 'platform', { value: platform })
}

describe('keep-awake tray submenu', () => {
  beforeEach(() => {
    setKeepAwake.mockClear()
    pendingKeepAwake.mockReturnValue(null)
    notify.mockClear()
    setPlatform('win32')
  })

  afterEach(() => {
    setPlatform(realPlatform)
  })

  it('is absent on macOS and Linux, even with a stale state value', () => {
    status = installedStatus({ local: 'on', desired: true, effective: 'active' })
    for (const platform of ['darwin', 'linux']) {
      setPlatform(platform)
      expect(keepAwakeItem(buildStdiodMenuItems('/icon.png'))).toBeUndefined()
    }
  })

  it('is absent when the daemon reports no keep-awake state', () => {
    status = installedStatus()
    expect(keepAwakeItem(buildStdiodMenuItems('/icon.png'))).toBeUndefined()
  })

  it('marks the local choice and shows the dashboard value and the state', () => {
    status = installedStatus({ local: 'auto', desired: true, effective: 'active' })
    const submenu = keepAwakeItem(buildStdiodMenuItems('/icon.png'))
      ?.submenu as MenuItemConstructorOptions[]
    expect(submenu.find((item) => item.checked)?.label).toBe('Follow dashboard (on)')
    expect(submenu.at(-1)?.label).toBe('Now: keeping this computer awake')
  })

  it('shows a choice the daemon has not applied yet', () => {
    status = installedStatus({ local: 'auto', desired: false, effective: 'inactive' })
    pendingKeepAwake.mockReturnValue('on')
    const submenu = keepAwakeItem(buildStdiodMenuItems('/icon.png'))
      ?.submenu as MenuItemConstructorOptions[]
    expect(submenu.find((item) => item.checked)?.label).toBe('On')
  })

  it('shows a notification when the change fails', async () => {
    status = installedStatus({ local: 'auto', desired: false, effective: 'inactive' })
    setKeepAwake.mockResolvedValueOnce({ ok: false, errorMessage: 'config.toml is read-only' })
    const submenu = keepAwakeItem(buildStdiodMenuItems('/icon.png'))
      ?.submenu as MenuItemConstructorOptions[]
    submenu.find((item) => item.label === 'Off')?.click?.({} as never, undefined, {} as never)
    await vi.waitFor(() => expect(notify).toHaveBeenCalled())
    expect(JSON.stringify(notify.mock.calls[0]?.[0])).toContain('config.toml is read-only')
  })

  it('writes the clicked choice', () => {
    status = installedStatus({ local: 'auto', desired: false, effective: 'inactive' })
    const submenu = keepAwakeItem(buildStdiodMenuItems('/icon.png'))
      ?.submenu as MenuItemConstructorOptions[]
    const on = submenu.find((item) => item.label === 'On')
    on?.click?.({} as never, undefined, {} as never)
    expect(setKeepAwake).toHaveBeenCalledWith('on')
  })
})
