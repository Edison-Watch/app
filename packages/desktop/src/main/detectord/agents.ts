// Per-agent facts, sourced from the daemon.
//
// Everything here used to be answered by opening the agent's own files: its
// hook file to count injected hooks, its MCP config to see whether the
// sealgate entry was there and pointed at the right URL, its workspace
// `tasks.json` files to count registration tasks. The daemon already walks all
// of that (it watches those files anyway) and it is the component that holds
// the OS permissions to reach them, so the app asks instead of reading.

import type { McpClientId } from '../discovery/types'

import { getDetectordClient } from './lifecycle'
import { withDetectordHealth } from './health'
import type { AgentInfo } from './protocol'

// Client ids use dashes (`claude-code`); daemon agent names use underscores.
export const toAgentName = (client: string): string => client.replace(/-/g, '_')
export const toClientId = (agent: string): McpClientId =>
  agent.replace(/_/g, '-') as McpClientId

/** What the app needs to know about one agent, with daemon-absent defaults. */
export interface AgentFacts {
  installed: boolean
  hooksInstalled: number
  hooksTotal: number
  workspaceHooksInstalled: number
  workspaceHooksTotal: number
  /** URL of the installed sealgate entry, or null when there is none. */
  sealgateUrl: string | null
  /** The agent's user-scope config file, when it has one. */
  configPath: string | null
  /**
   * Whether SealGate can manage this agent, or only report that it's installed.
   * False for connector-only hosts (ChatGPT), whose MCP servers live in the
   * vendor's account rather than in a file on this machine.
   */
  manageable: boolean
}

const UNKNOWN: AgentFacts = {
  installed: false,
  hooksInstalled: 0,
  hooksTotal: 0,
  workspaceHooksInstalled: 0,
  workspaceHooksTotal: 0,
  sealgateUrl: null,
  configPath: null,
  manageable: true
}

function toFacts(a: AgentInfo): AgentFacts {
  return {
    installed: a.installed,
    hooksInstalled: a.hooks_installed ?? 0,
    hooksTotal: a.hooks_total ?? 0,
    workspaceHooksInstalled: a.workspace_hooks_installed ?? 0,
    workspaceHooksTotal: a.workspace_hooks_total ?? 0,
    sealgateUrl: a.sealgate_url ?? null,
    configPath: a.config_path ?? null,
    // Absent means an older daemon, where every agent was manageable.
    manageable: a.manageable ?? true
  }
}

/**
 * Facts for every agent, keyed by client id.
 *
 * `null` means the daemon didn't answer - which is NOT the same as "no agents
 * are installed", so callers must not render it as a result. The failure is
 * reported to the health tracker, which raises the app-wide warning.
 */
export async function getAgentFacts(): Promise<Map<McpClientId, AgentFacts> | null> {
  try {
    return await withDetectordHealth('list_agents', async () => {
      const daemon = getDetectordClient()
      await daemon.connect()
      const agents = await daemon.listAgents()
      return new Map(agents.map((a) => [toClientId(a.name), toFacts(a)]))
    })
  } catch {
    return null
  }
}

export { UNKNOWN as UNKNOWN_AGENT_FACTS }
