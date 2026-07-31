// Installing and removing the edison-watch entry, via the daemon.
//
// The daemon holds the credentials (in its enrollment) and is the only
// component that writes agent config files, so "add edison-watch to Cursor"
// is a request, not something the app does itself. Reverting likewise: the
// daemon removes the entry it wrote and forgets the agent, so its self-heal
// doesn't reinstate it.

import { getDetectordClient } from './lifecycle'
import { toAgentName } from './agents'
import { withDetectordHealth } from './health'
import { isConnectorOnly } from '../clients/registry'
import type { IntegrationChange } from './protocol'

export type { IntegrationChange }

/**
 * Install the edison-watch entry + hooks for these client ids.
 *
 * Connector-only clients (ChatGPT) are dropped first. The wizard selects every
 * detected app by default, so they arrive here routinely - and asking the
 * daemon to install into one would add it to the enrolled selection, which the
 * self-heal then revisits forever, all to write a config file that does not
 * exist. Silently skipping matches what the user is told about them: detected,
 * not managed.
 */
export async function applyIntegrations(clients: string[]): Promise<IntegrationChange[]> {
  const installable = clients.filter((c) => !isConnectorOnly(c))
  if (installable.length === 0) return []
  return withDetectordHealth('apply_integrations', async () => {
    const daemon = getDetectordClient()
    await daemon.connect()
    return daemon.applyIntegrations(installable.map(toAgentName))
  })
}

/** Remove the edison-watch entry for these client ids. */
export async function revertIntegrations(clients: string[]): Promise<IntegrationChange[]> {
  return withDetectordHealth('revert_integrations', async () => {
    const daemon = getDetectordClient()
    await daemon.connect()
    return daemon.revertIntegrations(clients.map(toAgentName))
  })
}

/** The failed changes as readable strings, for the UI's error list. */
export function integrationErrors(changes: IntegrationChange[]): string[] {
  return changes.filter((c) => !c.ok).map((c) => `${c.agent}: ${c.error ?? 'failed'}`)
}
