import { describe, it, expect, beforeEach, vi } from 'vitest'

import type { AgentFacts } from '../detectord/agents'
import type { McpClientId } from '../discovery/types'

/**
 * ChatGPT is presence-only: its MCP servers are Connectors in the user's OpenAI
 * account, so there is nothing local to read, write, hook, or proxy. Two things
 * have to hold, and both have been wrong at some point:
 *
 *  - it never enters the enrolled selection (every path, not just the obvious
 *    one), because the selection is additive and only `unenroll` empties it;
 *  - it is still REPORTED, with a status of its own. Dropping it from the
 *    client list is how a user ends up assuming an unprotected app is covered.
 */

let facts: Map<McpClientId, AgentFacts> | null = new Map()

vi.mock('../detectord/agents', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../detectord/agents')>()),
  getAgentFacts: () => Promise.resolve(facts)
}))

// hookStatus reaches DetectordUnavailableError through mcpDiscovery, whose
// import graph ends up in electron.
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' }, BrowserWindow: { getAllWindows: () => [] } }))

import { getHookStatus } from '../runtime/hookStatus'

const EXPECTED_URL = 'https://mcp.edison.watch/mcp'

function agent(over: Partial<AgentFacts> = {}): AgentFacts {
  return {
    installed: true,
    hooksInstalled: 0,
    hooksTotal: 0,
    workspaceHooksInstalled: 0,
    workspaceHooksTotal: 0,
    edisonUrl: null,
    configPath: null,
    manageable: true,
    ...over
  }
}

describe('unmanageable clients', () => {
  beforeEach(() => {
    facts = new Map([['chatgpt' as McpClientId, agent({ manageable: false })]])
  })

  it('reports ChatGPT rather than hiding it', async () => {
    const all = await getHookStatus(EXPECTED_URL, true)
    const entry = all.find((s) => s.client === 'chatgpt')
    expect(entry).toBeDefined()
    expect(entry?.installed).toBe(true)
  })

  it('marks it unmanageable and scores it against no setup conditions', async () => {
    // Both would otherwise render as a lie: an unmet MCP condition reads
    // "gateway not configured" (unfixable), and a met one paints it green.
    const entry = (await getHookStatus(EXPECTED_URL, true)).find((s) => s.client === 'chatgpt')
    expect(entry?.manageable).toBe(false)
    expect(entry?.mcpApplicable).toBe(false)
    expect(entry?.hooksApplicable).toBe(false)
  })

  it('leaves manageable clients scored as before', async () => {
    facts = new Map([
      ['cursor' as McpClientId, agent({ edisonUrl: EXPECTED_URL, hooksTotal: 4, hooksInstalled: 4 })]
    ])
    const entry = (await getHookStatus(EXPECTED_URL, true)).find((s) => s.client === 'cursor')
    expect(entry?.manageable).toBe(true)
    expect(entry?.mcpApplicable).toBe(true)
    expect(entry?.mcpConnected).toBe(true)
  })

  it('treats a daemon that never heard of the field as fully manageable', async () => {
    // An older daemon omits `manageable`; defaulting it to false would silently
    // drop every real client out of setup reporting.
    const { UNKNOWN_AGENT_FACTS } = await import('../detectord/agents')
    expect(UNKNOWN_AGENT_FACTS.manageable).toBe(true)
  })
})
