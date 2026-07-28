/**
 * Runtime environment configuration with debug switching support.
 *
 * Both "demo" and "release" configs are baked into the bundle at build time.
 * A debug switcher can override the active environment via localStorage,
 * allowing developers to toggle between demo and release backends
 * without rebuilding.
 *
 * Login goes through the Edison backend's device-authorization grant (see
 * packages/shared/src/auth/device-auth.ts), so the only auth origin the app
 * needs is API_BASE_URL - there is no Supabase configuration.
 */

export const STORAGE_KEY = 'edison_debug_env'

export interface EnvConfig {
  SENTRY_DSN: string
  POSTHOG_API_KEY: string
  POSTHOG_FEEDBACK_SURVEY_ID: string
  DEPLOY_ENV: string
  /** Default API server base URL for self-serve users (backend_base_url is null). */
  API_BASE_URL: string
  /** Default MCP server base URL for self-serve users. */
  MCP_BASE_URL: string
  /** Base URL of the desktop release bucket (electron-updater feed host). */
  RELEASES_BASE_URL: string
}

const DEMO_CONFIG: EnvConfig = {
  SENTRY_DSN:
    'https://521930844e674e4fe234bf7e2f2a8942@o4509236804190208.ingest.de.sentry.io/4509722815234128',
  POSTHOG_API_KEY: 'phc_KNuu0bmHlZwps48BcFYfax4aqVJJJWBF00mP43490CQ',
  POSTHOG_FEEDBACK_SURVEY_ID: '019c5262-bd68-0000-2209-0e41b3563834',
  DEPLOY_ENV: 'demo',
  API_BASE_URL: 'https://demo-dashboard.edison.watch',
  MCP_BASE_URL: 'https://edison-watch-demo.up.railway.app',
  RELEASES_BASE_URL: 'https://demo-releases.edison.watch'
}

const RELEASE_CONFIG: EnvConfig = {
  SENTRY_DSN:
    'https://521930844e674e4fe234bf7e2f2a8942@o4509236804190208.ingest.de.sentry.io/4509722815234128',
  POSTHOG_API_KEY: 'phc_KNuu0bmHlZwps48BcFYfax4aqVJJJWBF00mP43490CQ',
  POSTHOG_FEEDBACK_SURVEY_ID: '019c5262-bd68-0000-2209-0e41b3563834',
  DEPLOY_ENV: 'release',
  API_BASE_URL: 'https://dashboard.edison.watch',
  MCP_BASE_URL: 'https://mcp.edison.watch',
  RELEASES_BASE_URL: 'https://releases.edison.watch'
}

// Fully-offline local stack (docker-compose). Everything - including device
// authorization - is reached through the backend origin, so the app works via
// localhost, a LAN IP, or a Tailscale hostname with no hardcoded host (see
// resolveLocalConfig). The localhost values here are the no-window fallback
// (Electron main / SSR).
const LOCAL_CONFIG: EnvConfig = {
  SENTRY_DSN: '',
  POSTHOG_API_KEY: '',
  POSTHOG_FEEDBACK_SURVEY_ID: '',
  DEPLOY_ENV: 'local',
  API_BASE_URL: 'http://localhost:3001',
  MCP_BASE_URL: 'http://localhost:3000',
  RELEASES_BASE_URL: ''
}

const CONFIGS: Record<string, EnvConfig> = {
  demo: DEMO_CONFIG,
  release: RELEASE_CONFIG,
  local: LOCAL_CONFIG
}

/** MCP gateway port (sibling of the dashboard); overridable at build time. */
const LOCAL_MCP_PORT: string =
  (import.meta as unknown as { env?: { VITE_MCP_PORT?: string } }).env?.VITE_MCP_PORT ?? '3000'

/**
 * Resolve the local config against the live page origin so the API is always
 * same-origin (the backend serves the SPA). This is what makes the offline
 * stack reachable via localhost, a LAN IP, or a Tailscale hostname without
 * rebuilding. Falls back to LOCAL_CONFIG when there is no window (Electron
 * main process / SSR).
 */
function resolveLocalConfig(): EnvConfig {
  if (typeof window === 'undefined' || !window.location) return LOCAL_CONFIG
  const { origin, protocol, hostname } = window.location
  return {
    ...LOCAL_CONFIG,
    API_BASE_URL: origin,
    MCP_BASE_URL: `${protocol}//${hostname}:${LOCAL_MCP_PORT}`
  }
}

const BUILD_TIME_ENV: string =
  (import.meta as unknown as { env?: { VITE_DEPLOY_ENV?: string } }).env?.VITE_DEPLOY_ENV ?? 'demo'

export function getActiveEnvName(): string {
  try {
    const override = localStorage.getItem(STORAGE_KEY)
    if (override && override in CONFIGS) return override
  } catch {
    // localStorage unavailable
  }
  return BUILD_TIME_ENV
}

export function getEnv(): EnvConfig {
  const name = getActiveEnvName()
  if (name === 'local') return resolveLocalConfig()
  return CONFIGS[name] ?? CONFIGS['demo']!
}

/** Look up config by explicit name - safe for Node/main-process (no localStorage). */
export function getEnvByName(name: string): EnvConfig | undefined {
  if (name === 'local') return resolveLocalConfig()
  return CONFIGS[name]
}
