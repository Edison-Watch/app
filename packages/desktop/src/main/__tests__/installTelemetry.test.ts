import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { execFileSync } from 'child_process'

import {
  MARKER_FILE_NAME,
  MAX_ATTEMPTS,
  buildFirstLaunchEvent,
  isAllowedEndpoint,
  parseMarker,
  reportFirstLaunch,
  telemetryOptedOut,
  type InstallMarker
} from '../infra/installTelemetry'

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e'
const MARKER: InstallMarker = {
  install_id: ID,
  app_version: '0.6.23',
  upgrade: false,
  silent: false,
  url: 'http://127.0.0.1:8787/i/v0/e/',
  key: 'phc_test'
}

let dir: string
const markerPath = (): string => join(dir, 'SealGate', MARKER_FILE_NAME)
const writeMarker = (m: unknown): void => {
  mkdirSync(join(dir, 'SealGate'), { recursive: true })
  writeFileSync(markerPath(), typeof m === 'string' ? m : JSON.stringify(m))
}
const okFetch = (): ReturnType<typeof vi.fn> =>
  vi.fn(async () => new Response('{"status":"Ok"}', { status: 200 }))

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sg-install-telemetry-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const deps = (over: Record<string, unknown> = {}) => ({
  localAppData: dir,
  appVersion: '0.6.23',
  activeEnv: 'release',
  env: {},
  ...over
})

describe('isAllowedEndpoint', () => {
  it('accepts https and loopback http only', () => {
    expect(isAllowedEndpoint('https://us.i.posthog.com/i/v0/e/')).toBe(true)
    expect(isAllowedEndpoint('http://127.0.0.1:8787/i/v0/e/')).toBe(true)
    expect(isAllowedEndpoint('http://localhost:8787/x')).toBe(true)
    expect(isAllowedEndpoint('http://evil.example/x')).toBe(false)
    expect(isAllowedEndpoint('https://a.example/x?token=1')).toBe(false)
    expect(isAllowedEndpoint('https://user:pw@a.example/x')).toBe(false)
    expect(isAllowedEndpoint('file:///c:/x')).toBe(false)
    expect(isAllowedEndpoint('not a url')).toBe(false)
  })
})

describe('parseMarker', () => {
  it('parses a valid marker', () => {
    expect(parseMarker(JSON.stringify(MARKER))?.install_id).toBe(ID)
  })
  it('rejects bad ids, endpoints, keys and junk', () => {
    expect(parseMarker(JSON.stringify({ ...MARKER, install_id: 'me@example.com' }))).toBeNull()
    expect(parseMarker(JSON.stringify({ ...MARKER, url: 'http://evil.example/' }))).toBeNull()
    expect(parseMarker(JSON.stringify({ ...MARKER, key: 'a"b' }))).toBeNull()
    expect(parseMarker('{not json')).toBeNull()
  })
})

describe('telemetryOptedOut', () => {
  it('honours DO_NOT_TRACK, SEALGATE_NO_TELEMETRY and non-SealGate backends', () => {
    expect(telemetryOptedOut({}, 'release')).toBe(false)
    expect(telemetryOptedOut({}, 'demo')).toBe(false)
    expect(telemetryOptedOut({ DO_NOT_TRACK: '1' }, 'release')).toBe(true)
    expect(telemetryOptedOut({ SEALGATE_NO_TELEMETRY: '1' }, 'release')).toBe(true)
    expect(telemetryOptedOut({}, 'custom')).toBe(true)
    expect(telemetryOptedOut({}, 'dev')).toBe(true)
  })
})

describe('buildFirstLaunchEvent', () => {
  it('is anonymous and carries only the funnel fields', () => {
    const ev = buildFirstLaunchEvent(MARKER, '0.6.23', 12)
    expect(ev).toMatchObject({ event: 'app_first_launch', distinct_id: ID, api_key: 'phc_test' })
    const props = ev.properties as Record<string, unknown>
    expect(props.$process_person_profile).toBe(false)
    expect(props.$geoip_disable).toBe(true)
    expect(props.seconds_since_install).toBe(12)
    expect(Object.keys(props).sort()).toEqual(
      [
        '$geoip_disable',
        '$process_person_profile',
        'app_version',
        'attempt',
        'install_id',
        'installer_version',
        'os_arch',
        'os_platform',
        'seconds_since_install',
        'silent',
        'source',
        'upgrade'
      ].sort()
    )
  })
})

