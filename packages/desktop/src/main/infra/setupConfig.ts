/**
 * Setup data persistence, URL helpers, debug-env switcher, and server status checks.
 *
 * Extracted from index.ts to keep the main entry point under the 800-line CI limit.
 */

import { app } from "electron";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { getEnvByName } from "@edison-watch/shared/config";
import { logClaudeCmd } from "../runtime/monitorLog";

const execFileAsync = promisify(execFile);

// ── Dry-run mode ────────────────────────────────────────────────────

/** When true, onboarding runs normally but config files are not written. */
export const DRY_RUN = process.env.EDISON_DRY_RUN === "1";
if (DRY_RUN) console.log("[dry-run] Dry-run mode enabled - config files will not be modified");

// ── Debug environment switcher ───────────────────────────────────────

// "custom" = a self-hosted Edison deployment the user points the app at by
// URL (docker-compose stack, Railway instance, ...). Its URLs live alongside
// the env name in the override file - see getCustomBackend().
export const DEBUG_ENV_NAMES = ["demo", "release", "dev", "custom"] as const;
export type DebugEnvName = (typeof DEBUG_ENV_NAMES)[number];

function isDebugEnvName(v: string | undefined): v is DebugEnvName {
  return (DEBUG_ENV_NAMES as readonly string[]).includes(v ?? "");
}

/** The environment this binary was compiled for (from VITE_DEPLOY_ENV at build time). */
export function getBuildDefaultEnv(): DebugEnvName | null {
  const is = { get dev() { return !app.isPackaged; } };
  if (is.dev) return "dev";
  const v = import.meta.env.VITE_DEPLOY_ENV as string | undefined;
  if (isDebugEnvName(v)) return v;
  return null;
}

// "dev" = localhost backend (make dev / make demo_server)
export const DEV_MCP_BASE_URL = "http://localhost:3000";
export const DEV_API_BASE_URL = "http://localhost:3001";

// Per-env default API/MCP URLs for self-serve users (backend_base_url is null).
// Values are injected at build time from frontend-v2/.env.<mode> - do not hardcode here.
export const ENV_API_URL: string = import.meta.env.VITE_API_BASE_URL ?? "";
export const ENV_MCP_URL: string = import.meta.env.VITE_MCP_BASE_URL ?? "";
export const ENV_DOCS_URL: string = import.meta.env.VITE_DOCS_BASE_URL ?? "https://docs.edison.watch";

// Derive per-env URLs from the shared config (single source of truth).
// "custom" is resolved here, not in the shared package: the main process has
// no localStorage, so the custom URLs live in the override file instead.
function getEnvUrls(env: string): { api: string; mcp: string } | null {
  if (env === "custom") {
    const custom = getCustomBackend();
    return custom ? { api: custom.apiBaseUrl, mcp: custom.mcpBaseUrl } : null;
  }
  const cfg = getEnvByName(env);
  return cfg ? { api: cfg.API_BASE_URL, mcp: cfg.MCP_BASE_URL } : null;
}

export function getDebugEnvOverridePath(): string {
  return join(app.getPath("userData"), "edison_debug_env.json");
}

interface DebugEnvOverrideFile {
  env?: string;
  customApiBaseUrl?: string;
  customMcpBaseUrl?: string;
}

function readDebugEnvOverrideFile(): DebugEnvOverrideFile {
  try {
    const p = getDebugEnvOverridePath();
    if (!existsSync(p)) return {};
    const parsed: unknown = JSON.parse(readFileSync(p, "utf-8"));
    // JSON.parse("null") and friends succeed - only a plain object is usable.
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as DebugEnvOverrideFile;
  } catch {
    return {};
  }
}

export function getDebugEnvOverride(): DebugEnvName | null {
  const data = readDebugEnvOverrideFile();
  if (!isDebugEnvName(data.env)) return null;
  // "custom" without stored URLs is meaningless - treat as no override.
  if (data.env === "custom" && !getCustomBackend()) return null;
  return data.env;
}

export function setDebugEnvOverride(env: DebugEnvName | null): void {
  try {
    const p = getDebugEnvOverridePath();
    // Keep the stored custom URLs when toggling between environments (or
    // clearing the override) so switching away from "custom" and back does
    // not lose the URL. The file is only removed when nothing else is in it.
    const existing = readDebugEnvOverrideFile();
    if (env === null) {
      delete existing.env;
      if (Object.keys(existing).length > 0) {
        writeFileSync(p, JSON.stringify(existing), "utf-8");
      } else if (existsSync(p)) {
        unlinkSync(p);
      }
      return;
    }
    writeFileSync(p, JSON.stringify({ ...existing, env }), "utf-8");
  } catch {
    // best effort only
  }
}

