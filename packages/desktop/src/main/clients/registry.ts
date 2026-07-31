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

/**
 * The clients Edison can actually manage - i.e. everything except the
 * connector-only ones (ChatGPT), whose MCP servers live in the user's account.
 *
 * Setup status is reported over this list rather than `CLIENT_LIST`, because
 * every answer it could give for a connector-only client is wrong: "gateway not
 * configured" blames the user for something they can't fix, and "nothing
 * applicable, all good" paints an unprotected app green. It gets detected and
 * flagged in the onboarding wizard instead.
 */
export const MANAGED_CLIENT_LIST: ClientEntry[] = CLIENT_LIST.filter(
  (c) => !c.display.connectorOnly
)

/** Whether this client is detect-only (server-side Connectors, no local config). */
export function isConnectorOnly(clientId: string): boolean {
  return CLIENT_DISPLAY[clientId as McpClientId]?.connectorOnly === true
}
