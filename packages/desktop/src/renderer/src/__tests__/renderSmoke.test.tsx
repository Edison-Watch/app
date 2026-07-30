// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import React from 'react'
import { render, screen, waitFor, cleanup } from '@testing-library/react'

import { installMockApi } from '../testing/mockApi'

// The personal-key card owns a backend round-trip and keychain state of its
// own. Stub it so these tests exercise EncryptionStep's own submit handling
// rather than re-testing the key flow.
vi.mock('../components/onboarding/PersonalKeyCard', () => ({
  default: ({ onReady }: { onReady: (raw: string, composite: string) => void }) => {
    React.useEffect(() => onReady('raw', 'user:KEY'), [onReady])
    return null
  }
}))
import AppsStep from '../components/onboarding/AppsStep'
import MainMenu from '../components/main/MainMenu'
import EncryptionStep from '../components/onboarding/EncryptionStep'

/**
 * Render smoke tests for the two views that talk to `window.api` hardest.
 *
 * These exist because an IPC shape change is invisible to the compiler on the
 * renderer side (`window.api` is cast, and the Storybook stub is hand-written):
 * `detectClients` returning an array where the component destructures an object
 * put `undefined.map(...)` inside an effect. That crashes the view, but only at
 * runtime - typecheck passed, unit tests passed, and Storybook still *built*.
 */

let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  installMockApi()
  // React logs render errors rather than rethrowing; fail loudly instead.
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  errorSpy.mockRestore()
})

/** Any React error boundary/render failure shows up here. */
function expectNoRenderErrors(): void {
  const errors = errorSpy.mock.calls.map((c) => String(c[0]))
  const crashes = errors.filter((e) => /is not a function|Cannot read propert|undefined/i.test(e))
  expect(crashes, `component threw during render:\n${crashes.join('\n')}`).toEqual([])
}

describe('AppsStep', () => {
  it('renders the clients the daemon reports', async () => {
    const api = installMockApi()
    ;(api.mcp as Record<string, unknown>).detectClients = async () => ({
      clients: [{ id: 'cursor', name: 'Cursor', configPath: '/home/u/.cursor/mcp.json' }],
      daemonUnavailable: false
    })

    render(<AppsStep onNext={() => {}} />)

    expect(await screen.findByText('Cursor')).toBeTruthy()
    expectNoRenderErrors()
  })

  it('says the daemon is unreachable instead of "no clients" during an outage', async () => {
    const api = installMockApi()
    const mcp = api.mcp as Record<string, unknown>
    // A real outage fails both calls. Mocking only one describes a world that
    // can't happen, and the later success would (correctly) clear the flag -
    // the component reflects the most recent evidence.
    mcp.detectClients = async () => ({ clients: [], daemonUnavailable: true })
    mcp.discover = async () => ({ servers: [], unsupported: [], daemonUnavailable: true })

    render(<AppsStep onNext={() => {}} />)

    await waitFor(() => {
      expect(screen.getByText(/detector daemon is unreachable/i)).toBeTruthy()
    })
    expect(screen.queryByText(/No MCP clients detected/i)).toBeNull()
    expectNoRenderErrors()
  })

  it('reports no clients when the daemon answers with an empty list', async () => {
    render(<AppsStep onNext={() => {}} />)
    await waitFor(() => {
      expect(screen.getByText(/No MCP clients detected/i)).toBeTruthy()
    })
    expectNoRenderErrors()
  })
})

describe('MainMenu', () => {
  it('renders without a crash on the api surface it touches', async () => {
    const api = installMockApi()
    ;(api.setup as Record<string, unknown>).getData = async () => ({
      completed: true,
      userEmail: 'a@b.c',
      mcpBaseUrl: 'https://mcp.example',
      apiBaseUrl: 'https://api.example'
    })

    render(<MainMenu />)

    await waitFor(() => expect(screen.getByText('Edison Watch')).toBeTruthy())
    expectNoRenderErrors()
  })

  it('shows the degraded banner when the daemon is down', async () => {
    const api = installMockApi()
    ;(api.setup as Record<string, unknown>).getData = async () => ({ completed: true })
    ;(api.detectord as Record<string, unknown>).health = async () => ({
      ok: false,
      kind: 'unreachable',
      message: 'Degraded: the agent and MCP detection daemon is not running.',
      since: 0
    })

    render(<MainMenu />)

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/Degraded/i)
    })
    expectNoRenderErrors()
  })
})

describe('EncryptionStep', () => {
  const props = {
    mcpBaseUrl: 'https://mcp.example',
    apiBaseUrl: 'https://api.example',
    apiKey: 'ew_key',
    userId: 'u1',
    selectedApps: ['cursor'],
    discoveredServers: [],
    autoQuarantine: false
  }

  it('does not advance when the apps could not be configured', async () => {
    const api = installMockApi()
    ;(api.mcp as Record<string, unknown>).applyAppIntegrations = async () => ({
      success: false,
      modifiedConfigs: [],
      errors: ["cursor: couldn't reach the detector daemon"]
    })
    const onNext = vi.fn()

    render(<EncryptionStep {...props} onNext={onNext} />)
    ;(await screen.findByRole('button', { name: /Configure 1 App/i })).click()

    await waitFor(() => {
      expect(screen.getByText(/couldn't reach the detector daemon/i)).toBeTruthy()
    })
    // Finish reports the setup as done; getting there on a failed apply tells
    // the user their apps route through Edison Watch when none of them do.
    expect(onNext).not.toHaveBeenCalled()
    expectNoRenderErrors()
  })

  it('advances when the apps were configured', async () => {
    const api = installMockApi()
    ;(api.mcp as Record<string, unknown>).applyAppIntegrations = async () => ({
      success: true,
      modifiedConfigs: [{ appId: 'cursor', configPath: '/home/u/.cursor/mcp.json', backupPath: '' }]
    })
    const onNext = vi.fn()

    render(<EncryptionStep {...props} onNext={onNext} />)
    ;(await screen.findByRole('button', { name: /Configure 1 App/i })).click()

    await waitFor(() => expect(onNext).toHaveBeenCalledTimes(1))
    expectNoRenderErrors()
  })
})
