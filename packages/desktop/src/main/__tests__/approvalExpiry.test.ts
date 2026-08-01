import { describe, it, expect } from 'vitest'

import {
  DEFAULT_APPROVAL_EXPIRY_MS,
  approvalWindowMs,
  hasExpired
} from '../ipc/approvalExpiry'
import { buildApprovalDialogHtml } from '../dialogs/approvalDialogView'
import type { PendingApproval } from '../ipc/approvalsHandler'

/**
 * The desktop expires an approval prompt on the window the *backend* declared
 * for it, not on a constant of its own.
 *
 * The distinction is not cosmetic. The expiry sweep deletes the pending
 * approval and closes the dialog; if it fires while the server is still
 * holding the call, the prompt vanishes from the user's screen and the gate
 * later resolves fail-closed. The user is denied a decision they were never
 * given the chance to make. That is what a hardcoded 30s did to any policy
 * rule with a longer `approval_timeout_s` - and those already ship.
 */

function approval(overrides: Partial<PendingApproval> = {}): PendingApproval {
  return {
    id: 'a1',
    sessionId: 's1',
    kind: 'tool',
    name: 'send_email',
    timestamp: 1_000_000,
    timeoutMs: DEFAULT_APPROVAL_EXPIRY_MS,
    ...overrides
  }
}

describe('approvalWindowMs', () => {
  it('converts the backend seconds to ms', () => {
    expect(approvalWindowMs(120)).toBe(120_000)
  })

  it('falls back when the event omits a window', () => {
    expect(approvalWindowMs(undefined)).toBe(DEFAULT_APPROVAL_EXPIRY_MS)
    expect(approvalWindowMs(null)).toBe(DEFAULT_APPROVAL_EXPIRY_MS)
  })

  it('falls back rather than expiring instantly on a nonsense window', () => {
    // A zero or negative window would expire every approval on the first sweep,
    // silently denying everything - strictly worse than being 30s wrong.
    expect(approvalWindowMs(0)).toBe(DEFAULT_APPROVAL_EXPIRY_MS)
    expect(approvalWindowMs(-5)).toBe(DEFAULT_APPROVAL_EXPIRY_MS)
    expect(approvalWindowMs(Number.NaN)).toBe(DEFAULT_APPROVAL_EXPIRY_MS)
  })
})

describe('hasExpired', () => {
  it('keeps a long gate alive past the old hardcoded 30s', () => {
    const a = approval({ timeoutMs: approvalWindowMs(120) })
    expect(hasExpired(a, a.timestamp + 31_000)).toBe(false)
    expect(hasExpired(a, a.timestamp + 119_000)).toBe(false)
  })

  it('expires it once the backend has stopped holding', () => {
    const a = approval({ timeoutMs: approvalWindowMs(120) })
    expect(hasExpired(a, a.timestamp + 120_000)).toBe(true)
  })

  it('still expires a default-window approval at 30s', () => {
    const a = approval()
    expect(hasExpired(a, a.timestamp + 29_000)).toBe(false)
    expect(hasExpired(a, a.timestamp + 30_000)).toBe(true)
  })

  it('expires each approval on its own window, not a shared one', () => {
    const short = approval({ id: 'short', timeoutMs: approvalWindowMs(30) })
    const long = approval({ id: 'long', timeoutMs: approvalWindowMs(600) })
    const now = short.timestamp + 45_000
    expect(hasExpired(short, now)).toBe(true)
    expect(hasExpired(long, now)).toBe(false)
  })
})

describe('countdown markup', () => {
  it('renders each card against its own window', () => {
    const html = buildApprovalDialogHtml([
      approval({ id: 'short', timeoutMs: approvalWindowMs(30) }),
      approval({ id: 'long', timeoutMs: approvalWindowMs(120) })
    ])
    expect(html).toContain('data-timeout="30000"')
    expect(html).toContain('data-timeout="120000"')
  })

  it('does not bake one window into the dialog script', () => {
    // The embedded script reads data-timeout per element. If it ever goes back
    // to a single module constant, every card counts down the same number again.
    const html = buildApprovalDialogHtml([approval({ timeoutMs: approvalWindowMs(120) })])
    expect(html).toContain('data-timeout')
    expect(html).toMatch(/timeoutOf\(/)
  })
})
