import { useState, useEffect, useRef, useCallback } from "react";
import {
  DeviceAuthError,
  deviceSignOut,
  fetchUserProfile,
  generatePkce,
  loadStoredDeviceSession,
  pollDeviceToken,
  requestDeviceCode,
  storeDeviceSession,
  type DeviceCodeGrant,
  type DeviceTokenResponse,
} from "@edison-watch/shared/auth";
import {
  getEnv,
  getActiveEnvName,
  getStoredCustomBackend,
  storeCustomBackend,
  STORAGE_KEY,
} from "@edison-watch/shared/config";

// The main process owns the custom (self-hosted) backend URLs; mirror them
// into localStorage so getEnv() can resolve the "custom" environment.
// Returns true when the mirror changed (the page must reload to pick it up).
async function syncCustomBackendMirror(): Promise<boolean> {
  const urls = await window.api.config.getCustomBackend();
  if (!urls) return false;
  const mirrored = getStoredCustomBackend();
  if (mirrored?.apiBaseUrl === urls.apiBaseUrl && mirrored?.mcpBaseUrl === urls.mcpBaseUrl) {
    return false;
  }
  storeCustomBackend(urls);
  return true;
}

// Sync active env from main process on startup - reload if it differs from
// localStorage so the device-auth backend URLs are resolved for the right env.
(async () => {
  try {
    const activeEnv = await window.api.config.getActiveEnv();
    // "dev" uses the localhost backend - clear any localStorage override so we fall back to build default.
    const normalized = activeEnv === "dev" ? null : activeEnv;
    const current = localStorage.getItem(STORAGE_KEY) ?? null;
    let needsReload = current !== normalized;
    if (normalized === "custom" && (await syncCustomBackendMirror())) needsReload = true;
    if (needsReload) {
      if (normalized) localStorage.setItem(STORAGE_KEY, normalized);
      else localStorage.removeItem(STORAGE_KEY);
      window.location.reload();
    }
  } catch {
    // Not running in Electron - ignore.
  }
})();

// Reload whenever the user switches env via the menu.
try {
  window.api.config.onEnvChanged((envName: string) => {
    void (async () => {
      const normalized = envName === "dev" ? null : envName;
      if (normalized === "custom") {
        try {
          await syncCustomBackendMirror();
        } catch {
          // keep whatever mirror exists
        }
      }
      if (normalized) localStorage.setItem(STORAGE_KEY, normalized);
      else localStorage.removeItem(STORAGE_KEY);
      window.location.reload();
    })();
  });
} catch {
  // Not running in Electron - ignore.
}

const API_BASE_URL_FALLBACK: string = getEnv().API_BASE_URL;

async function getApiBaseUrl(): Promise<string> {
  try {
    const effective = await window.api.config.getEffectiveBaseUrls();
    if (effective.apiBaseUrl) return effective.apiBaseUrl;
  } catch {
    // Not available - use fallback
  }
  return API_BASE_URL_FALLBACK;
}

export interface AuthState {
  signedIn: boolean;
  email: string;
  userId: string;
  apiKey: string;
  mcpBaseUrl: string;
  apiBaseUrl: string;
  serverStatus: "checking" | "online" | "offline";
  autoQuarantineOtherMcpServers: boolean;
  loading: boolean;
  error: string;
  /** Informational warning surfaced under the sign-in card. */
  warning: string;
  /** True while we're waiting for the user to approve the request in their browser. */
  awaitingBrowserCallback: boolean;
  /** Short human code of the pending device request - shown so the user can verify it. */
  pendingUserCode: string;
  /** Dashboard approval URL of the pending request (re-openable). */
  pendingVerificationUri: string;
}

const initialState: AuthState = {
  signedIn: false,
  email: "",
  userId: "",
  apiKey: "",
  mcpBaseUrl: "",
  apiBaseUrl: "",
  serverStatus: "checking",
  autoQuarantineOtherMcpServers: false,
  loading: false,
  error: "",
  warning: "",
  awaitingBrowserCallback: false,
  pendingUserCode: "",
  pendingVerificationUri: "",
};

