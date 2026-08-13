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
/** `list_agents` is a full discovery pass, so who asks for it matters. */
let factsCalls = 0

vi.mock('../detectord/agents', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../detectord/agents')>()),
  getAgentFacts: () => {
    factsCalls += 1
    return Promise.resolve(facts)
  }
}))

// hookStatus reaches DetectordUnavailableError through mcpDiscovery, whose
// import graph ends up in electron. `ipcMain` is a registry the readConfig
// tests below reach into to get at the handler.
const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp' },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: (channel: string, fn: never) => handlers.set(channel, fn) }
}))

let readConfigResult: () => Promise<{ content: string | null }> = async () => ({ content: '{}' })
let listAgentsResult: Record<string, unknown>[] = []
vi.mock('../detectord/lifecycle', () => ({
  getDetectordClient: () => ({
    connect: async () => {},
    readConfig: () => readConfigResult(),
    listAgents: async () => listAgentsResult
  })
}))

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

/**
 * The wire-to-app hop, which the tests above mock past. `manageable` crosses
 * here as snake-case JSON from a daemon that may predate the field, and nothing
 * upstream of this point is typechecked - the payload is parsed, not compiled.
 */
describe('AgentInfo -> AgentFacts', () => {
  // The real module; the rest of this file replaces getAgentFacts with a stub.
  const real = async () => await vi.importActual<typeof import('../detectord/agents')>('../detectord/agents')

  it('carries an unmanageable agent through as unmanageable', async () => {
    listAgentsResult = [{ name: 'chatgpt', installed: true, manageable: false }]
    const facts = await (await real()).getAgentFacts()
    expect(facts?.get('chatgpt' as McpClientId)?.manageable).toBe(false)
  })

  it('reads an omitted field as manageable, not as false', async () => {
    // The older-daemon case. Defaulting to false here would strip every client
    // of its setup conditions the moment the app outran the daemon.
    listAgentsResult = [{ name: 'cursor', installed: true }]
    const facts = await (await real()).getAgentFacts()
    expect(facts?.get('cursor' as McpClientId)?.manageable).toBe(true)
  })
})

describe('mcp:readConfig', () => {
  let readConfig: (event: unknown, client: string) => Promise<{ content: string | null; error?: string }>

  beforeEach(async () => {
    factsCalls = 0
    facts = new Map([['chatgpt' as McpClientId, agent({ manageable: false })]])
    const { registerMcpSubmitHandlers } = await import('../ipc/ipcHandlersMcpSubmit')
    registerMcpSubmitHandlers()
    readConfig = handlers.get('mcp:readConfig') as typeof readConfig
  })

  it('explains Connectors instead of surfacing an error nobody can act on', async () => {
    readConfigResult = async () => {
      throw new Error("agent 'chatgpt' has no user-scope config")
    }
    const { content, error } = await readConfig(null, 'chatgpt')
    expect(content).toMatch(/Connectors in your account/)
    expect(error).toBeUndefined()
  })

  it('costs no extra discovery pass when the read succeeds', async () => {
    // The check used to run first, so every successful read paid for a
    // `list_agents` - and AppsStep re-reads every expanded client on refresh,
    // turning one wasted scan into one per open panel.
    readConfigResult = async () => ({ content: '{"mcpServers":{}}' })
    const { content } = await readConfig(null, 'cursor')
    expect(content).toBe('{"mcpServers":{}}')
    expect(factsCalls).toBe(0)
  })

  it('still passes a real failure through for a manageable client', async () => {
    readConfigResult = async () => {
      throw new Error('permission denied')
    }
    const { content, error } = await readConfig(null, 'cursor')
    expect(content).toBeNull()
    expect(error).toBe('permission denied')
  })

  it('does not claim an account holds the servers of a manageable client with no config yet', async () => {
    // JetBrains reports zero install targets when no IDE is installed, so it
    // has no config path and is still perfectly manageable the moment one
    // appears. Keyed on the path alone, this branch told those users their
    // servers live in an account, which is the opposite of true. `configPath`
    // is also optional on the wire, so an older daemon omitting it must not be
    // enough on its own either.
    facts = new Map([['intellij' as McpClientId, agent({ manageable: true, configPath: null })]])
    readConfigResult = async () => {
      throw new Error('permission denied')
    }
    const { content, error } = await readConfig(null, 'intellij')
    expect(content).toBeNull()
    expect(error).toBe('permission denied')
  })

  it('does not claim the config is missing for an unmanageable client that has one', async () => {
    // The Claude hosts are unmanageable - Edison cannot write a gateway URL
    // into a stdio-only file - and their config still exists and is parsed on
    // every scan. Keyed on `manageable`, this branch told those users the file
    // did not exist and there was nothing to protect. It keys on the path now,
    // which is the question it was always asking.
    facts = new Map([
      [
        'claude-desktop' as McpClientId,
        agent({ manageable: false, configPath: '/home/u/claude_desktop_config.json' })
      ]
    ])
    readConfigResult = async () => {
      throw new Error('permission denied')
    }
    const { content, error } = await readConfig(null, 'claude-desktop')
    expect(content).toBeNull()
    expect(error).toBe('permission denied')
  })
})
