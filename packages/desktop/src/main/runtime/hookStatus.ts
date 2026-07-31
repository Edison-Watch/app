/**
 * Per-client hook + MCP-registration status, sourced entirely from the daemon.
 *
 * Nothing here opens a file. The daemon owns hook injection and the
 * edison-watch install, so it is also what reports their state: how many hook
 * bindings are in place, whether a workspace registration task is present, and
 * which URL the installed edison-watch entry points at. The app compares that
 * URL with the one it expects and renders the result.
 */

import { getAgentFacts, type AgentFacts } from '../detectord/agents'
import { DetectordUnavailableError } from '../discovery/mcpDiscovery'
import { CLIENT_LIST } from '../clients/registry'
import type { McpClientId } from '../discovery/types'
import type { ClaudeCodeMcpStatus } from '../infra/setupConfig'

export interface HookStatusEntry {
  client: McpClientId
  installed: boolean
  hasHook: boolean
  hookCount: number
  totalHooks: number
  mcpConnected: boolean
  mcpConfigured: boolean
  mcpApplicable: boolean
  hooksApplicable: boolean
  /**
   * False when Edison can only see this client, not configure it (ChatGPT's
   * server-side Connectors). Reported rather than filtered out: the wizard is
   * seen once, this list is the permanent surface, and a client silently
   * missing from it is how a user ends up assuming they're covered.
   */
  manageable: boolean
  mcpRuntimeStatus?: ClaudeCodeMcpStatus
}

/** Compare two MCP URLs ignoring the query string and trailing slashes. */
function sameUrl(a: string | null, b: string | null): boolean {
  if (!a || !b) return false
  const strip = (u: string): string => u.replace(/\?.*$/, '').replace(/\/+$/, '')
  return strip(a) === strip(b)
}

/**
 * Hook coverage for one agent: its hook-file bindings plus, where it has them,
 * its per-workspace registration tasks. Workspaces collapse to a single
 * "covered / not covered" unit - a user with 40 open projects shouldn't read
 * as 1/41 hooks installed.
 */
function hookCoverage(f: AgentFacts): { hookCount: number; totalHooks: number } {
  let hookCount = f.hooksInstalled
  let totalHooks = f.hooksTotal
  if (f.workspaceHooksTotal > 0) {
    totalHooks += 1
    if (f.workspaceHooksInstalled > 0) hookCount += 1
  }
  return { hookCount, totalHooks }
}

export async function getHookStatus(
  expectedMcpUrl?: string | null,
  mcpServerAlive = false,
  claudeCodeMcpStatus?: ClaudeCodeMcpStatus
): Promise<HookStatusEntry[]> {
  const url = expectedMcpUrl ?? null
  const facts = await getAgentFacts()
  // Reporting every client as "no hooks installed" because nobody answered
  // would read as a broken installation. Say we don't know instead.
  if (!facts) throw new DetectordUnavailableError()

  return CLIENT_LIST.map((client) => {
    const f = facts.get(client.id)
    if (!f) {
      // The daemon didn't report this agent (unreachable, or too old to know
      // it). Report nothing rather than guessing from the app's own probes.
      return {
        client: client.id,
        installed: false,
        hasHook: false,
        hookCount: 0,
        totalHooks: 0,
        mcpConnected: false,
        mcpConfigured: false,
        mcpApplicable: true,
        hooksApplicable: false,
        manageable: true
      }
    }

    const { hookCount, totalHooks } = hookCoverage(f)
    const mcpConfigured = f.installed && sameUrl(f.edisonUrl, url)

    let mcpConnected = mcpConfigured && mcpServerAlive
    let mcpRuntimeStatus: ClaudeCodeMcpStatus | undefined
    if (client.id === 'claude-code') {
      mcpRuntimeStatus = claudeCodeMcpStatus
      // Claude Code reports its own live connection state (`claude mcp get
      // edison-watch`), which is better than the "configured and the server
      // answers" approximation - but only once we know the entry points at the
      // gateway we expect. That probe reports on whatever URL sits under the
      // name `edison-watch`, so a leftover entry from another account or
      // environment answers "connected" quite happily. Letting that satisfy
      // setup would paint a client green while its traffic goes elsewhere.
      if (mcpConfigured && claudeCodeMcpStatus && claudeCodeMcpStatus !== 'unknown') {
        mcpConnected = claudeCodeMcpStatus === 'connected'
      }
    }

    return {
      client: client.id,
      installed: f.installed,
      hasHook: totalHooks > 0 && hookCount === totalHooks,
      hookCount,
      totalHooks,
      mcpConnected,
      mcpConfigured,
      // An unmanageable client has no gateway entry and no hook surface, so
      // neither condition applies to it. The UI renders it as its own state
      // rather than scoring it against conditions it can never meet.
      mcpApplicable: f.manageable,
      hooksApplicable: f.manageable && totalHooks > 0,
      manageable: f.manageable,
      ...(mcpRuntimeStatus !== undefined ? { mcpRuntimeStatus } : {})
    }
  })
}
