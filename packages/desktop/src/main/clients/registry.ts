/**
 * The supported MCP clients.
 *
 * This used to be a registry of per-client integrations: how to discover their
 * servers, where their config files live, how to inject hooks. All of that is
 * the detector daemon's job now - it owns every read and write of an agent's
 * files - so what's left here is the list itself and its display metadata.
 */
import type { McpClientId } from '../discovery/types'
import { CLIENT_DISPLAY, type ClientDisplay } from './displayMeta'

export interface ClientEntry {
  id: McpClientId
  display: ClientDisplay
}

/** Every supported client, in display order. */
export const CLIENT_LIST: ClientEntry[] = (
  Object.keys(CLIENT_DISPLAY) as McpClientId[]
).map((id) => ({ id, display: CLIENT_DISPLAY[id] }))

export const CLIENT_IDS: McpClientId[] = CLIENT_LIST.map((c) => c.id)
