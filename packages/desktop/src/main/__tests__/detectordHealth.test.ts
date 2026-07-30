import { describe, it, expect, beforeEach, vi } from 'vitest'

// The daemon binary is what `classify` probes for to tell a packaging fault
// ("binary missing") from a runtime one ("nothing listening").
let binaryExists = true

const showMessageBox = vi.fn(() => Promise.resolve({ response: 1 }))
const quit = vi.fn()

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  dialog: { showMessageBox: (...args: unknown[]) => showMessageBox(...(args as [])) },
  app: { isReady: () => true, whenReady: () => Promise.resolve(), quit: () => quit() }
}))

vi.mock('../detectord/binary', () => ({
  detectordBinaryExists: () => binaryExists,
  getDetectordBinaryPath: () => '/Applications/Edison Watch.app/Contents/Resources/bin/edison-detectord'
}))

import {
  getDetectordHealth,
  onDetectordHealthChange,
  reportDetectordFailure,
  reportDetectordOk
} from '../detectord/health'

describe('detectord health', () => {
  beforeEach(() => {
    binaryExists = true
    showMessageBox.mockClear()
    quit.mockClear()
    reportDetectordOk()
  })

  it('starts healthy', () => {
    expect(getDetectordHealth().ok).toBe(true)
  })

  // NOTE: the once-per-session latch lives in the module, so this must be the
  // only test that drives a missing-binary failure - a second one would see
  // no dialog and prove nothing.
  it('pops a dialog once per session when the daemon is absent - a broken install, not a hiccup', () => {
    binaryExists = false
    reportDetectordFailure('bootstrap', new Error('connect ENOENT'))
    reportDetectordOk()
    reportDetectordFailure('list_servers', new Error('connect ENOENT'))

    expect(showMessageBox).toHaveBeenCalledTimes(1)
    const options = showMessageBox.mock.calls[0]!.at(-1) as unknown as {
      type: string
      message: string
      detail: string
      buttons: string[]
    }
    expect(options.type).toBe('error')
    expect(options.message).toMatch(/missing/i)
    // Quit is the default: an app that can't protect anything shouldn't imply
    // it is by sitting there.
    expect(options.buttons[0]).toBe('Quit')
    expect(options.detail).toContain('edison-detectord')
  })

  it('does NOT pop a dialog for a merely unreachable daemon - that one is often transient', () => {
    reportDetectordFailure('list_servers', new Error('connect ECONNREFUSED'))
    expect(showMessageBox).not.toHaveBeenCalled()
  })

  it('classifies a refused socket as unreachable, with a message the UI can show', () => {
    reportDetectordFailure('list_servers', new Error('connect ECONNREFUSED /tmp/daemon.sock'))
    const h = getDetectordHealth()
    expect(h.ok).toBe(false)
    expect(h.kind).toBe('unreachable')
    // One short line: the banner shows this verbatim.
    expect(h.message).toMatch(/^Degraded: .*not running\.$/)
    // The raw error is kept for logs/debug, separate from the user-facing line.
    expect(h.detail).toContain('ECONNREFUSED')
  })

  it('calls out a missing binary separately - that one is a packaging fault', () => {
    binaryExists = false
    reportDetectordFailure('bootstrap', new Error('connect ENOENT'))
    const h = getDetectordHealth()
    expect(h.kind).toBe('missing-binary')
    expect(h.message).toMatch(/^Degraded: .*missing\.$/)
  })

  it('treats a daemon-side refusal as an error, not as unreachable', () => {
    reportDetectordFailure('apply_integrations', new Error('not enrolled'))
    expect(getDetectordHealth().kind).toBe('error')
  })

  it('recovers on the next successful call', () => {
    reportDetectordFailure('list_agents', new Error('connect ECONNREFUSED'))
    expect(getDetectordHealth().ok).toBe(false)
    reportDetectordOk()
    expect(getDetectordHealth().ok).toBe(true)
  })

  it('keeps `since` at the start of an outage across repeated failures', async () => {
    reportDetectordFailure('list_agents', new Error('connect ECONNREFUSED'))
    const first = getDetectordHealth().since
    await new Promise((r) => setTimeout(r, 5))
    reportDetectordFailure('list_servers', new Error('connect ECONNREFUSED again'))
    expect(getDetectordHealth().since).toBe(first)
  })

  it('notifies listeners when the state changes, not on every repeat', () => {
    const seen: boolean[] = []
    const off = onDetectordHealthChange((h) => seen.push(h.ok))
    reportDetectordFailure('list_agents', new Error('connect ECONNREFUSED'))
    reportDetectordFailure('list_agents', new Error('connect ECONNREFUSED'))
    reportDetectordOk()
    reportDetectordOk()
    off()
    expect(seen).toEqual([false, true])
  })
})
