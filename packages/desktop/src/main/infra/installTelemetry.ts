/**
 * Windows installer funnel: the last step, `app_first_launch`.
 *
 * The NSIS installer (build/installerTelemetry.nsh) reports installer_started /
 * installer_step / installer_finished and, on success, writes
 * %LOCALAPPDATA%\SealGate\install-telemetry.json with a random install_id and
 * the capture endpoint it was built with. On the next app start we send one
 * `app_first_launch` event with the same install_id, then delete the file.
 *
 * Nothing here is on by default: the file only exists when the installer was
 * built with SG_INSTALL_TELEMETRY_URL + SG_INSTALL_TELEMETRY_KEY set. The event
 * is anonymous (no person profile, no GeoIP, no user or machine data), the
 * request has a short timeout, and every error is swallowed - this must never
 * delay or break app start.
 */

import { existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'

export const MARKER_FILE_NAME = 'install-telemetry.json'
/** Give up after this many failed sends (e.g. the machine is offline). */
export const MAX_ATTEMPTS = 3
export const SEND_TIMEOUT_MS = 3000

export interface InstallMarker {
  install_id: string
  app_version?: string
  upgrade?: boolean
  silent?: boolean
  url: string
  key: string
  attempts?: number
}

export interface FirstLaunchDeps {
  /** %LOCALAPPDATA% (process.env.LOCALAPPDATA on Windows). */
  localAppData: string | undefined
  appVersion: string
  /** Active backend env ("release", "demo", "custom", ...). */
  activeEnv: string
  env: NodeJS.ProcessEnv
  /** Electron's net.fetch in the app (Chromium stack, system proxy); global fetch in tests. */
  fetchImpl?: typeof fetch
  now?: () => number
  log?: (msg: string) => void
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Accept only an https endpoint, or plain http to a loopback mock. */
export function isAllowedEndpoint(raw: string): boolean {
  try {
    const u = new URL(raw)
    if (u.username || u.password || u.search || u.hash) return false
    if (u.protocol === 'https:') return true
    return u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost')
  } catch {
    return false
  }
}

export function parseMarker(text: string): InstallMarker | null {
  try {
    const m = JSON.parse(text) as Partial<InstallMarker>
    if (typeof m.install_id !== 'string' || !UUID_RE.test(m.install_id)) return null
    if (typeof m.url !== 'string' || !isAllowedEndpoint(m.url)) return null
    if (typeof m.key !== 'string' || !/^[A-Za-z0-9_-]+$/.test(m.key)) return null
    return m as InstallMarker
  } catch {
    return null
  }
}

export function telemetryOptedOut(env: NodeJS.ProcessEnv, activeEnv: string): boolean {
  if (env.DO_NOT_TRACK === '1' || env.SEALGATE_NO_TELEMETRY === '1') return true
  // Self-hosted or local backends never report to SealGate's projects.
  return activeEnv === 'custom' || activeEnv === 'local' || activeEnv === 'dev'
}

export function buildFirstLaunchEvent(
  marker: InstallMarker,
  appVersion: string,
  secondsSinceInstall: number | null
): Record<string, unknown> {
  return {
    api_key: marker.key,
    event: 'app_first_launch',
    distinct_id: marker.install_id,
    properties: {
      install_id: marker.install_id,
      source: 'desktop_app',
      app_version: appVersion,
      installer_version: marker.app_version ?? null,
      upgrade: marker.upgrade ?? null,
      silent: marker.silent ?? null,
      seconds_since_install: secondsSinceInstall,
      attempt: (marker.attempts ?? 0) + 1,
      os_platform: process.platform,
      os_arch: process.arch,
      $process_person_profile: false,
      $geoip_disable: true
    }
  }
}

function safeUnlink(path: string): void {
  try {
    unlinkSync(path)
  } catch {
    // already gone
  }
}

/**
 * Send app_first_launch once if the installer left a marker. Resolves to the
 * outcome (for tests and the startup log); never throws.
 */
export async function reportFirstLaunch(
  deps: FirstLaunchDeps
): Promise<'no-marker' | 'opted-out' | 'invalid' | 'sent' | 'failed' | 'gave-up'> {
  const log = deps.log ?? (() => {})
  try {
    if (!deps.localAppData) return 'no-marker'
    const path = join(deps.localAppData, 'SealGate', MARKER_FILE_NAME)
    if (!existsSync(path)) return 'no-marker'

    if (telemetryOptedOut(deps.env, deps.activeEnv)) {
      safeUnlink(path)
      return 'opted-out'
    }
    const marker = parseMarker(readFileSync(path, 'utf8'))
    if (!marker) {
      safeUnlink(path)
      return 'invalid'
    }

    const now = deps.now ?? Date.now
    let seconds: number | null = null
    try {
      seconds = Math.max(0, Math.round((now() - statSync(path).mtimeMs) / 1000))
    } catch {
      seconds = null
    }

    const body = buildFirstLaunchEvent(marker, deps.appVersion, seconds)
    const fetchImpl = deps.fetchImpl ?? fetch
    let ok = false
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      // Belt and braces: the abort signal is the normal path, the race is the
      // backstop for a fetch implementation that ignores it.
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), SEND_TIMEOUT_MS + 500)
      })
      const res = await Promise.race([
        fetchImpl(marker.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(SEND_TIMEOUT_MS)
        }),
        deadline
      ])
      ok = res.ok
    } catch {
      ok = false
    } finally {
      if (timer) clearTimeout(timer)
    }

    if (ok) {
      safeUnlink(path)
      log('[install-telemetry] app_first_launch sent')
      return 'sent'
    }
    const attempts = (marker.attempts ?? 0) + 1
    if (attempts >= MAX_ATTEMPTS) {
      safeUnlink(path)
      return 'gave-up'
    }
    try {
      writeFileSync(path, JSON.stringify({ ...marker, attempts }))
    } catch {
      safeUnlink(path)
    }
    return 'failed'
  } catch {
    return 'failed'
  }
}
