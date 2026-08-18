// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import React from 'react'
import { render, screen, waitFor, cleanup, act, fireEvent, within } from '@testing-library/react'

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
import { POLL_DENIED_MS, POLL_UNKNOWN_MS } from '../components/FullDiskAccessBanner'
import ClientsView from '../components/main/ClientsView'
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
      clients: [
        { id: 'cursor', name: 'Cursor', configPath: '/home/u/.cursor/mcp.json', manageable: true }
      ],
      daemonUnavailable: false
    })

    render(<AppsStep onNext={() => {}} />)

    expect(await screen.findByText('Cursor')).toBeTruthy()
    expectNoRenderErrors()
  })

  it('offers no selection for a client it cannot configure', async () => {
    // A checked checkbox whose value is thrown away downstream told the user
    // ChatGPT was about to be configured, and inflated the "Configure N Apps"
    // count on the next step by one.
    const api = installMockApi()
    ;(api.mcp as Record<string, unknown>).detectClients = async () => ({
      clients: [
        { id: 'cursor', name: 'Cursor', configPath: '/home/u/.cursor/mcp.json', manageable: true },
        { id: 'chatgpt', name: 'ChatGPT', configPath: 'Connectors', manageable: false }
      ],
      daemonUnavailable: false
    })

    render(<AppsStep onNext={() => {}} />)

    // Shown, and shown as unprotected - not quietly dropped from the list.
    expect(await screen.findByText('ChatGPT')).toBeTruthy()
    expect(screen.getByText(/not protected/i)).toBeTruthy()
    // Only Cursor is selectable, so only Cursor is counted.
    await waitFor(() => {
      expect(screen.getByText(/Continue with 1 App$/)).toBeTruthy()
    })
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

    await waitFor(() => expect(screen.getByText('SealGate')).toBeTruthy())
    expectNoRenderErrors()
  })

  it('shows the degraded banner when the daemon is down', async () => {
    const api = installMockApi()
    ;(api.setup as Record<string, unknown>).getData = async () => ({ completed: true, userEmail: 'a@b.c' })
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

  it('asks for Full Disk Access when the daemon reports it denied', async () => {
    const api = installMockApi()
    ;(api.setup as Record<string, unknown>).getData = async () => ({ completed: true, userEmail: 'a@b.c' })
    ;(api.detectord as Record<string, unknown>).fullDiskAccess = async () => ({
      state: 'denied',
      binaryPath: '/Applications/SealGate.app/Contents/Resources/bin/sealgate-detectord'
    })

    render(<MainMenu />)

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/Full Disk Access/i)
    })
    expectNoRenderErrors()
  })

  // 'unknown' is what a down or pre-field daemon reports. Showing a permissions
  // banner then would nag during any routine daemon restart, so it must stay
  // silent - this is the case the tri-state exists for.
  it('stays silent when Full Disk Access is unknown', async () => {
    const api = installMockApi()
    ;(api.setup as Record<string, unknown>).getData = async () => ({ completed: true, userEmail: 'a@b.c' })
    let calls = 0
    ;(api.detectord as Record<string, unknown>).fullDiskAccess = async () => {
      calls += 1
      return { state: 'unknown', binaryPath: '/tmp/sealgate-detectord' }
    }

    render(<MainMenu />)

    await waitFor(() => expect(screen.getByText('SealGate')).toBeTruthy())
    // The banner holds `info === null` until its first poll RESOLVES, and
    // renders nothing in that state. Asserting absence before then would pass
    // for any state at all - including a `denied` that simply hadn't arrived -
    // so wait for the call to land and for React to commit the resulting
    // setInfo. Only then is the assertion below about how `unknown` is
    // handled rather than about timing.
    await waitFor(() => expect(calls).toBeGreaterThan(0))
    await act(async () => {})

    expect(screen.queryByRole('alert')).toBeNull()
    expectNoRenderErrors()
  })

  // Before sign-in there is no enrollment and nothing to detect, so a
  // permissions warning is noise on a sign-in screen - and it asks for a
  // system-wide grant before the user has committed to the app. Asserted on the
  // call count as well as the absent banner: without the gate the banner would
  // still be absent for a beat, but the poll would have fired.
  it('does not ask for Full Disk Access before the user signs in', async () => {
    const api = installMockApi()
    ;(api.setup as Record<string, unknown>).getData = async () => ({ completed: true })
    let calls = 0
    ;(api.detectord as Record<string, unknown>).fullDiskAccess = async () => {
      calls += 1
      return { state: 'denied', binaryPath: '/tmp/sealgate-detectord' }
    }

    render(<MainMenu />)

    await waitFor(() => expect(screen.getByText('SealGate')).toBeTruthy())
    expect(calls).toBe(0)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText(/Detection is degraded/i)).toBeNull()
    expectNoRenderErrors()
  })

  // Signed in and denied: the banner is the standing reminder, and the modal is
  // the one-time nudge on top of it.
  it('prompts with a modal when a signed-in user has not granted access', async () => {
    const api = installMockApi()
    ;(api.setup as Record<string, unknown>).getData = async () => ({
      completed: true,
      userEmail: 'a@b.c'
    })
    ;(api.detectord as Record<string, unknown>).fullDiskAccess = async () => ({
      state: 'denied',
      binaryPath: '/Applications/SealGate.app/Contents/Resources/bin/sealgate-detectord'
    })

    render(<MainMenu />)

    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toMatch(/Grant Full Disk Access/i)
    // The path is the part the System Settings file picker hides, so it has to
    // be on screen to copy.
    expect(dialog.textContent).toMatch(/sealgate-detectord/)
    expectNoRenderErrors()
  })

  // Dismissing the modal must not dismiss the banner: the modal is a nudge, the
  // banner is the standing reminder that the grant is still missing.
  it('keeps the banner after the Full Disk Access modal is dismissed', async () => {
    const api = installMockApi()
    ;(api.setup as Record<string, unknown>).getData = async () => ({
      completed: true,
      userEmail: 'a@b.c'
    })
    ;(api.detectord as Record<string, unknown>).fullDiskAccess = async () => ({
      state: 'denied',
      binaryPath: '/tmp/sealgate-detectord'
    })

    render(<MainMenu />)

    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByText('Not now'))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByRole('alert').textContent).toMatch(/Detection is degraded/i)
    expectNoRenderErrors()
  })

  // `granted` is the steady state on a correctly configured machine, and every
  // poll costs an IPC round-trip plus a daemon status() that re-reads the
  // enrollment and quarantine files. So once granted, polling must STOP rather
  // than continue forever at the denied-state cadence.
  // Asserted via what the banner SCHEDULES rather than by advancing the clock:
  // the re-poll delays are seconds long, and fake timers do not compose cleanly
  // with RTL's async helpers here. `setTimeout` keeps its real implementation -
  // spyOn only records - so nothing else in the render is disturbed.
  it('stops polling once Full Disk Access is granted', async () => {
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    try {
      const api = installMockApi()
      ;(api.setup as Record<string, unknown>).getData = async () => ({ completed: true, userEmail: 'a@b.c' })
      let calls = 0
      ;(api.detectord as Record<string, unknown>).fullDiskAccess = async () => {
        calls += 1
        return { state: 'granted', binaryPath: '/tmp/sealgate-detectord' }
      }

      render(<MainMenu />)

      await waitFor(() => expect(calls).toBe(1))
      const delays = timeoutSpy.mock.calls.map((c) => c[1])
      expect(delays).not.toContain(POLL_DENIED_MS)
      expect(delays).not.toContain(POLL_UNKNOWN_MS)
    } finally {
      timeoutSpy.mockRestore()
    }
  })

  // The other half of the same contract: `denied` is the one state that must
  // keep re-polling, since the user is off in System Settings fixing it.
  it('keeps polling while Full Disk Access is denied', async () => {
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    try {
      const api = installMockApi()
      ;(api.setup as Record<string, unknown>).getData = async () => ({ completed: true, userEmail: 'a@b.c' })
      ;(api.detectord as Record<string, unknown>).fullDiskAccess = async () => ({
        state: 'denied',
        binaryPath: '/tmp/sealgate-detectord'
      })

      render(<MainMenu />)

      await waitFor(() =>
        expect(timeoutSpy.mock.calls.map((c) => c[1])).toContain(POLL_DENIED_MS)
      )
    } finally {
      timeoutSpy.mockRestore()
    }
  })

  // Full Disk Access is macOS-only, and the main-process handler answers a
  // constant `granted` off it. Polling there would be an IPC round-trip every
  // 5s, forever, for an answer that cannot change - so the effect must not even
  // start. Asserting on the call count rather than the absent banner, because
  // the banner is absent either way and would pass without the guard.
  it('does not poll for Full Disk Access off macOS', async () => {
    const api = installMockApi()
    ;(api.setup as Record<string, unknown>).getData = async () => ({ completed: true, userEmail: 'a@b.c' })
    ;(api as Record<string, unknown>).platform = 'win32'
    let calls = 0
    ;(api.detectord as Record<string, unknown>).fullDiskAccess = async () => {
      calls += 1
      return { state: 'granted', binaryPath: 'C:\\sealgate-detectord.exe' }
    }

    render(<MainMenu />)

    await waitFor(() => expect(screen.getByText('SealGate')).toBeTruthy())
    expect(calls).toBe(0)
    expectNoRenderErrors()
  })
})

