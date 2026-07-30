/**
 * MCP Server Discovery - aggregator and re-export hub.
 *
 * Discovers MCP servers from all supported clients and deduplicates them.
 * Per-client discovery logic lives in clients/{client}/discovery.ts.
 *
 * This module re-exports types and per-client functions so that existing
 * consumers can update their import path without changing named imports.
 */
import type { DiscoveredMcpServer, DiscoveryResult } from './types'
import { isOpaqueConfig, hasMalformedHeaders } from './types'
import { clientAlias } from './serverDeduplication'
import { discoverViaDetectord } from '../detectord/discovery'

// ── Re-exports (backward compatibility) ────────────────────────────────────

// Types
export type { McpClientId, McpServerTransport, McpServerConfig, DiscoveredMcpServer, DiscoveryResult } from './types'
export { isOpaqueConfig, describeUnsupportedReason } from './types'

// Fingerprints (pure; the daemon keeps the seen-store)
export { getServerFingerprint } from './fingerprint'

// ── Imports for aggregator ──────────────────────────────────────────────────

import { unwrapStdioShim } from './stdioShim'

// ── Aggregator ──────────────────────────────────────────────────────────────

/** Thrown when the daemon - the only source of servers - didn't answer. */
export class DetectordUnavailableError extends Error {
  constructor() {
    super(
      "Edison Watch can't reach its detector daemon, so it can't tell which MCP servers are configured."
    )
    this.name = 'DetectordUnavailableError'
  }
}

export async function discoverMcpServers(): Promise<DiscoveredMcpServer[]>
export async function discoverMcpServers(opts: { includeRaw: true }): Promise<DiscoveryResult>
export async function discoverMcpServers(opts?: { includeRaw?: boolean }): Promise<DiscoveredMcpServer[] | DiscoveryResult> {
  // The daemon is the only source of truth. It sees stdio servers, it already
  // watches every config file, and - the reason there is no local fallback -
  // it is the one component allowed to read the user's project directories.
  // The rest of the pipeline (shim-unwrap, supported/unsupported split, dedup,
  // installed-app filter) runs on its answer.
  const daemonServers = await discoverViaDetectord()
  // No fallback exists, so "the daemon didn't answer" has to travel as a
  // failure. Returning [] here would render as "no MCP servers configured",
  // which is the most dangerous sentence this app could show wrongly.
  if (daemonServers === null) throw new DetectordUnavailableError()
  const results: DiscoveredMcpServer[] = daemonServers

  // Normalize stdio shims (e.g. `npx -y mcp-remote https://…`) to their
  // URL-shaped equivalents so downstream code (submit, dedup, credential
  // review, quarantine) treats them as the HTTP servers they actually are.
  for (const s of results) {
    const unwrapped = unwrapStdioShim(s.config)
    if (unwrapped) s.config = unwrapped
  }

  // Split supported / unsupported. Unsupported = opaque (Cursor marketplace
  // and VS Code state-DB shapes) OR an HTTP server whose `headers` field is the
  // wrong shape (must be a JSON object). Local stdio is supported: the daemon
  // can act on stdio servers, and it is what registers them.
  const supported: DiscoveredMcpServer[] = []
  const unsupportedRaw: DiscoveredMcpServer[] = []
  for (const s of results) {
    if (isOpaqueConfig(s.config)) {
      unsupportedRaw.push(s)
    } else if (hasMalformedHeaders(s.config)) {
      unsupportedRaw.push(s)
    } else {
      supported.push(s)
    }
  }
  // Deduplicate unsupported list by name+client (same opaque server from multiple config paths)
  const unsupported: DiscoveredMcpServer[] = []
  const seenUnsupported = new Set<string>()
  for (const s of unsupportedRaw) {
    const key = `${s.name}:${s.client}`
    if (!seenUnsupported.has(key)) {
      seenUnsupported.add(key)
      unsupported.push(s)
    }
  }

  // Everything the daemon reports is shown. It only discovers servers from
  // config files that exist, so there is no "phantom entry" to filter out - and
  // the costs are asymmetric: showing a leftover entry from an uninstalled
  // editor is clutter, while hiding a live one leaves a real MCP server
  // unreviewed and unquarantined.
  //
  // This used to filter on the daemon's per-agent `installed` flag, which is
  // "the agent's primary config file exists" - a different question. Claude
  // Code configured through `~/.claude/settings.json` with no `~/.claude.json`
  // reported installed=false, so its servers vanished from discovery.
  const deduped = deduplicateByNameAndConfig(supported)
  return opts?.includeRaw ? { servers: deduped, raw: supported, unsupported } : deduped
}

// ── Deduplication ───────────────────────────────────────────────────────────

/**
 * Deduplicate discovered MCP servers by name + config.
 *
 * - Entries with the same name AND identical config (command/args/url) are
 *   collapsed into one (true duplicates across clients).
 * - Entries with the same name but different configs are kept but renamed
 *   `name_2`, `name_3`, … so every entry has a unique name.
 */
export function deduplicateByNameAndConfig(servers: DiscoveredMcpServer[]): DiscoveredMcpServer[] {
  const byName = new Map<string, DiscoveredMcpServer[]>()
  for (const server of servers) {
    const group = byName.get(server.name) ?? []
    group.push(server)
    byName.set(server.name, group)
  }

  const configKey = (s: DiscoveredMcpServer): string => {
    const c = s.config
    if ('command' in c && c.command) return JSON.stringify({ command: c.command, args: c.args ?? [] })
    if ('url' in c) return JSON.stringify({ url: c.url })
    return JSON.stringify(c)
  }

  const result: DiscoveredMcpServer[] = []
  for (const [, group] of byName) {
    if (group.length === 1) { result.push({ ...group[0]!, clients: [group[0]!.client] }); continue }

    // Collapse true duplicates (same name + same config), merging clients.
    const seen = new Map<string, DiscoveredMcpServer>()
    for (const server of group) {
      const key = configKey(server)
      const existing = seen.get(key)
      if (existing) {
        const clients = existing.clients ?? [existing.client]
        if (!clients.includes(server.client)) clients.push(server.client)
        existing.clients = clients
      } else {
        seen.set(key, { ...server, clients: [server.client] })
      }
    }

    const unique = [...seen.values()]
    if (unique.length === 1) {
      result.push(unique[0]!)
    } else {
      // Different configs under the same name - rename to disambiguate.
      const clientSet = new Set(unique.map((e) => e.client))
      if (clientSet.size === unique.length) {
        // Each entry from a different client - simple alias suffix
        for (const entry of unique) {
          const alias = clientAlias(entry.client)
          result.push({ ...entry, name: `${entry.name}_${alias}`, originalName: entry.name })
        }
      } else {
        // Some entries share a client - use numeric suffixes per client
        const clientCounter = new Map<string, number>()
        for (const entry of unique) {
          const alias = clientAlias(entry.client)
          const count = (clientCounter.get(alias) ?? 0) + 1
          clientCounter.set(alias, count)
          const suffix = count > 1 || unique.filter((e) => e.client === entry.client).length > 1
            ? `${alias}_${count}` : alias
          result.push({ ...entry, name: `${entry.name}_${suffix}`, originalName: entry.name })
        }
      }
    }
  }

  return result
}
