import { describe, it, expect, beforeEach, vi } from 'vitest'

import type { AgentFacts } from '../detectord/agents'
import type { McpClientId } from '../discovery/types'

/**
 * Status is what tells a user "this client is protected", so the interesting
 * cases here are the ones where something looks healthy but isn't.
 */

const EXPECTED_URL = 'https://mcp.sealgate.ai/mcp?client=claude-code'

let facts: Map<McpClientId, AgentFacts> | null = new Map()

vi.mock('../detectord/agents', () => ({
  getAgentFacts: () => Promise.resolve(facts)
}))

// hookStatus reaches DetectordUnavailableError through mcpDiscovery, whose
// import graph ends up in electron.
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' }, BrowserWindow: { getAllWindows: () => [] } }))

import { getHookStatus } from '../runtime/hookStatus'

function agent(over: Partial<AgentFacts> = {}): AgentFacts {
  return {
    installed: true,
    hooksInstalled: 4,
    hooksTotal: 4,
    workspaceHooksInstalled: 0,
    workspaceHooksTotal: 0,
    sealgateUrl: EXPECTED_URL,
    configPath: '/home/u/.claude.json',
    manageable: true,
    ...over
  }
}

const claudeCode = (over: Partial<AgentFacts> = {}): Map<McpClientId, AgentFacts> =>
  new Map([['claude-code' as McpClientId, agent(over)]])

const statusFor = async (
  id: McpClientId,
  ...args: Parameters<typeof getHookStatus>
): Promise<Awaited<ReturnType<typeof getHookStatus>>[number]> => {
  const all = await getHookStatus(...args)
  const entry = all.find((s) => s.client === id)
  if (!entry) throw new Error(`no status for ${id}`)
  return entry
}

describe('getHookStatus', () => {
  beforeEach(() => {
    facts = claudeCode()
  })

  it('trusts Claude Code’s live status once the entry points at our gateway', async () => {
    const s = await statusFor('claude-code', EXPECTED_URL, false, 'connected')
    // Live "connected" beats the server-alive approximation (false here).
    expect(s.mcpConnected).toBe(true)
    expect(s.mcpConfigured).toBe(true)
  })

  it('does NOT report connected when the entry points at a different gateway', async () => {
    // A leftover entry from another account/environment: `claude mcp get
    // sealgate` happily says "connected" - to somebody else's server.
    facts = claudeCode({ sealgateUrl: 'https://mcp.other-org.example/mcp?client=claude-code' })
    const s = await statusFor('claude-code', EXPECTED_URL, true, 'connected')
    expect(s.mcpConfigured).toBe(false)
    expect(s.mcpConnected).toBe(false)
    // The runtime state still travels, so the UI can explain the mismatch.
    expect(s.mcpRuntimeStatus).toBe('connected')
  })

  it('does NOT report connected when there is no entry at our install location', async () => {
    // e.g. sealgate exists only in some project's config.
    facts = claudeCode({ sealgateUrl: null })
    const s = await statusFor('claude-code', EXPECTED_URL, true, 'connected')
    expect(s.mcpConnected).toBe(false)
  })

  it('reports a live failure even when the URL matches', async () => {
    const s = await statusFor('claude-code', EXPECTED_URL, true, 'failed')
    expect(s.mcpConnected).toBe(false)
    expect(s.mcpRuntimeStatus).toBe('failed')
  })

  it('ignores query strings and trailing slashes when matching the URL', async () => {
    facts = claudeCode({ sealgateUrl: 'https://mcp.sealgate.ai/mcp/' })
    const s = await statusFor('claude-code', 'https://mcp.sealgate.ai/mcp?client=claude-code', true, 'connected')
    expect(s.mcpConfigured).toBe(true)
  })

  it('falls back to configured-and-alive for clients with no live probe', async () => {
    facts = new Map([['cursor' as McpClientId, agent({ configPath: '/home/u/.cursor/mcp.json' })]])
    expect((await statusFor('cursor', EXPECTED_URL, true)).mcpConnected).toBe(true)
    expect((await statusFor('cursor', EXPECTED_URL, false)).mcpConnected).toBe(false)
  })

  it('counts all workspace hooks as one unit of coverage', async () => {
    // 40 open projects shouldn't read as 1/41 hooks installed.
    facts = new Map([
      [
        'vscode' as McpClientId,
        agent({ hooksInstalled: 4, hooksTotal: 4, workspaceHooksInstalled: 1, workspaceHooksTotal: 40 })
      ]
    ])
    const s = await statusFor('vscode', EXPECTED_URL, true)
    expect(s.totalHooks).toBe(5)
    expect(s.hookCount).toBe(5)
    expect(s.hasHook).toBe(true)
  })

  it('reports an agent the daemon never mentioned as unknown, not as broken', async () => {
    facts = new Map()
    const s = await statusFor('claude-code', EXPECTED_URL, true, 'connected')
    expect(s.installed).toBe(false)
    expect(s.hooksApplicable).toBe(false)
    expect(s.mcpConnected).toBe(false)
  })

  it('throws when the daemon did not answer at all', async () => {
    facts = null
    await expect(getHookStatus(EXPECTED_URL, true, 'connected')).rejects.toThrow(/detector daemon/i)
  })
})
