import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * The dialogs branch on `alreadyPending` vs `alreadyExists` to tell the user
 * either "wait for an admin" or "pick another name". Both arrive as a backend
 * 409, which the daemon reports as `conflict: <the backend's own wording>`, so
 * these tests pin the split on that wording - the thing that decides which
 * advice a user gets.
 */

let dispositionError: Error | null = null
const disposition = vi.fn(() => (dispositionError ? Promise.reject(dispositionError) : Promise.resolve()))

vi.mock('../detectord/lifecycle', () => ({
  getDetectordClient: () => ({
    connect: () => Promise.resolve(),
    disposition
  })
}))

import { submitOneViaDetectord } from '../detectord/submit'
import type { DiscoveredMcpServer } from '../discovery/types'

const server: DiscoveredMcpServer = {
  name: 'sqlite',
  client: 'cursor',
  source: 'user',
  path: '/Users/x/.cursor/mcp.json',
  config: { command: 'npx', args: ['-y', 'mcp-sqlite'] }
}

describe('submitOneViaDetectord', () => {
  beforeEach(() => {
    dispositionError = null
    disposition.mockClear()
  })

  it('reports a pending approval request as pending, not as a name clash', async () => {
    dispositionError = new Error(
      'conflict: You already have a pending request for this server'
    )
    const result = await submitOneViaDetectord(server, 'requested')
    expect(result.alreadyPending).toBe(true)
    // Renaming would file a second request rather than wait for the first.
    expect(result.alreadyExists).toBeUndefined()
    expect(result.errorMessage).toContain('pending request')
  })

  it('reports a taken name as a name clash, which a rename can fix', async () => {
    dispositionError = new Error("conflict: 'sqlite' is already registered at Edison Watch")
    const result = await submitOneViaDetectord(server, 'registered')
    expect(result.alreadyExists).toBe(true)
    expect(result.alreadyPending).toBeUndefined()
  })

  it('passes the user’s register-vs-request choice to the daemon', async () => {
    await submitOneViaDetectord(server, 'requested')
    // Last positional arg is `register`: an admin who chose "request approval"
    // must not be silently auto-registered.
    expect(disposition.mock.calls[0]!.at(-1)).toBe(false)

    disposition.mockClear()
    await submitOneViaDetectord(server, 'registered')
    expect(disposition.mock.calls[0]!.at(-1)).toBe(true)
  })

  it('rethrows anything that is not a conflict', async () => {
    dispositionError = new Error('not enrolled')
    await expect(submitOneViaDetectord(server, 'registered')).rejects.toThrow('not enrolled')
  })

  it('submits the deduped name as a rename of the discovered one', async () => {
    const deduped: DiscoveredMcpServer = { ...server, name: 'sqlite_cursor', originalName: 'sqlite' }
    await submitOneViaDetectord(deduped, 'registered')
    const [name, choice, , rename] = disposition.mock.calls[0]! as unknown as string[]
    expect(name).toBe('sqlite')
    expect(choice).toBe('send_to_ew')
    expect(rename).toBe('sqlite_cursor')
  })
})
