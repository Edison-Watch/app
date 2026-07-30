/**
 * IPC handlers for MCP server discovery, submission, and removal.
 *
 * Extracted from ipcHandlers.ts to stay under the 800-line CI limit.
 */

import { ipcMain } from "electron";

import { discoverMcpServers, describeUnsupportedReason } from "../discovery/mcpDiscovery";
import type { DiscoveredMcpServer, McpClientId, McpServerConfig } from "../discovery/mcpDiscovery";
import {
  submitServersViaDetectord,
  resubmitServerViaDetectord,
  submitOneViaDetectord,
} from "../detectord/submit";
import { getDetectordClient } from "../detectord/lifecycle";
import { toAgentName } from "../detectord/agents";
import { applyIntegrations, revertIntegrations, integrationErrors } from "../detectord/integrations";
import { detectSecrets } from "../discovery/secretDetection";
import type { TemplatizedConfig } from "../discovery/secretDetection";
import { filterOutEdisonWatchServers } from "../runtime/mcpConfigMonitor";
import { deduplicateServers, findDuplicateGroups } from "../discovery/serverDeduplication";
import { DRY_RUN, getApiBaseUrl, getSetupData, getCredentialsForEnv } from "../infra/setupConfig";

// ── Discovery cache ─────────────────────────────────────────────────────
// Populated by mcp:discover; consumed by submit/resubmit so they never re-discover.
let discoveryCache: { servers: DiscoveredMcpServer[]; raw: DiscoveredMcpServer[]; unsupported: DiscoveredMcpServer[] } | null = null;

/** Run discovery, populate cache, return filtered+deduped servers. */
async function runDiscovery() {
  const { servers, raw, unsupported } = await discoverMcpServers({ includeRaw: true });
  const filtered = filterOutEdisonWatchServers(servers);
  const rawFiltered = filterOutEdisonWatchServers(raw);
  discoveryCache = { servers: filtered, raw: rawFiltered, unsupported };
  return discoveryCache;
}

/** Get cached discovery or return empty if cache is not populated. */
function getCachedDiscovery() {
  return discoveryCache ?? { servers: [] as DiscoveredMcpServer[], raw: [] as DiscoveredMcpServer[], unsupported: [] as DiscoveredMcpServer[] };
}

/** One config the daemon changed, in the shape the onboarding UI renders. */
export interface ModifiedConfig {
  appId: string;
  configPath: string;
  backupPath: string;
}

function toModifiedConfig(c: { agent: string; path?: string | null; backup_path?: string | null }): ModifiedConfig {
  return {
    appId: c.agent.replace(/_/g, "-"),
    // Claude Code is installed through its own CLI, which owns the path.
    configPath: c.path ?? "(via claude mcp add)",
    backupPath: c.backup_path ?? "",
  };
}

