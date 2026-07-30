/**
 * What's left of the app's own submit path: the credential-review override
 * shape, and a role lookup.
 *
 * Submitting a server to Edison Watch is the daemon's job now - it templatizes,
 * posts, records the outcome in its seen-store and removes the local config
 * entry in one step (see detectord/submit.ts). The HTTP client that used to do
 * that here is gone, along with its own notion of "already pending" / "already
 * exists", which the daemon now reports from the backend's own 409 detail.
 */

/**
 * One user-confirmed redaction from credential review: the span of a config
 * value to replace with `{varName}` before submitting.
 */
export interface TemplateOverride {
  entryId: string
  varName: string
  selectedText: string
  start: number
  end: number
}

/**
 * The current user's role ('admin' | 'owner' | 'user'), or null when it can't
 * be determined. Used by the tray to decide whether registering is offered
 * outright or as a request; the daemon makes the same call for its own submits.
 */
export async function fetchUserRole(
  apiBaseUrl: string,
  apiKey: string
): Promise<string | null> {
  try {
    const url = `${apiBaseUrl.replace(/\/$/, '')}/api/v1/user/profile`
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json'
      }
    })
    if (!response.ok) return null
    const data = (await response.json()) as { role?: string }
    return data.role ?? null
  } catch {
    return null
  }
}