export default function useAuth() {
  const [state, setState] = useState<AuthState>(initialState);
  const healthInterval = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const pollAbort = useRef<AbortController | null>(null);

  const update = useCallback((patch: Partial<AuthState>) => {
    setState((prev) => ({ ...prev, ...patch }));
  }, []);

  // Check server health
  const checkHealth = useCallback(async (mcpBaseUrl: string) => {
    if (!mcpBaseUrl) {
      update({ serverStatus: "offline" });
      return;
    }
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(`${mcpBaseUrl.replace(/\/$/, "")}/health`, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      clearTimeout(timeoutId);
      update({ serverStatus: res.ok ? "online" : "offline" });
    } catch {
      update({ serverStatus: "offline" });
    }
  }, [update]);

  // Finish sign-in once we hold a valid Edison API key: resolve base URLs,
  // publish auth state, start health polling and fetch the org's domain config.
  const completeSignIn = useCallback(
    async (creds: { apiKey: string; userId: string; email: string }): Promise<boolean> => {
      let apiBaseUrl = await getApiBaseUrl();
      let mcpBaseUrl = "";
      const normalizeUrl = (url: string) =>
        url && !/^https?:\/\//i.test(url) ? `https://${url}` : url;
      try {
        const effective = await window.api.config.getEffectiveBaseUrls();
        if (effective.mcpBaseUrl) mcpBaseUrl = normalizeUrl(effective.mcpBaseUrl);
        if (effective.apiBaseUrl) apiBaseUrl = normalizeUrl(effective.apiBaseUrl);
      } catch {
        // Not available - fall back to the env config defaults.
        mcpBaseUrl = getEnv().MCP_BASE_URL;
      }
      if (!apiBaseUrl) console.warn("[useAuth] apiBaseUrl is empty after auth - API calls will fail. Check VITE_API_BASE_URL.");
      if (!mcpBaseUrl) console.warn("[useAuth] mcpBaseUrl is empty after auth - MCP health checks will fail. Check VITE_MCP_BASE_URL.");

      update({
        apiKey: creds.apiKey,
        userId: creds.userId,
        email: creds.email,
        mcpBaseUrl,
        apiBaseUrl,
        signedIn: true,
        loading: false,
        error: "",
      });

      // Start health polling
      checkHealth(mcpBaseUrl);
      if (healthInterval.current) clearInterval(healthInterval.current);
      healthInterval.current = setInterval(() => checkHealth(mcpBaseUrl), 30000);

      // Fetch domain config (auto-quarantine setting)
      try {
        const domainRes = await fetch(
          `${apiBaseUrl.replace(/\/$/, "")}/api/v1/user/domain-config`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${creds.apiKey}`,
              Accept: "application/json",
            },
          },
        );
        if (domainRes.ok) {
          const domainConfig = await domainRes.json();
          if (typeof domainConfig.auto_quarantine_other_mcp_servers === "boolean") {
            update({ autoQuarantineOtherMcpServers: domainConfig.auto_quarantine_other_mcp_servers });
          }
        }
      } catch (e) {
        console.warn("[useAuth] Failed to fetch domain-config:", e);
      }

      return true;
    },
    [checkHealth, update],
  );

  // Sign in via the Edison backend's device-authorization grant: open the
  // dashboard approval page in the system browser and poll for the approval.
  const signInWithBrowser = useCallback(async () => {
    if (pollAbort.current) return; // A flow is already pending.
    update({ loading: true, error: "" });

    const apiBaseUrl = await getApiBaseUrl();
    let grant: DeviceCodeGrant;
    let verifier: string;
    try {
      const pkce = await generatePkce();
      verifier = pkce.verifier;
      let clientVersion = "";
      try {
        clientVersion = await window.api.menu.getVersion();
      } catch {
        // version unavailable - omit
      }
      grant = await requestDeviceCode(
        apiBaseUrl,
        {
          deviceLabel: `Edison Desktop (${window.api.platform ?? "unknown"})`,
          platform: window.api.platform ?? undefined,
          clientVersion: clientVersion || undefined,
        },
        pkce.challenge,
      );
    } catch (err) {
      const message =
        err instanceof DeviceAuthError ? err.message : "Could not start sign-in. Please try again.";
      update({ loading: false, error: message });
      return;
    }

    console.log(`[useAuth] device grant issued (user_code=${grant.user_code}) -> opening browser`);
    window.api.shell.openExternal(grant.verification_uri_complete);
    update({
      awaitingBrowserCallback: true,
      pendingUserCode: grant.user_code,
      pendingVerificationUri: grant.verification_uri_complete,
    });

    // The controller stays armed until credentials are stored, so Cancel
    // aborts the whole flow - including profile resolution - not just polling.
    const controller = new AbortController();
    pollAbort.current = controller;
    try {
      let token: DeviceTokenResponse;
      try {
        token = await pollDeviceToken(apiBaseUrl, grant, verifier, controller.signal);
      } catch (err) {
        if ((err as Error).name === "AbortError") return; // user cancelled
        const message =
          err instanceof DeviceAuthError ? err.message : "Sign-in failed. Please try again.";
        update({
          loading: false,
          error: message,
          awaitingBrowserCallback: false,
          pendingUserCode: "",
          pendingVerificationUri: "",
        });
        return;
      }

      if (!token.api_key) {
        update({
          loading: false,
          error: "The server did not return an API key. Please update Edison and try again.",
          awaitingBrowserCallback: false,
          pendingUserCode: "",
          pendingVerificationUri: "",
        });
        return;
      }

      // The token response has no email - resolve it from the user profile.
      let profile;
      try {
        profile = await fetchUserProfile(apiBaseUrl, token.api_key, 5000, controller.signal);
      } catch {
        return; // aborted by Cancel during profile resolution
      }
      if (controller.signal.aborted) return;

      storeDeviceSession(getActiveEnvName(), {
        apiKey: token.api_key,
        clientAccessToken: token.access_token,
        clientInstallationId: token.client_installation_id,
        userId: token.user_id,
        orgId: token.org_id,
        email: profile?.email ?? "",
      });
      update({
        awaitingBrowserCallback: false,
        pendingUserCode: "",
        pendingVerificationUri: "",
      });
      await completeSignIn({
        apiKey: token.api_key,
        userId: token.user_id,
        email: profile?.email ?? "",
      });
    } finally {
      if (pollAbort.current === controller) pollAbort.current = null;
    }
  }, [completeSignIn, update]);

  // Re-open the dashboard approval page for a pending sign-in.
  const reopenVerificationPage = useCallback(() => {
    if (state.pendingVerificationUri) {
      window.api.shell.openExternal(state.pendingVerificationUri);
    }
  }, [state.pendingVerificationUri]);

  // Let the user cancel a pending browser sign-in.
  const cancelPendingAuth = useCallback(() => {
    console.log(`[useAuth] cancelPendingAuth (pending=${pollAbort.current !== null})`);
    pollAbort.current?.abort();
    pollAbort.current = null;
    update({
      loading: false,
      error: "",
      awaitingBrowserCallback: false,
      pendingUserCode: "",
      pendingVerificationUri: "",
    });
  }, [update]);

  // Sign out: revoke this installation's credential and clear local state.
  const signOut = useCallback(async () => {
    pollAbort.current?.abort();
    pollAbort.current = null;
    const apiBaseUrl = state.apiBaseUrl || (await getApiBaseUrl());
    await deviceSignOut(getActiveEnvName(), apiBaseUrl);
    if (healthInterval.current) clearInterval(healthInterval.current);
    update({
      ...initialState,
      serverStatus: state.serverStatus,
    });
  }, [state.apiBaseUrl, state.serverStatus, update]);

  // Restore a stored session on mount: validate the API key against the
  // backend; drop the session if it has been revoked or deactivated.
  useEffect(() => {
    (async () => {
      const envName = getActiveEnvName();
      const session = loadStoredDeviceSession(envName);
      if (!session) return;
      const apiBaseUrl = await getApiBaseUrl();
      const profile = await fetchUserProfile(apiBaseUrl, session.apiKey);
      if (!profile) {
        console.log("[useAuth] stored session invalid - staying signed out");
        return;
      }
      await completeSignIn({
        apiKey: session.apiKey,
        userId: profile.user_id,
        email: profile.email ?? session.email,
      });
    })();

    return () => {
      pollAbort.current?.abort();
      if (healthInterval.current) clearInterval(healthInterval.current);
    };
  }, [completeSignIn]);

  return {
    ...state,
    signInWithBrowser,
    reopenVerificationPage,
    cancelPendingAuth,
    signOut,
  };
}
