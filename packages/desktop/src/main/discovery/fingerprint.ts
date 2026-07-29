/**
 * Stable fingerprints for MCP server configurations.
 *
 * Pure computation over a config the daemon already handed us - nothing here
 * touches disk. The daemon keeps the seen-store (which fingerprints are
 * known); the app only needs to compute one to match a server against the
 * backend's list.
 */

import { createHash } from 'crypto'

import type { DiscoveredMcpServer, McpServerConfig } from './types'
import { detectSecrets } from './secretDetection'

// `{NAME}` template placeholders collapse to a bare `{}` before hashing so
// the placeholder's variable name never affects the fingerprint. Required
// for the dashboard's "already on backend" preflight to recognise the same
// server when one side carries `{TOKEN}` and the other `{SOME_TOKEN}` (the
// names are auto-derived from the flag/key and can drift).
const TEMPLATE_PLACEHOLDER_RE = /\{[^{}]*\}/g

function normalizePlaceholders(s: string): string {
  return s.replace(TEMPLATE_PLACEHOLDER_RE, '{}')
}

/**
 * Generate a stable fingerprint for an MCP server configuration.
 *
 * The config is templatized first (concrete secrets replaced with `{...}`
 * placeholders) so a freshly-discovered server with an embedded token
 * fingerprints the same as the templatized form the backend stored at
 * submit time. Placeholder variable names are then normalized so two
 * detections that pick different names for the same secret still match.
 */
export function getServerFingerprint(server: DiscoveredMcpServer): string {
  const { config: templatized } = detectSecrets(server)
  const config = templatized as McpServerConfig
  let identifier: string

  if ('command' in config && config.command) {
    const args = (config.args ?? []).map(normalizePlaceholders).join(' ')
    identifier = `${server.name}:${normalizePlaceholders(config.command)}:${args}`
  } else if ('url' in config && config.url) {
    identifier = `${server.name}:${normalizePlaceholders(config.url)}`
  } else {
    identifier = `${server.name}:${server.client}`
  }

  return createHash('sha256').update(identifier).digest('hex').slice(0, 16)
}