// ── Custom (self-hosted) backend ─────────────────────────────────────

export interface CustomBackendUrls {
  apiBaseUrl: string;
  mcpBaseUrl: string;
}

function normalizeOrigin(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/** Validate a candidate custom backend URL; returns the normalized form or null. */
export function parseCustomBackendUrl(raw: string): string | null {
  const candidate = normalizeOrigin(raw);
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    // No embedded credentials: the URL is logged and shown in menus, and the
    // backend never needs them. No query/fragment either - endpoint paths are
    // appended to this value, so either would silently break every API call.
    if (parsed.username || parsed.password) return null;
    if (parsed.search || parsed.hash) return null;
    return candidate;
  } catch {
    return null;
  }
}

/** The stored custom backend URLs, or null when never configured. */
export function getCustomBackend(): CustomBackendUrls | null {
  const data = readDebugEnvOverrideFile();
  const api = typeof data.customApiBaseUrl === "string" ? data.customApiBaseUrl : "";
  if (!api) return null;
  // The backend serves /mcp/<key>/ same-origin, so one URL covers both.
  const mcp = typeof data.customMcpBaseUrl === "string" && data.customMcpBaseUrl
    ? data.customMcpBaseUrl
    : api;
  return { apiBaseUrl: api, mcpBaseUrl: mcp };
}

/**
 * Persist the custom backend URLs and make "custom" the active environment.
 * Throws on an invalid URL - callers surface the message to the user.
 */
export function setCustomBackend(apiBaseUrl: string, mcpBaseUrl?: string): CustomBackendUrls {
  const api = parseCustomBackendUrl(apiBaseUrl);
  if (!api) throw new Error(`Not a valid http(s) URL: ${apiBaseUrl}`);
  const mcp = mcpBaseUrl ? parseCustomBackendUrl(mcpBaseUrl) : api;
  if (!mcp) throw new Error(`Not a valid http(s) URL: ${mcpBaseUrl}`);
  const existing = readDebugEnvOverrideFile();
  writeFileSync(
    getDebugEnvOverridePath(),
    JSON.stringify({ ...existing, env: "custom", customApiBaseUrl: api, customMcpBaseUrl: mcp }),
    "utf-8",
  );
  return { apiBaseUrl: api, mcpBaseUrl: mcp };
}

// ── Setup data persistence ──────────────────────────────────────────

export const ALL_SUPPORTED_APPS = [
  "vscode", "cursor", "claude-desktop",
  "claude-code", "claude-cowork", "windsurf", "zed", "codex",
  "intellij", "pycharm", "webstorm",
];

export interface EnvCredentials {
  apiKey: string;
  edisonSecretKey?: string;
}

export interface SetupData {
  completed?: boolean;
  userEmail?: string;
  userId?: string;
  serverAddress?: string;
  mcpBaseUrl?: string;
  apiBaseUrl?: string;
  apiKey?: string;
  edisonSecretKey?: string;
  configuredApps?: string[];
  /** Per-environment credentials so switching envs also switches API keys. */
  envCredentials?: Record<string, EnvCredentials>;
  /** One-time migration flags (keyed by migration name). */
  appliedMigrations?: string[];
}

let setupCompleted: boolean | null = null;

export function getSetupFlagPath(): string {
  return join(app.getPath("userData"), "setup.json");
}

export function getSetupData(): SetupData {
  try {
    const raw = readFileSync(getSetupFlagPath(), "utf-8");
    return JSON.parse(raw) as SetupData;
  } catch {
    return { completed: false };
  }
}

export function isSetupComplete(): boolean {
  if (setupCompleted !== null) return setupCompleted;
  const data = getSetupData();
  setupCompleted = data.completed === true;
  return setupCompleted;
}

