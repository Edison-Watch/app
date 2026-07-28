import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  DeviceAuthError,
  deviceSignOut,
  parseRetryAfterSeconds,
  pollDeviceToken,
  requestDeviceCode,
  revokeDeviceSession,
  storeDeviceSession,
  loadStoredDeviceSession,
  type DeviceCodeGrant
} from '../device-auth'

const GRANT: DeviceCodeGrant = {
  device_code: 'device-code',
  user_code: 'ABCD-EFGH',
  verification_uri: 'http://backend/device',
  verification_uri_complete: 'http://backend/device?user_code=ABCD-EFGH',
  expires_in: 600,
  interval: 1
}

const VALID_TOKEN = {
  access_token: 'ewc_token',
  token_type: 'Bearer',
  client_installation_id: 'inst-1',
  device_id: 'ewd_1',
  scope: ['api:full'],
  user_id: 'user-1',
  org_id: 'org-1',
  api_key: 'ew_key'
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  })
}

describe('parseRetryAfterSeconds', () => {
  it('parses delta-seconds', () => {
    expect(parseRetryAfterSeconds('30')).toBe(30)
  })

  it('parses HTTP-date values in the future', () => {
    const inTen = new Date(Date.now() + 10_000).toUTCString()
    const parsed = parseRetryAfterSeconds(inTen)
    expect(parsed).toBeGreaterThan(5)
    expect(parsed).toBeLessThanOrEqual(10)
  })

  it('rejects absent, invalid, and elapsed values', () => {
    expect(parseRetryAfterSeconds(null)).toBeUndefined()
    expect(parseRetryAfterSeconds('soon')).toBeUndefined()
    expect(parseRetryAfterSeconds('0')).toBeUndefined()
    expect(parseRetryAfterSeconds(new Date(Date.now() - 60_000).toUTCString())).toBeUndefined()
  })
})

describe('requestDeviceCode', () => {
  afterEach(() => vi.restoreAllMocks())

  const VALID_GRANT_BODY = {
    device_code: 'device-code',
    user_code: 'ABCD-EFGH',
    verification_uri: 'http://backend/device',
    verification_uri_complete: 'http://backend/device?user_code=ABCD-EFGH',
    expires_in: 600,
    interval: 7
  }

  it('returns a valid grant', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(VALID_GRANT_BODY))
    await expect(requestDeviceCode('http://backend', {}, 'c'.repeat(43))).resolves.toMatchObject({
      user_code: 'ABCD-EFGH',
      interval: 7
    })
  })

  it.each([
    ['missing expires_in', { ...VALID_GRANT_BODY, expires_in: undefined }],
    ['non-numeric expires_in', { ...VALID_GRANT_BODY, expires_in: 'soon' }],
    ['zero expires_in', { ...VALID_GRANT_BODY, expires_in: 0 }],
    ['missing interval', { ...VALID_GRANT_BODY, interval: undefined }],
    ['negative interval', { ...VALID_GRANT_BODY, interval: -1 }],
    ['missing device_code', { ...VALID_GRANT_BODY, device_code: '' }]
  ])('rejects a 200 grant with %s (would break the polling loop)', async (_label, body) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(body))
    await expect(requestDeviceCode('http://backend', {}, 'c'.repeat(43))).rejects.toMatchObject({
      code: 'protocol'
    })
  })
})

describe('pollDeviceToken', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  async function pollOnce(response: Response): Promise<unknown> {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response)
    const promise = pollDeviceToken('http://backend', GRANT, 'verifier')
    const settled = promise.catch((err: unknown) => err)
    await vi.advanceTimersByTimeAsync(1000)
    return settled
  }

  it('returns a validated token body', async () => {
    const result = await pollOnce(jsonResponse(VALID_TOKEN))
    expect(result).toMatchObject({ access_token: 'ewc_token', api_key: 'ew_key' })
  })

  it('rejects a 2xx response with a malformed body instead of returning it', async () => {
    const result = await pollOnce(jsonResponse({ unexpected: true }))
    expect(result).toBeInstanceOf(DeviceAuthError)
    expect((result as DeviceAuthError).code).toBe('protocol')
  })

  it('rejects a 2xx response with an unparseable body', async () => {
    const result = await pollOnce(new Response('not json', { status: 200 }))
    expect(result).toBeInstanceOf(DeviceAuthError)
    expect((result as DeviceAuthError).code).toBe('protocol')
  })

  it('never lets a short Retry-After reduce an accumulated backoff', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      // First poll: slow_down raises the interval to 6s.
      .mockResolvedValueOnce(jsonResponse({ error: 'slow_down' }, 400))
      // Second poll: 429 with a shorter Retry-After must NOT lower it.
      .mockResolvedValueOnce(jsonResponse({ error: 'rate limited' }, 429, { 'Retry-After': '2' }))
      .mockResolvedValue(jsonResponse(VALID_TOKEN))

    const promise = pollDeviceToken('http://backend', GRANT, 'verifier')
    await vi.advanceTimersByTimeAsync(1000) // initial interval -> slow_down (now 6s)
    await vi.advanceTimersByTimeAsync(6000) // backoff -> 429 with Retry-After: 2
    expect(fetchMock).toHaveBeenCalledTimes(2)
    // If the short Retry-After were honored, the third call would fire at +2s.
    await vi.advanceTimersByTimeAsync(2000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(4000) // completes the preserved 6s backoff
    expect(fetchMock).toHaveBeenCalledTimes(3)
    await expect(promise).resolves.toMatchObject({ access_token: 'ewc_token' })
  })
})

describe('revokeDeviceSession', () => {
  afterEach(() => vi.restoreAllMocks())

  it.each([
    [200, true],
    [401, true],
    [500, false],
    [403, false]
  ])('treats HTTP %i as confirmed=%s', async (status, expected) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({}, status))
    await expect(revokeDeviceSession('http://backend', 'ewc_x')).resolves.toBe(expected)
  })

  it('returns false on network failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'))
    await expect(revokeDeviceSession('http://backend', 'ewc_x')).resolves.toBe(false)
  })
})

describe('deviceSignOut', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('clears the stored session even when revocation is unconfirmed', async () => {
    storeDeviceSession('demo', {
      apiKey: 'ew_key',
      clientAccessToken: 'ewc_x',
      clientInstallationId: 'inst-1',
      userId: 'user-1',
      orgId: 'org-1',
      email: 'a@b.c'
    })
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await deviceSignOut('demo', 'http://backend')

    expect(loadStoredDeviceSession('demo')).toBeNull()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Devices page'))
  })
})
