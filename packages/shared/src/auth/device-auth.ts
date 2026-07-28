/**
 * Edison backend device-authorization login (OAuth 2.0 Device Grant + PKCE).
 *
 * Replaces the former Supabase login: the app requests a device code from the
 * Edison backend, opens the dashboard's /device approval page in the system
 * browser, and polls the token endpoint until the signed-in human approves.
 * Redemption returns the user's long-lived Edison API key (same credential the
 * dashboard login yields) plus a revocable ewc_ client credential used only to
 * revoke this installation on sign-out.
 */

export const DEVICE_CLIENT_ID = 'desktop'
export const DEVICE_SCOPES = ['api:full']

const SESSION_STORAGE_PREFIX = 'edison_device_session:'

export interface DeviceCodeGrant {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete: string
  expires_in: number
  interval: number
}

export interface DeviceTokenResponse {
  access_token: string
  token_type: string
  client_installation_id: string
  device_id: string
  scope: string[]
  user_id: string
  org_id: string
  /** The user's Edison API key - present for the desktop client. */
  api_key: string | null
}

/** Credentials persisted after a successful device login, keyed by env. */
export interface DeviceSession {
  apiKey: string
  /** Revocable ewc_ client credential - used only for sign-out revocation. */
  clientAccessToken: string
  clientInstallationId: string
  userId: string
  orgId: string
  email: string
}

export interface UserProfile {
  user_id: string
  email: string | null
  role: string
  domain: string
  org_id: string | null
  org_type: string
}

export class DeviceAuthError extends Error {
  code:
    | 'access_denied'
    | 'expired_token'
    | 'invalid_grant'
    | 'invalid_client'
    | 'invalid_scope'
    | 'network'
    | 'protocol'

  constructor(code: DeviceAuthError['code'], message: string) {
    super(message)
    this.code = code
  }
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Generate a PKCE verifier/challenge pair (S256) using WebCrypto. */
export async function generatePkce(): Promise<{ verifier: string; challenge: string }> {
  const random = new Uint8Array(48)
  crypto.getRandomValues(random)
  const verifier = base64UrlEncode(random)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return { verifier, challenge: base64UrlEncode(new Uint8Array(digest)) }
}

function trimBase(url: string): string {
  return url.replace(/\/$/, '')
}

/** Request a device code grant from the Edison backend. */
export async function requestDeviceCode(
  apiBaseUrl: string,
  info: { deviceLabel?: string; platform?: string; clientVersion?: string },
  challenge: string
): Promise<DeviceCodeGrant> {
  let res: Response
  try {
    res = await fetch(`${trimBase(apiBaseUrl)}/api/v1/auth/device/code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: DEVICE_CLIENT_ID,
        scope: DEVICE_SCOPES,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        device_label: info.deviceLabel,
        platform: info.platform,
        client_version: info.clientVersion
      }),
      // Bounded so a stalled request surfaces as a retryable error instead of
      // leaving the sign-in button disabled forever (no cancel exists yet at
      // this point in the flow - the waiting panel only appears with a grant).
      signal: AbortSignal.timeout(15_000)
    })
  } catch {
    throw new DeviceAuthError('network', 'Could not reach the Edison server.')
  }
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    const code = body?.error
    if (code === 'invalid_client' || code === 'invalid_scope') {
      throw new DeviceAuthError(code, `Device authorization rejected: ${code}`)
    }
    throw new DeviceAuthError('protocol', `Device code request failed (HTTP ${res.status})`)
  }
  // The numeric fields drive the polling loop: a non-finite expires_in would
  // disable the deadline (Date.now() > NaN is always false) and a bad
  // interval would produce a tight loop, so both are validated up front.
  if (
    !body?.device_code ||
    !body?.user_code ||
    !body?.verification_uri_complete ||
    !Number.isFinite(body.expires_in) ||
    body.expires_in <= 0 ||
    !Number.isFinite(body.interval) ||
    body.interval < 0
  ) {
    throw new DeviceAuthError('protocol', 'Device code response was missing required fields.')
  }
  return body as DeviceCodeGrant
}

/**
 * Parse a Retry-After header value: delta-seconds or HTTP-date.
 * Returns undefined for absent, invalid, or already-elapsed values.
 */
export function parseRetryAfterSeconds(value: string | null): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return seconds > 0 ? seconds : undefined
  const date = Date.parse(value)
  if (Number.isNaN(date)) return undefined
  const delta = (date - Date.now()) / 1000
  return delta > 0 ? delta : undefined
}

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new DOMException('Aborted', 'AbortError'))
      },
      { once: true }
    )
  })

/**
 * Poll the token endpoint until the grant is approved, denied, or expires.
 * Honors the server's pacing: waits `interval` seconds between polls and backs
 * off further on slow_down. Rejects with DeviceAuthError on terminal failures
 * and with AbortError if `signal` fires (user cancelled).
 */
export async function pollDeviceToken(
  apiBaseUrl: string,
  grant: DeviceCodeGrant,
  verifier: string,
  signal?: AbortSignal
): Promise<DeviceTokenResponse> {
  let waitSeconds = Math.max(grant.interval, 1)
  const deadline = Date.now() + grant.expires_in * 1000

  for (;;) {
    await sleep(waitSeconds * 1000, signal)
    if (Date.now() > deadline) {
      throw new DeviceAuthError('expired_token', 'The sign-in request expired. Please try again.')
    }

    let res: Response
    try {
      res = await fetch(`${trimBase(apiBaseUrl)}/api/v1/auth/device/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: DEVICE_CLIENT_ID,
          device_code: grant.device_code,
          code_verifier: verifier
        }),
        signal
      })
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err
      // Transient network failure - keep polling until the grant expires.
      continue
    }

    if (res.status === 429) {
      // Server-directed pacing only ever slows us down: take the max of the
      // current backoff and the Retry-After value so a short header can never
      // undo an earlier slow_down.
      const retryAfter = parseRetryAfterSeconds(res.headers.get('retry-after'))
      waitSeconds = Math.max(waitSeconds, retryAfter ?? waitSeconds + 5)
      continue
    }

    const body = await res.json().catch(() => null)
    if (res.ok) {
      if (
        !body ||
        typeof body.access_token !== 'string' ||
        typeof body.user_id !== 'string' ||
        typeof body.org_id !== 'string'
      ) {
        throw new DeviceAuthError('protocol', 'Token response was missing required fields.')
      }
      return body as DeviceTokenResponse
    }
    switch (body?.error) {
      case 'authorization_pending':
        continue
      case 'slow_down':
        waitSeconds += 5
        continue
      case 'access_denied':
        throw new DeviceAuthError('access_denied', 'The sign-in request was denied.')
      case 'expired_token':
        throw new DeviceAuthError('expired_token', 'The sign-in request expired. Please try again.')
      default:
        throw new DeviceAuthError(
          (body?.error as DeviceAuthError['code']) || 'protocol',
          `Sign-in failed: ${body?.error ?? `HTTP ${res.status}`}`
        )
    }
  }
}