describe('reportFirstLaunch', () => {
  it('does nothing without a marker', async () => {
    const f = okFetch()
    expect(await reportFirstLaunch(deps({ fetchImpl: f }))).toBe('no-marker')
    expect(await reportFirstLaunch(deps({ localAppData: undefined, fetchImpl: f }))).toBe('no-marker')
    expect(f).not.toHaveBeenCalled()
  })

  it('sends once to the marker endpoint and deletes the marker', async () => {
    writeMarker(MARKER)
    const f = okFetch()
    expect(await reportFirstLaunch(deps({ fetchImpl: f }))).toBe('sent')
    expect(f).toHaveBeenCalledTimes(1)
    const [url, init] = f.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(MARKER.url)
    expect(JSON.parse(init.body as string).event).toBe('app_first_launch')
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(existsSync(markerPath())).toBe(false)
    expect(await reportFirstLaunch(deps({ fetchImpl: f }))).toBe('no-marker')
  })

  it('deletes the marker without sending when opted out', async () => {
    writeMarker(MARKER)
    const f = okFetch()
    expect(await reportFirstLaunch(deps({ env: { DO_NOT_TRACK: '1' }, fetchImpl: f }))).toBe(
      'opted-out'
    )
    expect(f).not.toHaveBeenCalled()
    expect(existsSync(markerPath())).toBe(false)
  })

  it('deletes an invalid marker', async () => {
    writeMarker('garbage')
    expect(await reportFirstLaunch(deps({ fetchImpl: okFetch() }))).toBe('invalid')
    expect(existsSync(markerPath())).toBe(false)
  })

  it('never throws on network errors, retries, then gives up', async () => {
    writeMarker(MARKER)
    const boom = vi.fn(async () => {
      throw new Error('offline')
    })
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      expect(await reportFirstLaunch(deps({ fetchImpl: boom }))).toBe('failed')
      expect(JSON.parse(readFileSync(markerPath(), 'utf8')).attempts).toBe(i)
    }
    expect(await reportFirstLaunch(deps({ fetchImpl: boom }))).toBe('gave-up')
    expect(existsSync(markerPath())).toBe(false)
  })

  it('treats a non-2xx response as a failed attempt', async () => {
    writeMarker(MARKER)
    const bad = vi.fn(async () => new Response('', { status: 500 }))
    expect(await reportFirstLaunch(deps({ fetchImpl: bad }))).toBe('failed')
  })
})

describe('scripts/installer-telemetry-config.mjs', () => {
  const script = join(__dirname, '..', '..', '..', 'scripts', 'installer-telemetry-config.mjs')
  const run = (env: Record<string, string>): { out: string; ok: boolean } => {
    const out = join(dir, 'cfg.nsh')
    try {
      execFileSync(process.execPath, [script, out], {
        env: { PATH: process.env.PATH ?? '', ...env },
        stdio: 'pipe'
      })
      return { out, ok: true }
    } catch {
      return { out, ok: false }
    }
  }

  it('is disabled (no file) without URL and key', () => {
    const { out, ok } = run({})
    expect(ok).toBe(true)
    expect(existsSync(out)).toBe(false)
  })

  it('removes a stale config when disabled', () => {
    writeFileSync(join(dir, 'cfg.nsh'), 'stale')
    const { out } = run({ SG_INSTALL_TELEMETRY_URL: 'https://us.i.posthog.com/i/v0/e/' })
    expect(existsSync(out)).toBe(false)
  })

  it('writes NSIS defines for an https endpoint', () => {
    const { out, ok } = run({
      SG_INSTALL_TELEMETRY_URL: 'https://us.i.posthog.com/i/v0/e/',
      SG_INSTALL_TELEMETRY_KEY: 'phc_abc123'
    })
    expect(ok).toBe(true)
    const text = readFileSync(out, 'utf8')
    expect(text).toContain('!define SG_IT_ENABLED')
    expect(text).toContain('!define SG_IT_HOST "us.i.posthog.com"')
    expect(text).toContain('!define SG_IT_PORT 443')
    expect(text).toContain('!define SG_IT_PATH "/i/v0/e/"')
    expect(text).toContain('!define SG_IT_SECURE 1')
  })

  it('refuses plain http to a non-loopback host and odd keys', () => {
    expect(
      run({ SG_INSTALL_TELEMETRY_URL: 'http://example.com/e/', SG_INSTALL_TELEMETRY_KEY: 'phc_x' }).ok
    ).toBe(false)
    expect(
      run({ SG_INSTALL_TELEMETRY_URL: 'https://a.example/e/', SG_INSTALL_TELEMETRY_KEY: 'a"b' }).ok
    ).toBe(false)
  })
})