export function markSetupComplete(data?: Partial<SetupData>): void {
  const existing = getSetupData();
  const merged: SetupData = { ...existing, ...data, completed: true };

  // Persist the current credentials into the per-env map so switching
  // environments later recalls the right ones.
  //
  // The apiKey may exist ONLY in this map: a returning login keeps it in the
  // renderer's auth state and never writes it top-level. Gating this block on
  // the top-level key therefore skipped the update for exactly those setups, so
  // saving a new org key left `envCredentials[env].edisonSecretKey` stale - and
  // getCredentialsForEnv() prefers that entry, so every later reader (daemon
  // enrollment included) kept handing out the OLD secret.
  const env = getActiveEnv();
  const envCreds = merged.envCredentials ?? {};
  const existingEnvEntry = envCreds[env];
  const resolvedApiKey = data?.apiKey ?? existingEnvEntry?.apiKey ?? merged.apiKey;
  const resolvedSecret =
    data?.edisonSecretKey ?? existingEnvEntry?.edisonSecretKey ?? merged.edisonSecretKey;
  if (resolvedApiKey) {
    envCreds[env] = {
      apiKey: resolvedApiKey,
      ...(resolvedSecret && { edisonSecretKey: resolvedSecret }),
    };
    merged.envCredentials = envCreds;
  }

  writeFileSync(getSetupFlagPath(), JSON.stringify(merged, null, 2), "utf-8");
  setupCompleted = true;
  // On macOS setLoginItemSettings ignores `path`/`args` (Windows-only) and always
  // registers the bundle owning process.execPath. Unpackaged that is
  // node_modules/electron/dist/Electron.app, which then boots with no app path and
  // shows Electron's default splash window. Only register from a packaged build.
  const is = { get dev() { return !app.isPackaged; } };
  if (!is.dev) app.setLoginItemSettings({ openAtLogin: true });
  // Persist to multi-account store (best-effort, non-critical)
  try {
    saveAccount(merged);
  } catch {
    // non-fatal - account switcher entry will be missing but setup succeeds
  }
}

export function markSetupIncomplete(): void {
  writeFileSync(getSetupFlagPath(), JSON.stringify({ completed: false }), "utf-8");
  setupCompleted = false;
  // Deliberately not dev-guarded: unregistering only ever targets this build's own
  // bundle, so a dev run clearing a stale dev registration is self-healing and
  // cannot affect a packaged install's login item.
  app.setLoginItemSettings({ openAtLogin: false });
}

// ── Multi-account persistence ────────────────────────────────────────

export interface SavedAccount {
  userId: string;
  userEmail: string;
  serverAddress?: string;
  mcpBaseUrl?: string;
  apiBaseUrl?: string;
  apiKey?: string;
  edisonSecretKey?: string;
  configuredApps?: string[];
  envCredentials?: Record<string, EnvCredentials>;
  savedAt: string;
}

function getAccountsPath(): string {
  return join(app.getPath("userData"), "accounts.json");
}

export function getSavedAccounts(): SavedAccount[] {
  try {
    const raw = readFileSync(getAccountsPath(), "utf-8");
    const data = JSON.parse(raw) as { accounts?: SavedAccount[] };
    return data.accounts ?? [];
  } catch {
    return [];
  }
}

function writeAccounts(accounts: SavedAccount[]): void {
  writeFileSync(getAccountsPath(), JSON.stringify({ accounts }, null, 2), "utf-8");
}

export function saveAccount(data: SetupData): void {
  if (!data.userId) return;
  const accounts = getSavedAccounts();
  const entry: SavedAccount = {
    userId: data.userId!,
    userEmail: data.userEmail ?? "",
    serverAddress: data.serverAddress,
    mcpBaseUrl: data.mcpBaseUrl,
    apiBaseUrl: data.apiBaseUrl,
    apiKey: data.apiKey,
    edisonSecretKey: data.edisonSecretKey,
    configuredApps: data.configuredApps,
    envCredentials: data.envCredentials,
    savedAt: new Date().toISOString(),
  };
  const idx = accounts.findIndex((a) => a.userId === data.userId);
  if (idx >= 0) {
    accounts[idx] = entry;
  } else {
    accounts.push(entry);
  }
  writeAccounts(accounts);
}

export function removeAccount(userId: string): void {
  const accounts = getSavedAccounts().filter((a) => a.userId !== userId);
  writeAccounts(accounts);
}

export function switchToAccount(userId: string): SetupData | null {
  // Snapshot the current account so its latest credentials are preserved
  try {
    const current = getSetupData();
    if (current.userId) saveAccount(current);
  } catch {
    // best-effort; non-critical
  }
  const accounts = getSavedAccounts();
  const account = accounts.find((a) => a.userId === userId);
  if (!account) return null;
  const data: SetupData = {
    completed: true,
    userEmail: account.userEmail,
    userId: account.userId,
    serverAddress: account.serverAddress,
    mcpBaseUrl: account.mcpBaseUrl,
    apiBaseUrl: account.apiBaseUrl,
    apiKey: account.apiKey,
    edisonSecretKey: account.edisonSecretKey,
    configuredApps: account.configuredApps,
    envCredentials: account.envCredentials,
  };
  writeFileSync(getSetupFlagPath(), JSON.stringify(data, null, 2), "utf-8");
  setupCompleted = true;
  return data;
}

