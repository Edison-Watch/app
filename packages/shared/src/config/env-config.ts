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

const STORAGE_KEY = "edison_debug_env";

export interface EnvConfig {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SENTRY_DSN: string;
  POSTHOG_API_KEY: string;
  POSTHOG_FEEDBACK_SURVEY_ID: string;
  DEPLOY_ENV: string;
}

const DEMO_CONFIG: EnvConfig = {
  SUPABASE_URL: "https://bdabdocijxbncjmldwxa.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_ldnSefSaPmWEYGdbi7yURQ_XmMmkLEP",
  SENTRY_DSN:
    "https://521930844e674e4fe234bf7e2f2a8942@o4509236804190208.ingest.de.sentry.io/4509722815234128",
  POSTHOG_API_KEY: "phc_KNuu0bmHlZwps48BcFYfax4aqVJJJWBF00mP43490CQ",
  POSTHOG_FEEDBACK_SURVEY_ID: "019c5262-bd68-0000-2209-0e41b3563834",
  DEPLOY_ENV: "demo",
};

const RELEASE_CONFIG: EnvConfig = {
  SUPABASE_URL: "https://aghapravwywtjhudszur.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_tn5PeagDqytqWP8G9a4QkA_88PxOaFZ",
  SENTRY_DSN:
    "https://521930844e674e4fe234bf7e2f2a8942@o4509236804190208.ingest.de.sentry.io/4509722815234128",
  POSTHOG_API_KEY: "phc_KNuu0bmHlZwps48BcFYfax4aqVJJJWBF00mP43490CQ",
  POSTHOG_FEEDBACK_SURVEY_ID: "019c5262-bd68-0000-2209-0e41b3563834",
  DEPLOY_ENV: "release",
};

const CONFIGS: Record<string, EnvConfig> = {
  demo: DEMO_CONFIG,
  release: RELEASE_CONFIG,
};

const BUILD_TIME_ENV: string =
  (import.meta as unknown as { env?: { VITE_DEPLOY_ENV?: string } }).env?.VITE_DEPLOY_ENV ?? "demo";

export function getActiveEnvName(): string {
  try {
    const override = localStorage.getItem(STORAGE_KEY);
    if (override && override in CONFIGS) return override;
  } catch {
    // localStorage unavailable
  }
  return BUILD_TIME_ENV;
}

export function getEnv(): EnvConfig {
  const name = getActiveEnvName();
  return CONFIGS[name] ?? CONFIGS["demo"]!;
}