export function registerMcpSubmitHandlers(): void {
  ipcMain.handle("mcp:discover", async () => {
    let discovery;
    try {
      discovery = await runDiscovery();
    } catch (err) {
      // The daemon is the only source. Reporting an empty list here would tell
      // the user "no MCP servers found" when the truth is "we couldn't look" -
      // so the renderer gets the failure and shows the warning instead.
      console.error(`[mcp:discover] discovery unavailable: ${String(err)}`);
      return {
        servers: [],
        unsupported: [],
        daemonUnavailable: true,
        error: err instanceof Error ? err.message : String(err),
      };
    }
    const { servers, unsupported } = discovery;
    console.log(`[mcp:discover] Found ${servers.length} servers, ${unsupported.length} unsupported`);
    for (const s of servers) {
      console.log(`[mcp:discover]   supported: ${s.name}@${s.client} source=${s.source} path=${s.path}`);
    }
    for (const s of unsupported) {
      const reason = describeUnsupportedReason(s) ?? 'unknown';
      console.log(`[mcp:discover]   unsupported: ${s.name}@${s.client} source=${s.source} path=${s.path} reason=${reason}`);
    }
    return { servers, unsupported, daemonUnavailable: false };
  });

  ipcMain.handle("mcp:findDuplicates", async () => {
    const { servers } = getCachedDiscovery();
    return findDuplicateGroups(servers);
  });

  /** Resubmit a single server under a new name.
   *  Uses discovery cache + passed config as fallback. */
  ipcMain.handle("mcp:resubmitServer", async (_event, params: {
    originalName: string;
    newName: string;
    apiKey?: string;
    apiBaseUrl?: string;
    userId?: string;
    config?: Record<string, unknown>;
    client?: string;
    configPath?: string;
    source?: string;
  }): Promise<{ success: boolean; error?: string }> => {
    const setup = getSetupData();
    const creds = getCredentialsForEnv();
    const apiKey = params.apiKey || creds?.apiKey;
    const apiBaseUrl = getApiBaseUrl() || params.apiBaseUrl || setup.apiBaseUrl;

    if (!apiKey || !apiBaseUrl) {
      return { success: false, error: "Not signed in or server URL not configured." };
    }

    // Resubmit-under-new-name is a daemon disposition with rename. Pass client
    // through as-is (may be undefined) so the daemon matches by name alone when
    // it's omitted, preserving the optional-client contract.
    return resubmitServerViaDetectord(params.originalName, params.newName, params.client);
  });

  /** Remove specific servers from their agent config files.
   *  Accepts either plain names (removes from ALL agents) or {name, client} pairs (targeted removal).
   *  Names can be dedup-renamed (e.g. "same_cursor") - resolved back to raw names via the deduped cache. */
  ipcMain.handle("mcp:removeServers", async (_event, targets: Array<string | { name: string; client: string }>): Promise<{
    removed: string[];
    errors: string[];
  }> => {
    // The daemon owns removal. Servers the user didn't send to EW are
    // auto-quarantined once enforcement arms at setup:complete, so there's
    // nothing for the client to remove here.
    const names = targets.map((t) => (typeof t === "string" ? t : t.name));
    console.log(`[detectord] removeServers no-op (daemon quarantines when armed): ${names.join(", ")}`);
    return { removed: [], errors: [] };
  });

  // Show an agent's config file. The daemon reads it: it owns agent files, and
  // this used to take an arbitrary path from the renderer.
  ipcMain.handle("mcp:readConfig", async (_event, client: string) => {
    try {
      const daemon = getDetectordClient();
      await daemon.connect();
      return { content: (await daemon.readConfig(toAgentName(client))).content };
    } catch (err) {
      // A read that failed is not an empty config: the daemon reports absence
      // as null content and anything else (permissions, a directory, non-UTF-8)
      // as an error, so pass the reason on rather than rendering "no config".
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[mcp:readConfig] ${client}: ${message}`);
      return { content: null, error: message };
    }
  });

  ipcMain.handle("mcp:applyAppIntegrations", async (_event, args: {
    serverAddress?: string;
    mcpBaseUrl?: string;
    apiKey?: string;
    edisonSecretKey?: string;
    apps: string[];
  }): Promise<{ success: boolean; modifiedConfigs: ModifiedConfig[]; errors?: string[] }> => {
    // The daemon installs the edison-watch entry and the hooks: it holds the
    // credentials in its enrollment and it is the only writer of agent configs.
    // The URL/key arguments are vestigial - they came from the app's own writer
    // and are ignored rather than second-guessing the enrollment.
    console.log("[mcp:applyAppIntegrations]", args.apps, DRY_RUN ? "(dry-run)" : "");
    if (DRY_RUN) return { success: true, modifiedConfigs: [] };
    try {
      const changes = await applyIntegrations(args.apps);
      const errors = integrationErrors(changes);
      return {
        success: errors.length === 0,
        modifiedConfigs: changes.filter((c) => c.ok).map(toModifiedConfig),
        ...(errors.length > 0 ? { errors } : {}),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, modifiedConfigs: [], errors: [message] };
    }
  });

  // Revert app integrations: the daemon removes the edison-watch entry it
  // installed (and drops the agent from the enrolled selection so its
  // self-heal doesn't put it straight back).
  ipcMain.handle("mcp:revertAppIntegrations", async (_event, args: {
    configs: Array<{ appId?: string; configPath?: string; backupPath?: string }>;
  }): Promise<{ reverted: number; errors: string[] }> => {
    const apps = args.configs.map((c) => c.appId).filter((a): a is string => !!a);
    if (apps.length === 0) {
      return { reverted: 0, errors: ["No app ids to revert"] };
    }
    try {
      const changes = await revertIntegrations(apps);
      return { reverted: changes.filter((c) => c.ok).length, errors: integrationErrors(changes) };
    } catch (err) {
      return { reverted: 0, errors: [err instanceof Error ? err.message : String(err)] };
    }
  });

  // Analyze discovered servers for secrets (without submitting)
  ipcMain.handle("mcp:analyzeSecrets", async (_event, params?: { skipServers?: string[] }): Promise<Array<{
    name: string;
    client: string;
    source: string;
    config: McpServerConfig;
    templatized: TemplatizedConfig;
  }>> => {
    const { servers: cached } = getCachedDiscovery();
    const allServers = deduplicateServers(cached);
    const skipSet = new Set(params?.skipServers ?? []);
    const servers = skipSet.size > 0 ? allServers.filter((s) => !skipSet.has(s.name)) : allServers;
    return servers.map((server) => ({
      name: server.name,
      client: server.client,
      source: server.source,
      config: server.config,
      templatized: detectSecrets(server),
    }));
  });

  // Analyze secrets for a single server (used by quarantine/registration dialogs)
  ipcMain.handle("mcp:analyzeServerSecrets", async (_event, params: {
    serverName: string;
    sourceApp: string;
    config: Record<string, unknown>;
    configPath: string;
  }) => {
    const server: DiscoveredMcpServer = {
      name: params.serverName,
      client: params.sourceApp as McpClientId,
      source: "user",
      path: params.configPath,
      config: params.config as McpServerConfig,
    };
    const result = detectSecrets(server);
    return {
      config: params.config,
      templatizedConfig: result.config,
      templateFields: result.templateFields,
      secretValues: result.secretValues,
    };
  });

  // Submit servers with user-defined template overrides
  ipcMain.handle("mcp:submitWithTemplates", async (_event, params: {
    apiKey?: string;
    apiBaseUrl?: string;
    userId?: string;
    skipServers?: string[];
    templateOverrides: Record<string, Array<{
      entryId: string;
      varName: string;
      selectedText: string;
      start: number;
      end: number;
    }>>;
  }): Promise<{
    submitted: number;
    autoApproved: number;
    skipped: number;
    alreadyOnBackend: number;
    total: number;
    servers?: Array<{ name: string; client: string; clients?: string[]; source: string }>;
    error?: string;
    errors?: string[];
    failures?: Array<{ name: string; client: string; reason: "conflict" | "already-pending" | "error" | "already-on-backend"; message: string; config?: Record<string, unknown>; configPath?: string; backendStatus?: "registered" | "requested" }>;
  }> => {
    const setup = getSetupData();
    const creds = getCredentialsForEnv();
    const apiKey = params.apiKey || creds?.apiKey;
    const apiBaseUrl = getApiBaseUrl() || params.apiBaseUrl || setup.apiBaseUrl;

    if (!apiKey || !apiBaseUrl) {
      return { submitted: 0, autoApproved: 0, skipped: 0, alreadyOnBackend: 0, total: 0,
        error: "Not signed in or server URL not configured." };
    }

    const { servers: cached } = getCachedDiscovery();
    const allServers = deduplicateServers(cached);
    const skipSet = new Set(params.skipServers ?? []);
    const servers = skipSet.size > 0 ? allServers.filter((s) => !skipSet.has(s.name)) : allServers;

    // The daemon owns submit. Pass the credential-review overrides so the user's
    // manual redactions are honored verbatim (servers without an override entry
    // still get the daemon's auto-templatization).
    const summary = await submitServersViaDetectord(servers, params.templateOverrides);
    console.log(`[detectord] onboarding submit (with template overrides): ${summary.submitted} submitted, ${summary.failures.length} failed`);
    return summary;
  });

  // Submit all discovered MCP servers for approval
  ipcMain.handle("mcp:submitAllDiscovered", async (_event, params?: {
    apiKey?: string;
    apiBaseUrl?: string;
    userId?: string;
    skipServers?: string[];
  }): Promise<{
    submitted: number;
    autoApproved: number;
    skipped: number;
    alreadyOnBackend: number;
    total: number;
    servers?: Array<{ name: string; client: string; clients?: string[]; source: string }>;
    error?: string;
    errors?: string[];
    failures?: Array<{ name: string; client: string; reason: "conflict" | "already-pending" | "error" | "already-on-backend"; message: string; config?: Record<string, unknown>; configPath?: string; backendStatus?: "registered" | "requested" }>;
  }> => {
    const setup = getSetupData();
    const creds = getCredentialsForEnv();
    const apiKey = params?.apiKey || creds?.apiKey;
    const apiBaseUrl = getApiBaseUrl() || params?.apiBaseUrl || setup.apiBaseUrl;

    if (!apiKey || !apiBaseUrl) {
      return { submitted: 0, autoApproved: 0, skipped: 0, alreadyOnBackend: 0, total: 0,
        error: "Not signed in or server URL not configured." };
    }

    const { servers: cached } = getCachedDiscovery();

    // Deduplicate servers with the same name across different clients.
    const allServers = deduplicateServers(cached);
    const skipSet = new Set(params?.skipServers ?? []);
    const servers = skipSet.size > 0 ? allServers.filter((s) => !skipSet.has(s.name)) : allServers;

    // The daemon owns submit (and handles stdio). Route each registration
    // through it instead of the client's http-only submit path.
    const summary = await submitServersViaDetectord(servers);
    console.log(`[detectord] onboarding submit: ${summary.submitted} submitted, ${summary.failures.length} failed`);
    return summary;
  });

  // Handle individual server actions from the registration/quarantine dialogs.
  // Registration goes through the daemon, which submits, marks the server known
  // and removes the local entry in one step - none of which the app can do
  // without touching an agent's config file.
  ipcMain.handle("mcp:handleServerAction", async (_event, params: {
    fingerprint: string;
    serverName: string;
    sourceApp: string;
    action: string;
    config: Record<string, unknown>;
    configPath: string;
    source?: string;
    templateOverrides?: Array<{
      entryId: string;
      varName: string;
      selectedText: string;
      start: number;
      end: number;
    }>;
  }) => {
    // Dismissed/skipped servers need no submit.
    if (params.action !== "registered" && params.action !== "requested") {
      return { action: params.action };
    }

    const server: DiscoveredMcpServer = {
      name: params.serverName,
      client: params.sourceApp as McpClientId,
      source: (params.source as DiscoveredMcpServer["source"]) || "user",
      path: params.configPath,
      config: params.config as McpServerConfig,
    };

    return submitOneViaDetectord(server, params.action, params.templateOverrides);
  });
}