// ── Per-environment credential helpers ───────────────────────────────

/**
 * Return the API key (and optional secret key) for the given environment.
 * Falls back to the top-level apiKey when no per-env entry exists (backwards compat).
 */
export function getCredentialsForEnv(env?: string): EnvCredentials | null {
  const setupData = getSetupData();
  const targetEnv = env ?? getActiveEnv();
  const perEnv = setupData.envCredentials?.[targetEnv];
  if (perEnv) return perEnv;
  // Fallback: use the top-level key only for entirely unmigrated setups
  // (no envCredentials map at all). Once the map exists, a missing env
  // entry means the user hasn't registered for that env yet - return null
  // so callers can warn instead of silently using the wrong key.
  if (!setupData.envCredentials && setupData.apiKey) {
    return { apiKey: setupData.apiKey, edisonSecretKey: setupData.edisonSecretKey };
  }
  return null;
}

// ── URL helpers ─────────────────────────────────────────────────────

export function getActiveEnv(): string {
  // Release is the safe default: a packaged build with no baked env must talk
  // to the production backend, not the demo one.
  return getDebugEnvOverride() ?? getBuildDefaultEnv() ?? "release";
}

export function getApiBaseUrl(): string | null {
  const activeEnv = getActiveEnv();
  // When a debug env override is active, always use the per-env URL map
  // so that switching environments actually changes the API endpoint.
  // This must come before the is.dev check - in dev mode app.isPackaged is
  // false, which would otherwise always short-circuit to localhost.
  const debugOverride = getDebugEnvOverride();
  const overrideUrls = debugOverride ? getEnvUrls(debugOverride) : null;
  if (overrideUrls) return overrideUrls.api;
  const is = { get dev() { return !app.isPackaged; } };
  if (activeEnv === "dev" || is.dev) return DEV_API_BASE_URL;
  const setupData = getSetupData();
  if (setupData.apiBaseUrl) return setupData.apiBaseUrl;
  if (setupData.serverAddress) return `https://${setupData.serverAddress}`;
  // Self-serve: look up default for the active env.
  const url = getEnvUrls(activeEnv)?.api || ENV_API_URL || null;
  if (!url) console.warn(`[getApiBaseUrl] No API URL for env "${activeEnv}".`);
  return url;
}

export function getMcpBaseUrl(): string | null {
  const activeEnv = getActiveEnv();
  // When a debug env override is active, always use the per-env URL map
  // so that switching environments actually changes the MCP endpoint.
  // This must come before the is.dev check - in dev mode app.isPackaged is
  // false, which would otherwise always short-circuit to localhost.
  const debugOverride = getDebugEnvOverride();
  const overrideUrls = debugOverride ? getEnvUrls(debugOverride) : null;
  if (overrideUrls) return overrideUrls.mcp;
  const is = { get dev() { return !app.isPackaged; } };
  if (activeEnv === "dev" || is.dev) return DEV_MCP_BASE_URL;
  const setupData = getSetupData();
  if (setupData.mcpBaseUrl) return setupData.mcpBaseUrl;
  if (setupData.serverAddress) return `https://${setupData.serverAddress}`;
  // Self-serve: look up default for the active env.
  const url = getEnvUrls(activeEnv)?.mcp || ENV_MCP_URL || null;
  if (!url) console.warn(`[getMcpBaseUrl] No MCP URL for env "${activeEnv}".`);
  return url;
}

/**
 * Base URL of the desktop release bucket for the active environment, used as
 * the electron-updater feed host (demo -> demo-releases, release -> releases).
 * Respects the debug env override so a switched build checks the right channel.
 * Returns null for "dev" (auto-update is disabled in unpackaged/dev builds).
 */
export function getReleasesBaseUrl(): string | null {
  const env = getDebugEnvOverride() ?? getActiveEnv();
  return getEnvByName(env)?.RELEASES_BASE_URL ?? null;
}

export function getEventsUrl(apiKey: string): string | null {
  const baseUrl = getApiBaseUrl();
  if (!baseUrl) return null;
  return `${baseUrl.replace(/\/$/, "")}/api/v1/events?api_key=${encodeURIComponent(apiKey)}&source=desktop`;
}

export function getApprovalUrl(): string | null {
  const baseUrl = getApiBaseUrl();
  if (!baseUrl) return null;
  return `${baseUrl.replace(/\/$/, "")}/api/v1/approvals/action`;
}

