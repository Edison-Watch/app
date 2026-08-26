// Installing and removing the sealgate entry, via the daemon.
//
// The daemon holds the credentials (in its enrollment) and is the only
// component that writes agent config files, so "add sealgate to Cursor"
// is a request, not something the app does itself. Reverting likewise: the
// daemon removes the entry it wrote and forgets the agent, so its self-heal
// doesn't reinstate it.

import { getDetectordClient } from './lifecycle'
import { toAgentName } from './agents'
import { withDetectordHealth } from './health'
import type { IntegrationChange } from './protocol'

export type { IntegrationChange }

/**
 * Install the sealgate entry + hooks for these client ids.
 *
 * Unmanageable clients are not filtered here. The daemon drops them, because
 * it is not the only caller: enroll sends the saved app selection on every
 * start, and a guard in front of one caller left the other wide open.
 */
export async function applyIntegrations(clients: string[]): Promise<IntegrationChange[]> {
  return withDetectordHealth('apply_integrations', async () => {
    const daemon = getDetectordClient()
    await daemon.connect()
    return daemon.applyIntegrations(clients.map(toAgentName))
  })
}

/** Remove the sealgate entry for these client ids. */
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
