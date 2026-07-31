import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * ChatGPT is a detect-only client: its MCP servers are Connectors hosted in the
 * user's OpenAI account, so there is no local config for Edison to read, write,
 * hook, or proxy. The whole "surface ChatGPT in the wizard without pretending we
 * protect it" design rests on that staying true, so it's pinned here - if
 * ChatGPT is ever given a real config surface, these are the tests to revisit.
 */

const applyIntegrationsRpc = vi.fn(() => Promise.resolve([]))
const connect = vi.fn(() => Promise.resolve())

vi.mock('../detectord/lifecycle', () => ({
  getDetectordClient: () => ({ connect, applyIntegrations: applyIntegrationsRpc })
}))

// health drags in electron (dialogs for the missing-binary case).
vi.mock('../detectord/health', () => ({
  withDetectordHealth: <T,>(_label: string, fn: () => Promise<T>) => fn()
}))

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' }, BrowserWindow: { getAllWindows: () => [] } }))

import { applyIntegrations } from '../detectord/integrations'
import { CLIENT_DISPLAY } from '../clients/displayMeta'
import { CLIENT_LIST, MANAGED_CLIENT_LIST, isConnectorOnly } from '../clients/registry'

describe('connector-only clients', () => {
  beforeEach(() => {
    applyIntegrationsRpc.mockClear()
    connect.mockClear()
  })

  it('describes ChatGPT as connector-only, with a label instead of a path', () => {
    expect(isConnectorOnly('chatgpt')).toBe(true)
    // The wizard renders this where a config path would go; blank would read as
    // "we couldn't find it" rather than "there is nothing to find".
    expect(CLIENT_DISPLAY.chatgpt.configLabel).toBeTruthy()
  })

  it('treats every other client as manageable', () => {
    expect(isConnectorOnly('claude-code')).toBe(false)
    // Claude Desktop/Cowork are "partially supported" in the wizard but DO have
    // a local config Edison writes, so they stay manageable.
    expect(isConnectorOnly('claude-desktop')).toBe(false)
    expect(isConnectorOnly('claude-cowork')).toBe(false)
  })

  it('leaves ChatGPT out of the managed list, so it gets no setup status', () => {
    expect(CLIENT_LIST.map((c) => c.id)).toContain('chatgpt')
    expect(MANAGED_CLIENT_LIST.map((c) => c.id)).not.toContain('chatgpt')
  })

  it('never asks the daemon to install into ChatGPT', async () => {
    // The wizard selects every detected app by default, so this is the ordinary
    // case, not an edge one.
    expect(await applyIntegrations(['chatgpt'])).toEqual([])
    expect(connect).not.toHaveBeenCalled()
    expect(applyIntegrationsRpc).not.toHaveBeenCalled()
  })

  it('still installs the other apps selected alongside it', async () => {
    await applyIntegrations(['claude-code', 'chatgpt', 'cursor'])
    expect(applyIntegrationsRpc).toHaveBeenCalledWith(['claude_code', 'cursor'])
  })
})