export function getMcpUrl(): string | null {
  const mcpBaseUrl = getMcpBaseUrl();
  const creds = getCredentialsForEnv();
  if (mcpBaseUrl && creds?.apiKey) {
    return `${mcpBaseUrl.replace(/\/$/, "")}/mcp/${creds.apiKey}`;
  }
  return null;
}

/**
 * The snippet behind the tray's "Copy MCP config", for pasting into a client
 * the app does not configure itself.
 *
 * A URL entry, not a `npx -y mcp-remote <url>` bridge. What the user pastes is
 * what they then run on every launch of that client, so handing them a command
 * that fetches an unpinned package from npm - with the secret key sitting in
 * `argv` where any local process can read it off the process list - made this
 * the one place the app recommended what it had stopped doing itself.
 *
 * Hosts whose config file takes no URL (Claude Desktop, Cowork) are not served
 * by this snippet at all; they need Settings > Connectors, which is why the app
 * reports them as clients the user has to connect by hand.
 */
export function getMcpConfig(): string | null {
  const url = getMcpUrl();
  if (!url) return null;
  const creds = getCredentialsForEnv();
  const config = {
    servers: {
      edisonwatch: {
        type: "http",
        url,
        ...(creds?.edisonSecretKey
          ? { headers: { "X-Edison-Secret-Key": creds.edisonSecretKey } }
          : {}),
      },
    },
  };
  return JSON.stringify(config, null, 2);
}

// ── Server status checks ────────────────────────────────────────────

let isServerOnline = false;
let serverStatusCheckInterval: ReturnType<typeof setInterval> | null = null;

export function getIsServerOnline(): boolean {
  return isServerOnline;
}

export async function checkServerStatus(): Promise<boolean> {
  try {
    const mcpUrl = getMcpBaseUrl();
    if (!mcpUrl) return false;

    const healthUrl = `${mcpUrl.replace(/\/$/, "")}/health`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);

    try {
      const response = await fetch(healthUrl, {
        method: "GET",
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      clearTimeout(timeoutId);
      return response.ok;
    } catch {
      clearTimeout(timeoutId);
      return false;
    }
  } catch {
    return false;
  }
}

export function startServerStatusChecks(onStatusChange: () => void): void {
  checkServerStatus().then((status) => {
    isServerOnline = status;
    onStatusChange();
  });

  if (serverStatusCheckInterval) clearInterval(serverStatusCheckInterval);
  serverStatusCheckInterval = setInterval(async () => {
    const status = await checkServerStatus();
    if (status !== isServerOnline) {
      isServerOnline = status;
      onStatusChange();
    }
  }, 30000);
}

export function stopServerStatusChecks(): void {
  if (serverStatusCheckInterval) {
    clearInterval(serverStatusCheckInterval);
    serverStatusCheckInterval = null;
  }
}

// ── Claude Code MCP connection check ─────────────────────────────────

export type ClaudeCodeMcpStatus = "connected" | "failed" | "needs-auth" | "not-found" | "unknown";

/**
 * Check whether Claude Code has actually loaded and connected to the
 * edison-watch MCP server by running `claude mcp get edison-watch` and
 * parsing the human-readable status line.
 */
export async function checkClaudeCodeMcpConnection(): Promise<ClaudeCodeMcpStatus> {
  const getArgs = ["mcp", "get", "edison-watch"];
  logClaudeCmd(getArgs);
  try {
    const { stdout } = await execFileAsync("claude", getArgs, {
      timeout: 5_000,
    });
    if (stdout.includes("\u2713 Connected")) return "connected";
    if (stdout.includes("\u2717 Failed")) return "failed";
    if (stdout.includes("Needs authentication")) return "needs-auth";
    // If we got output but no recognised status marker
    return "unknown";
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // CLI not on PATH or spawn failed (EBADF in Electron, etc.)
    if (msg.includes("ENOENT") || msg.includes("EBADF")) return "unknown";
    // CLI timed out (killed by execFile timeout)
    if (err && typeof err === "object" && "killed" in err && (err as { killed: boolean }).killed) return "unknown";
    // Only report "not-found" when the CLI actually ran and reported the server missing.
    // If the exit was due to a spawn/runtime error (no stderr about "not found"),
    // treat it as "unknown" so the fallback config+health heuristic is used.
    const stderr = err && typeof err === "object" && "stderr" in err
      ? String((err as { stderr: unknown }).stderr)
      : "";
    if (stderr.includes("No MCP server found")) {
      return "not-found";
    }
    // For any other error (spawn failure, permission issue, string error codes
    // like "EPERM"/"EACCES", etc.), fall back to config-based detection.
    return "unknown";
  }
}