/**
 * Fetch the user profile with an Edison API key (also validates the key).
 * Rethrows an abort of the caller's `signal` (a cancelled flow must be
 * distinguishable from an invalid key); every other failure returns null.
 */
export async function fetchUserProfile(
  apiBaseUrl: string,
  apiKey: string,
  timeoutMs = 5000,
  signal?: AbortSignal
): Promise<UserProfile | null> {
  const timeout = AbortSignal.timeout(timeoutMs)
  try {
    const res = await fetch(`${trimBase(apiBaseUrl)}/api/v1/user/profile`, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout
    })
    if (!res.ok) return null
    return (await res.json()) as UserProfile
  } catch (err) {
    if (signal?.aborted) throw err
    return null
  }
}

/**
 * Best-effort revocation of this installation's client credential.
 * Resolves true when the credential is confirmed gone (revoked now, or the
 * server no longer recognizes it); false when revocation could not be
 * confirmed (network failure or server error).
 */
export async function revokeDeviceSession(
  apiBaseUrl: string,
  clientAccessToken: string
): Promise<boolean> {
  if (!clientAccessToken) return true
  try {
    const res = await fetch(`${trimBase(apiBaseUrl)}/api/v1/auth/device/revoke`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${clientAccessToken}` },
      signal: AbortSignal.timeout(5000)
    })
    // 401 means the credential is already invalid or revoked - nothing to do.
    return res.ok || res.status === 401
  } catch {
    return false
  }
}

function sessionStorageKey(envName: string): string {
  return `${SESSION_STORAGE_PREFIX}${envName}`
}

export function loadStoredDeviceSession(envName: string): DeviceSession | null {
  try {
    const raw = localStorage.getItem(sessionStorageKey(envName))
    if (!raw) return null
    const parsed = JSON.parse(raw) as DeviceSession
    if (!parsed?.apiKey) return null
    return parsed
  } catch {
    return null
  }
}

export function storeDeviceSession(envName: string, session: DeviceSession): void {
  try {
    localStorage.setItem(sessionStorageKey(envName), JSON.stringify(session))
  } catch {
    // localStorage unavailable - session will not survive a restart.
  }
}

export function clearStoredDeviceSession(envName: string): void {
  try {
    localStorage.removeItem(sessionStorageKey(envName))
  } catch {
    // ignore
  }
}

/**
 * Sign out of the active env: revoke the installation credential (best-effort)
 * and drop the stored session. Shared by useAuth, WelcomeStep and MainMenu.
 *
 * The local session is cleared even when revocation cannot be confirmed:
 * destroying the only copy of the bearer token is the fail-safe (nobody can
 * use the installation afterwards), and the entry can still be revoked from
 * the dashboard's Devices page. Sign-out must work offline.
 */
export async function deviceSignOut(envName: string, apiBaseUrl: string): Promise<void> {
  const session = loadStoredDeviceSession(envName)
  if (session) {
    const confirmed = await revokeDeviceSession(apiBaseUrl, session.clientAccessToken)
    if (!confirmed) {
      console.warn(
        '[device-auth] Installation revocation was not confirmed by the server; ' +
          'the device entry can be revoked from the dashboard Devices page.'
      )
    }
  }
  clearStoredDeviceSession(envName)
}
