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
  /** Per-download id from the installer's file name (16 hex), when there was one. */
  download_id?: string
  download_id_source?: 'filename' | 'zone_identifier'
  url: string
  key: string
  attempts?: number
  /** Set by the app on the first failed send, so retries keep the install time. */
  installed_at_ms?: number
}

/** The part of fetch this module uses (Electron's net.fetch in the app). */
export type PostFn = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }
) => Promise<{ ok: boolean }>

export interface FirstLaunchDeps {
  /** %LOCALAPPDATA% (process.env.LOCALAPPDATA on Windows). */
  localAppData: string | undefined
  appVersion: string
  /** Active backend env ("release", "demo", "custom", ...). */
  activeEnv: string
  env: NodeJS.ProcessEnv
  /** Electron's net.fetch in the app (Chromium stack, system proxy); global fetch by default. */
  fetchImpl?: PostFn
  now?: () => number
}

const DOWNLOAD_ID_RE = /^[0-9a-f]{16}$/i
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
    // A malformed download id is dropped, not fatal: the event still goes out.
    if (m.download_id !== undefined && !DOWNLOAD_ID_RE.test(String(m.download_id))) {
      delete m.download_id
      delete m.download_id_source
    }
    if (m.download_id_source !== 'filename' && m.download_id_source !== 'zone_identifier') {
      delete m.download_id_source
    }
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
      ...(marker.download_id
        ? {
            download_id: marker.download_id.toLowerCase(),
            download_id_source: marker.download_id_source ?? null
          }
        : {}),
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
    // The installer writes the marker at install time; a retry rewrites it, so
    // from then on the original time travels inside the marker.
    let installedAt: number | null = marker.installed_at_ms ?? null
    if (installedAt === null) {
      try {
        installedAt = statSync(path).mtimeMs
      } catch {
        installedAt = null
      }
    }
    const seconds =
      installedAt === null ? null : Math.max(0, Math.round((now() - installedAt) / 1000))

    const body = buildFirstLaunchEvent(marker, deps.appVersion, seconds)
    const fetchImpl: PostFn = deps.fetchImpl ?? fetch
    let ok = false
    try {
      const res = await fetchImpl(marker.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS)
      })
      ok = res.ok
    } catch {
      ok = false
    }

    if (ok) {
      safeUnlink(path)
      return 'sent'
    }
    const attempts = (marker.attempts ?? 0) + 1
    if (attempts >= MAX_ATTEMPTS) {
      safeUnlink(path)
      return 'gave-up'
    }
    try {
      const next: InstallMarker = { ...marker, attempts }
      if (installedAt !== null) next.installed_at_ms = installedAt
      writeFileSync(path, JSON.stringify(next))
    } catch {
      safeUnlink(path)
    }
    return 'failed'
  } catch {
    return 'failed'
  }
}