describe('ClientsView', () => {
  const status = (over: Record<string, unknown>) => ({
    installed: true,
    hasHook: true,
    hookCount: 4,
    totalHooks: 4,
    mcpConnected: true,
    mcpConfigured: true,
    mcpApplicable: true,
    hooksApplicable: true,
    manageable: true,
    ...over
  })

  it('explains an unmanageable client it knows, and one it does not', async () => {
    // `manageable` is a capability the daemon can set on any client, so the
    // copy cannot assume ChatGPT's reason. An unrecognised id has to fall back
    // to what the flag alone guarantees rather than borrowing that wording.
    //
    // `constructor` is the unrecognised id on purpose: the ids are chosen by
    // the daemon, and an object lookup answers inherited keys as if they were
    // entries, so it would take a function where the fallback belongs.
    const api = installMockApi()
    ;(api.mcp as Record<string, unknown>).getHookStatus = async () => ({
      statuses: [
        status({ client: 'chatgpt', manageable: false, mcpApplicable: false, hooksApplicable: false }),
        status({ client: 'constructor', manageable: false, mcpApplicable: false, hooksApplicable: false })
      ],
      daemonUnavailable: false
    })

    render(<ClientsView />)

    expect(await screen.findByText(/Connectors are managed in your account/)).toBeTruthy()
    expect(screen.getByText(/^SealGate can't configure this app$/)).toBeTruthy()
    expectNoRenderErrors()
  })

  it('points a Claude host at Connectors rather than calling it unconfigurable', async () => {
    // Claude Desktop is unmanageable for a different reason than ChatGPT: it
    // does run local MCP servers, SealGate just has nowhere to install itself in
    // a config file that takes stdio entries only. So the copy names the manual
    // route that does work rather than borrowing ChatGPT's "it all lives in
    // your account" - and never the generic fallback, which offers nothing.
    const api = installMockApi()
    ;(api.mcp as Record<string, unknown>).getHookStatus = async () => ({
      statuses: [
        status({
          client: 'claude-desktop',
          manageable: false,
          mcpApplicable: false,
          hooksApplicable: false
        })
      ],
      daemonUnavailable: false
    })

    render(<ClientsView />)

    expect(await screen.findByText(/Add SealGate as a connector/)).toBeTruthy()
    expect(screen.queryByText('Connected')).toBeNull()
    expect(screen.queryByText(/^SealGate can't configure this app$/)).toBeNull()
    expectNoRenderErrors()
  })

  it('still refuses to say Connected for a connector-backed client it can configure', async () => {
    // Connector-backed and unmanageable are different questions, and today
    // every connector-backed client happens to be both. This pins the half
    // that does not depend on that coincidence: a member SealGate configures
    // perfectly well is still not "Connected", because the account-side
    // Connectors it also has are unproxied either way.
    const api = installMockApi()
    ;(api.mcp as Record<string, unknown>).getHookStatus = async () => ({
      statuses: [status({ client: 'claude-desktop', hooksApplicable: false })],
      daemonUnavailable: false
    })

    render(<ClientsView />)

    expect(await screen.findByText(/Add SealGate as a connector/)).toBeTruthy()
    expect(screen.queryByText('Connected')).toBeNull()
    expectNoRenderErrors()
  })

  it('reports a broken gateway over the Connectors caveat', async () => {
    // Same shape, mid-setup. Precedence: the caveat is permanent and the user
    // can do nothing about it right now, while an unreachable gateway is
    // theirs to fix. Showing the caveat here buries the actionable failure.
    const api = installMockApi()
    ;(api.mcp as Record<string, unknown>).getHookStatus = async () => ({
      statuses: [
        status({ client: 'claude-desktop', hooksApplicable: false, mcpConnected: false })
      ],
      daemonUnavailable: false
    })

    render(<ClientsView />)

    expect(await screen.findByText(/MCP gateway unreachable/)).toBeTruthy()
    expect(screen.queryByText(/Add SealGate as a connector/)).toBeNull()
    expectNoRenderErrors()
  })
})

describe('EncryptionStep', () => {
  const props = {
    mcpBaseUrl: 'https://mcp.example',
    apiBaseUrl: 'https://api.example',
    apiKey: 'sg_key',
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
    // the user their apps route through SealGate when none of them do.
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
