import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * `ok` and `applied` answer different questions, and conflating them is how a
 * failed environment/account/key change gets reported as a success:
 *
 *   ok      - the daemon is enrolled and observable, so it protects the machine
 *   applied - THIS call enrolled it with the credentials just handed over
 *
 * A daemon still enrolled from an earlier session is `ok` but not `applied`:
 * its agents keep the previous environment's URL and key.
 */

let enrollSucceeds = true
let statusEnrolled = true
let ensureOk = true

const enroll = vi.fn(() => {
  if (!enrollSucceeds) return Promise.reject(new Error('backend unreachable'))
  return Promise.resolve({ enrolled: true, quarantine: false, quarantined_count: 0, user: 'u' })
})

vi.mock('../detectord/lifecycle', () => ({
  ensureDetectord: () =>
    Promise.resolve(
      ensureOk
        ? {
            ok: true,
            client: {
              enroll,
              status: () => Promise.resolve({ enrolled: statusEnrolled }),
              listServers: () => Promise.resolve([]),
              onEvent: () => {}
            }
          }
        : { ok: false, reason: 'daemon binary not found' }
    ),
  getDetectordClient: () => ({})
}))

vi.mock('../infra/setupConfig', () => ({
  getApiBaseUrl: () => 'https://api.example',
  getMcpBaseUrl: () => 'https://mcp.example',
  getCredentialsForEnv: () => ({ apiKey: 'sg_key', sealgateSecretKey: 'user:KEY' }),
  getSetupData: () => ({ configuredApps: ['cursor'] }),
  isSetupComplete: () => true
}))

vi.mock('../detectord/approvalDialog', () => ({ showDaemonApprovalDialog: () => {} }))
vi.mock('../detectord/binary', () => ({
  detectordBinaryExists: () => true,
  getDetectordBinaryPath: () => '/bin/sealgate-detectord'
}))
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', isReady: () => true, whenReady: () => Promise.resolve(), quit: () => {} },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: { showMessageBox: () => Promise.resolve({ response: 1 }) }
}))

import { bootstrapDetectord } from '../detectord/bootstrap'

describe('bootstrapDetectord outcome', () => {
  beforeEach(() => {
    enrollSucceeds = true
    statusEnrolled = true
    ensureOk = true
    enroll.mockClear()
  })

  it('reports applied when it enrolled with the credentials given', async () => {
    const r = await bootstrapDetectord({ sealgateSecretKey: 'user:NEW' })
    expect(r).toMatchObject({ ok: true, applied: true })
  })

  it('reports ok-but-not-applied when it only observed an already-enrolled daemon', async () => {
    // Enroll fails (backend down) but the daemon is still enrolled from before,
    // so it keeps protecting the machine - with the PREVIOUS credentials.
    enrollSucceeds = false
    const r = await bootstrapDetectord({ sealgateSecretKey: 'user:NEW' })
    expect(r.ok).toBe(true)
    expect(r.applied).toBe(false)
    expect(r.reason).toBeTruthy()
  })

  it('reports neither when the daemon is not enrolled at all', async () => {
    enrollSucceeds = false
    statusEnrolled = false
    const r = await bootstrapDetectord()
    expect(r).toMatchObject({ ok: false, applied: false })
  })

  it('reports neither when the daemon could not be started', async () => {
    ensureOk = false
    const r = await bootstrapDetectord()
    expect(r.ok).toBe(false)
    expect(r.applied).toBe(false)
    expect(r.reason).toContain('binary')
  })
})
