/**
 * Runtime environment configuration with debug switching support.
 *
 * Both "demo" and "release" configs are baked into the bundle at build time.
 * A debug switcher can override the active environment via localStorage,
 * allowing developers to toggle between demo and release Supabase projects
 * without rebuilding.
 *
 * All anon keys are publishable (safe to include in client bundles).
 */

export const STORAGE_KEY = 'edison_debug_env'

export interface EnvConfig {
  /** GoTrue / Supabase auth origin (supabase-js base URL). */
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
  /**
   * Base URL for the Supabase edge functions (get-api-key, invite-user). In
   * the cloud this equals SUPABASE_URL; offline it points at the Edison backend,
   * which reimplements those functions at /functions/v1 (TEST_AUTH_MODE=local).
   */
  FUNCTIONS_URL: string
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
  SUPABASE_URL: 'https://bdabdocijxbncjmldwxa.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_ldnSefSaPmWEYGdbi7yURQ_XmMmkLEP',
  FUNCTIONS_URL: 'https://bdabdocijxbncjmldwxa.supabase.co',
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
  SUPABASE_URL: 'https://aghapravwywtjhudszur.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_tn5PeagDqytqWP8G9a4QkA_88PxOaFZ',
  FUNCTIONS_URL: 'https://aghapravwywtjhudszur.supabase.co',
  SENTRY_DSN:
    'https://521930844e674e4fe234bf7e2f2a8942@o4509236804190208.ingest.de.sentry.io/4509722815234128',
  POSTHOG_API_KEY: 'phc_KNuu0bmHlZwps48BcFYfax4aqVJJJWBF00mP43490CQ',
  POSTHOG_FEEDBACK_SURVEY_ID: '019c5262-bd68-0000-2209-0e41b3563834',
  DEPLOY_ENV: 'release',
  API_BASE_URL: 'https://dashboard.edison.watch',
  MCP_BASE_URL: 'https://mcp.edison.watch',
  RELEASES_BASE_URL: 'https://releases.edison.watch'
}

// Fully-offline local stack (docker-compose). Auth (GoTrue) and the edge
// functions are both reached SAME-ORIGIN through the backend: /auth/v1 is
// reverse-proxied to GoTrue and /functions/v1 is reimplemented locally. So the
// dashboard talks only to its own origin - works via localhost, a LAN IP, or a
// Tailscale hostname with no hardcoded host (see resolveLocalConfig). The
// localhost values here are the no-window fallback (Electron main / SSR).
const LOCAL_CONFIG: EnvConfig = {
  SUPABASE_URL: 'http://localhost:3001',
  SUPABASE_ANON_KEY: 'local-anon-key',
  FUNCTIONS_URL: 'http://localhost:3001',
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
 * Resolve the local config against the live page origin so auth/api are always
 * same-origin (the backend serves the SPA and proxies /auth/v1 + /functions/v1).
 * This is what makes the offline stack reachable via localhost, a LAN IP, or a
 * Tailscale hostname without rebuilding. Falls back to LOCAL_CONFIG when there
 * is no window (Electron main process / SSR).
 */
function resolveLocalConfig(): EnvConfig {
  if (typeof window === 'undefined' || !window.location) return LOCAL_CONFIG
  const { origin, protocol, hostname } = window.location
  return {
    ...LOCAL_CONFIG,
    SUPABASE_URL: origin,
    FUNCTIONS_URL: origin,
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
