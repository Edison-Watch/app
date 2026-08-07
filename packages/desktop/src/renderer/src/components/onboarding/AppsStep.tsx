import { useState, useEffect, useCallback, useRef } from "react";
import { Button, Card } from "@edison-watch/shared/ui";
import { AppLogo } from "../AppLogo";
import { CONNECTOR_BACKED_CLIENT_IDS } from "../clientSupport";

interface DetectedClient {
  id: string;
  name: string;
  configPath: string;
  /**
   * Whether Edison can configure this client at all. False for hosts whose MCP
   * servers are Connectors in the vendor's account - they are shown so the user
   * knows they're unprotected, but there is nothing to select.
   */
  manageable: boolean;
  enabled: boolean;
  configPreview: string | null;
  expanded: boolean;
}

export interface ModifiedConfig {
  appId: string;
  configPath: string;
  backupPath: string;
}

export interface DiscoveredServer {
  name: string;
  client: string;
  clients?: string[];
  source: string;
}

export interface DuplicateGroup {
  fingerprint: string;
  kind: "same-config" | "name-conflict" | "profile-conflict";
  servers: Array<{ name: string; originalName?: string; client: string; clients?: string[]; config?: Record<string, unknown>; profileName?: string }>;
  /** Set of selected server names to keep. Initialized with all names (all selected). */
  selected: Set<string>;
}

export type RemovalTarget = string | { name: string; client: string };

/** Serializable snapshot of duplicate group selections (Set<string> → string[]). */
export interface DuplicateSelections {
  [fingerprint: string]: string[];
}

/**
 * What to show in the config panel. An unreadable file is not an empty one:
 * the daemon reports absence as `content: null` with no error, and anything
 * else (permissions, a directory, non-UTF-8) with a reason worth showing.
 */
function previewText(content: string | null, error?: string): string {
  if (content !== null) return content;
  return error ? `(Couldn't read this config: ${error})` : "(No config file yet)";
}

interface AppsStepProps {
  onNext: (selectedApps: string[], discoveredServers: DiscoveredServer[], serversToRemove: RemovalTarget[], dupeSelections: DuplicateSelections, skipServers: string[]) => void;
  initialSelectedApps?: string[] | null;
  initialDuplicateSelections?: DuplicateSelections | null;
}

export default function AppsStep({
  onNext,
  initialSelectedApps,
  initialDuplicateSelections,
}: AppsStepProps): React.ReactNode {
  const [clients, setClients] = useState<DetectedClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // The daemon didn't answer: lists are unknown, not empty.
  const [daemonDown, setDaemonDown] = useState(false);

  // Scan state
  const [scanning, setScanning] = useState(false);
  const [discoveredServers, setDiscoveredServers] = useState<DiscoveredServer[]>([]);
  const [unsupportedServers, setUnsupportedServers] = useState<DiscoveredServer[]>([]);
  const [scanned, setScanned] = useState(false);
  const scannedRef = useRef(false);
  const [showServers, setShowServers] = useState(false);
  const [showUnsupported, setShowUnsupported] = useState(false);
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([]);
  const [expandedDupeServers, setExpandedDupeServers] = useState<Set<string>>(new Set());

  // null = first visit (all enabled by default), string[] = returning (restore selection)
  const initialSelectedSet = useRef(initialSelectedApps != null ? new Set(initialSelectedApps) : null);
  const savedDupeSelections = useRef(initialDuplicateSelections ?? null);

  /** Initialize duplicate groups, restoring saved selections when returning to this step. */
  const initDuplicateGroups = (dupes: Array<{ fingerprint: string; kind: string; servers: Array<{ name: string; [k: string]: unknown }> }>) => {
    const saved = savedDupeSelections.current;
    setDuplicateGroups(dupes.map((g) => ({
      ...g as DuplicateGroup,
      selected: saved && saved[g.fingerprint]
        ? new Set(saved[g.fingerprint])
        : new Set(g.servers.map((s) => s.name)),
    })));
  };

  /**
   * Pull the discovered servers into state. Returns false when the daemon
   * didn't answer.
   *
   * On no answer nothing is replaced but the outage flag: an unanswered scan
   * means "unknown", and overwriting a known-good list with an empty one both
   * renders as "No MCP servers found" and would carry [] into the next step if
   * the user proceeds - registering nothing while reporting success.
   */
  const applyDiscovery = useCallback(async (): Promise<boolean> => {
    const result = (await window.api.mcp.discover()) as {
      servers: DiscoveredServer[];
      unsupported: DiscoveredServer[];
      daemonUnavailable?: boolean;
    };
    if (result.daemonUnavailable) {
      setDaemonDown(true);
      return false;
    }
    setDaemonDown(false);
    console.log("[AppsStep] Discovered", result.servers.length, "MCP servers,", result.unsupported.length, "unsupported");
    setDiscoveredServers(result.servers);
    setUnsupportedServers(result.unsupported);
    try {
      const dupes = (await window.api.mcp.findDuplicates()) as DuplicateGroup[];
      initDuplicateGroups(dupes);
    } catch {
      // Duplicate grouping is advisory; a failure here doesn't invalidate the scan.
    }
    return true;
  }, []);

  const detectClients = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const { clients: detected, daemonUnavailable } = await window.api.mcp.detectClients();
      setDaemonDown(daemonUnavailable);
      if (daemonUnavailable) {
        // Same reasoning as applyDiscovery: keep what we already know. The
        // 30-second refresh runs during onboarding, so replacing this list with
        // [] on a blip would also discard the app selections the user just made.
        return;
      }
      setClients((prev) => {
        // Preserve enabled/expanded state for existing clients
        const prevMap = new Map(prev.map((c) => [c.id, c]));
        return detected.map((c) => {
          const existing = prevMap.get(c.id);
          // On first load, use initialSelectedApps if provided; otherwise default to true
          const defaultEnabled = initialSelectedSet.current ? initialSelectedSet.current.has(c.id) : true;
          return {
            ...c,
            // Never selected: there is nothing to configure, and carrying it
            // into the selection would inflate the "Configure N Apps" count and
            // put it in the saved app list.
            enabled: c.manageable && (existing ? existing.enabled : defaultEnabled),
            // On refresh, clear cached config so it gets re-read when expanded
            configPreview: isRefresh ? null : (existing ? existing.configPreview : null),
            expanded: existing ? existing.expanded : false,
          };
        });
      });
      // On refresh, re-read config for any currently expanded clients
      if (isRefresh) {
        setClients((prev) =>
          prev.map((c) => {
            if (c.expanded) {
              window.api.mcp.readConfig(c.id).then(({ content, error }) => {
                setClients((curr) =>
                  curr.map((cc) => (cc.id === c.id ? { ...cc, configPreview: previewText(content, error) } : cc)),
                );
              });
            }
            return c;
          }),
        );
        // Also re-scan discovered servers if already scanned
        if (scannedRef.current) {
          try {
            // Snapshot current duplicate selections so they survive the refresh
            setDuplicateGroups((prev) => {
              if (prev.length > 0) {
                const snap: Record<string, string[]> = {};
                for (const g of prev) snap[g.fingerprint] = [...g.selected];
                savedDupeSelections.current = snap;
              }
              return prev;
            });
            await applyDiscovery();
          } catch {
            // Re-scan failed
          }
        }
      }
    } catch {
      // Discovery failed
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [applyDiscovery]);

  // Detect installed MCP clients on mount, then auto-scan servers
  useEffect(() => {
    detectClients(false).then(() => {
      if (!scannedRef.current) handleScan();
    });
  }, [detectClients]);

  // Auto-refresh every 30 seconds to pick up newly installed clients
  useEffect(() => {
    const interval = setInterval(() => detectClients(true), 30000);
    return () => clearInterval(interval);
  }, [detectClients]);

  const toggleClient = (id: string) => {
    setClients((prev) =>
      prev.map((c) => (c.id === id && c.manageable ? { ...c, enabled: !c.enabled } : c)),
    );
  };

  const toggleExpanded = async (id: string) => {
    setClients((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        if (!c.expanded && !c.configPreview) {
          // Load config preview on first expand
          window.api.mcp.readConfig(c.id).then(({ content, error }) => {
            setClients((curr) =>
              curr.map((cc) => (cc.id === id ? { ...cc, configPreview: previewText(content, error) } : cc)),
            );
          });
        }
        return { ...c, expanded: !c.expanded };
      }),
    );
  };

  const handleScan = async () => {
    setScanning(true);
    try {
      // No answer means the banner explains why; don't mark the scan as done,
      // or the user reads a clean result.
      if (!(await applyDiscovery())) return;
      setScanned(true);
      scannedRef.current = true;
    } catch {
      // Scan failed
    } finally {
      setScanning(false);
    }
  };

  const toggleDupeServer = (fingerprint: string, serverName: string) => {
    setDuplicateGroups((prev) =>
      prev.map((g) => {
        if (g.fingerprint !== fingerprint) return g;
        const next = new Set(g.selected);
        if (next.has(serverName)) next.delete(serverName); else next.add(serverName);
        return { ...g, selected: next };
      }),
    );
  };

  const setAllDupeSelected = (fingerprint: string, selectAll: boolean) => {
    setDuplicateGroups((prev) =>
      prev.map((g) => {
        if (g.fingerprint !== fingerprint) return g;
        return { ...g, selected: selectAll ? new Set(g.servers.map((s) => s.name)) : new Set<string>() };
      }),
    );
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center gap-4 py-8">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
        <p className="text-sm text-[var(--text-secondary)]">Detecting installed MCP clients...</p>
      </div>
    );
  }

  const selectedCount = clients.filter((c) => c.enabled).length;

  // Shared with ClientsView so the wizard's warning and the permanent view
  // cannot disagree about which clients carry the Connectors caveat.
  const fullySupportedClients = clients.filter((c) => !CONNECTOR_BACKED_CLIENT_IDS.has(c.id));
  const partiallySupportedClients = clients.filter((c) => CONNECTOR_BACKED_CLIENT_IDS.has(c.id));

  const renderClientCard = (client: DetectedClient) => (
    <div
      key={client.id}
      className="rounded-lg border border-[var(--border)] overflow-hidden transition-shadow"
      style={{
        borderTopColor: client.enabled ? "var(--accent-dim)" : "var(--border)",
        background: "linear-gradient(180deg, var(--bg-overlay) 0%, var(--bg-raised) 48px)",
        boxShadow: client.enabled ? "0 0 12px 0 rgba(125, 255, 246, 0.08)" : "none",
      }}
    >
      {/* Row. Toggles selection for clients Edison can configure; for the rest
          it is inert text, because a checkbox whose value is discarded is worse
          than no checkbox. */}
      <button
        type="button"
        disabled={!client.manageable}
        className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
          client.manageable ? "hover:bg-[var(--bg-input)]/40" : "cursor-default"
        }`}
        onClick={() => toggleClient(client.id)}
      >
        {/* Checkbox indicator, only where there is something to check */}
        {client.manageable && (
          <div
            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded transition-all ${
              client.enabled
                ? "bg-[var(--accent)] border-[var(--accent)]"
                : "border-2 border-[var(--border)]"
            }`}
          >
            {client.enabled && (
              <svg viewBox="0 0 12 12" fill="none" className="h-2.5 w-2.5" aria-hidden="true">
                <path d="M2 6l3 3 5-5" stroke="var(--bg-base)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </div>
        )}

        {/* App logo */}
        <AppLogo id={client.id} name={client.name} />

        {/* Name + path */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-[var(--text-primary)]">
              {client.name}
            </span>
            <span
              className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                client.manageable
                  ? "text-emerald-400/80 bg-emerald-400/10"
                  : "text-amber-300/90 bg-amber-400/10"
              }`}
            >
              {client.manageable ? "Detected" : "Not protected"}
            </span>
          </div>
          <p className="text-xs text-[var(--text-muted)] truncate mt-0.5">
            {client.configPath}
          </p>
        </div>
      </button>

      {/* Config preview toggle */}
      {client.expanded && (
        <pre className="mx-4 mb-3 max-h-40 overflow-auto rounded-md bg-[var(--bg-input)] p-3 text-xs text-[var(--text-secondary)]">
          {client.configPreview ?? "Loading config..."}
        </pre>
      )}
      <div className="px-4 pb-2.5">
        <button
          type="button"
          className="text-xs text-[var(--accent-muted)] hover:text-[var(--accent)] transition-colors"
          onClick={() => toggleExpanded(client.id)}
        >
          {client.expanded ? "Hide config" : "Show config"}
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">Connect Your Apps</h2>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          Select which MCP clients to configure with Edison Watch.
        </p>
      </div>

      {clients.length === 0 ? (
        <Card>
          <div className="flex items-center justify-between py-2">
            <p className="text-sm text-[var(--text-muted)]">
              {daemonDown
                ? "Can't check which apps are installed while the detector daemon is unreachable."
                : "No MCP clients detected. You can configure them manually later."}
            </p>
            <button
              type="button"
              onClick={() => detectClients(true)}
              disabled={refreshing}
              className="ml-3 shrink-0 text-xs text-[var(--accent-muted)] hover:text-[var(--accent)] transition-colors disabled:opacity-50"
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {/* Refresh row */}
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={() => detectClients(true)}
              disabled={refreshing}
              className="text-xs text-[var(--accent-muted)] hover:text-[var(--accent)] transition-colors disabled:opacity-50"
            >
              {refreshing ? "Refreshing…" : "↻ Refresh"}
            </button>
          </div>

          {fullySupportedClients.map(renderClientCard)}

          {partiallySupportedClients.length > 0 && (
            <div className="mt-4 rounded-lg border border-amber-400/40 bg-amber-400/5 p-3">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-sm font-semibold text-amber-300">
                  Partially supported
                </span>
                <span className="text-[10px] text-amber-200/70">
                  ({partiallySupportedClients.map((c) => c.name).join(" & ")})
                </span>
              </div>
              <div className="mb-3 rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-100/90">
                We currently only support local MCP servers, not Connectors. You
                should remove your connectors manually for your safety and request
                an equivalent server in Edison Watch from your admin.
              </div>
              <div className="flex flex-col gap-2">
                {partiallySupportedClients.map(renderClientCard)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Discovered MCP Servers */}
      <Card>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            className="flex items-center justify-between w-full text-left"
            onClick={() => setShowServers((v) => !v)}
          >
            <div>
              <p className="text-sm font-medium text-[var(--text-primary)]">
                Discovered MCP servers
                {scanned && discoveredServers.length > 0 && (() => {
                  // Collect all deselected server names from duplicate groups
                  const deselectedNames = new Set<string>();
                  for (const g of duplicateGroups) {
                    for (const s of g.servers) {
                      if (!g.selected.has(s.name)) deselectedNames.add(s.name);
                    }
                  }
                  const conflictRenamedCount = duplicateGroups
                    .filter((g) => g.kind === "name-conflict" || g.kind === "profile-conflict")
                    .reduce((sum, g) => sum + g.servers.filter((s) => g.selected.has(s.name)).length, 0);
                  const conflictGroupCount = duplicateGroups
                    .filter((g) => (g.kind === "name-conflict" || g.kind === "profile-conflict") && g.servers.some((s) => g.selected.has(s.name)))
                    .length;
                  const displayCount = discoveredServers.filter((s) => !deselectedNames.has(s.name)).length - conflictRenamedCount + conflictGroupCount;
                  return (
                    <span className="ml-1.5 text-xs text-[var(--text-muted)] font-normal">
                      ({displayCount})
                    </span>
                  );
                })()}
              </p>
              <p className="text-xs text-[var(--text-muted)]">
                MCP servers configured in your clients.
              </p>
            </div>
            {scanning ? (
              <div className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
            ) : (
              <svg
                viewBox="0 0 12 12"
                fill="none"
                className={`h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform ${scanned && showServers ? "rotate-180" : ""}`}
                aria-hidden="true"
              >
                <path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>

          {scanned && showServers && (
            <div className="mt-2 rounded-md bg-[var(--bg-input)] p-3 text-xs">
              {discoveredServers.length === 0 ? (
                <span className="text-[var(--text-muted)]">
                  {daemonDown
                    ? "Couldn't scan - the detector daemon is unreachable."
                    : "No MCP servers found."}
                </span>
              ) : (
                <div className="flex flex-col gap-1 max-h-32 overflow-y-auto">
                  {(() => {
                    // Collect deselected server names from duplicate groups
                    const deselectedNames = new Set<string>();
                    for (const g of duplicateGroups) {
                      for (const s of g.servers) {
                        if (!g.selected.has(s.name)) deselectedNames.add(s.name);
                      }
                    }
                    // Build display list: merge name-conflict entries back to original name
                    const conflictNames = new Set<string>();
                    const conflictEntries: Array<{ name: string; clients: string[] }> = [];
                    for (const g of duplicateGroups) {
                      if (g.kind !== "name-conflict" && g.kind !== "profile-conflict") continue;
                      const selectedServers = g.servers.filter((s) => g.selected.has(s.name));
                      if (selectedServers.length === 0) continue;
                      const origName = g.servers[0]?.originalName ?? "";
                      const allClients = selectedServers.flatMap((s) => s.clients && s.clients.length > 0 ? s.clients : [s.client]);
                      conflictEntries.push({ name: origName, clients: [...new Set(allClients)] });
                      for (const s of g.servers) conflictNames.add(s.name);
                    }
                    // Filter out renamed entries and deselected entries, append merged conflict entries
                    const display = [
                      ...discoveredServers.filter((s) => !conflictNames.has(s.name) && !deselectedNames.has(s.name)),
                      ...conflictEntries.map((e) => ({ ...e, conflict: true })),
                    ];
                    return display.map((s) => (
                      <div key={s.name} className="flex items-center gap-2">
                        <span className="text-[var(--text-primary)] font-medium truncate">{s.name}</span>
                        {"conflict" in s && s.conflict && (
                          <span className="text-yellow-400 text-xs" title="Name conflict - see Duplicate resolution">*</span>
                        )}
                        <span className="text-[var(--text-muted)] shrink-0">
                          {("clients" in s && s.clients && s.clients.length > 0 ? s.clients : [("client" in s ? s.client : "")]).join(", ")}
                        </span>
                      </div>
                    ));
                  })()}
                </div>
              )}
            </div>
          )}
        </div>
      </Card>

      {/* Unsupported servers (opaque / IDE-managed) */}
      {scanned && unsupportedServers.length > 0 && (
        <Card>
          <button
            type="button"
            className="flex items-center justify-between w-full text-left"
            onClick={() => setShowUnsupported((v) => !v)}
          >
            <div>
              <p className="text-sm font-medium text-[var(--text-secondary)]">
                Unsupported servers
                <span className="ml-1.5 text-xs text-[var(--text-muted)] font-normal">
                  ({unsupportedServers.length})
                </span>
              </p>
              <p className="text-xs text-[var(--text-muted)]">
                IDE-managed servers with no accessible config. These cannot be imported.
              </p>
            </div>
            <svg
              viewBox="0 0 12 12"
              fill="none"
              className={`h-4 w-4 shrink-0 text-[var(--text-muted)] transition-transform ${showUnsupported ? "rotate-180" : ""}`}
              aria-hidden="true"
            >
              <path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {showUnsupported && (
            <div className="mt-2 rounded-md bg-[var(--bg-input)] p-3 text-xs">
              <div className="flex flex-col gap-1 max-h-32 overflow-y-auto">
                {unsupportedServers.map((s) => (
                  <div key={`${s.name}-${s.client}`} className="flex items-center gap-2">
                    <span className="text-[var(--text-secondary)] font-medium truncate">{s.name}</span>
                    <span className="text-[var(--text-muted)] shrink-0">{s.client}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Cross-name duplicates (different names, same config) */}
      {duplicateGroups.length > 0 && (
        <Card>
          <p className="text-xs font-medium text-orange-400 mb-2">
            Duplicate resolution ({duplicateGroups.length} group{duplicateGroups.length > 1 ? "s" : ""})
          </p>
          {duplicateGroups.map((group) => (
            <div key={group.fingerprint} className="mb-2 pl-2 border-l-2 border-orange-400/30">
              <p className="text-[10px] text-[var(--text-muted)] mb-1">
                {group.kind === "same-config"
                  ? "Same server config under different names:"
                  : group.kind === "profile-conflict"
                    ? `Same name "${group.servers[0]?.originalName ?? ""}" in different profiles - auto-renamed:`
                    : `Same name "${group.servers[0]?.originalName ?? ""}" with different configs - auto-renamed:`}
              </p>
              {group.servers.map((s) => {
                const expandKey = `${group.fingerprint}:${s.name}`;
                const isExpanded = expandedDupeServers.has(expandKey);
                const isSelected = group.selected.has(s.name);
                return (
                  <div key={s.name}>
                    <div className="flex items-center gap-2">
                      {/* Selection checkbox */}
                      <button
                        type="button"
                        className="shrink-0"
                        onClick={() => toggleDupeServer(group.fingerprint, s.name)}
                      >
                        <div
                          className={`flex h-3.5 w-3.5 items-center justify-center rounded transition-all ${
                            isSelected
                              ? "bg-[var(--accent)] border-[var(--accent)]"
                              : "border-2 border-[var(--border)]"
                          }`}
                        >
                          {isSelected && (
                            <svg viewBox="0 0 12 12" fill="none" className="h-2 w-2" aria-hidden="true">
                              <path d="M2 6l3 3 5-5" stroke="var(--bg-base)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </div>
                      </button>
                      <button
                        type="button"
                        className="text-[var(--text-primary)] text-xs font-medium hover:text-[var(--accent)] transition-colors text-left"
                        onClick={() => setExpandedDupeServers((prev) => {
                          const next = new Set(prev);
                          if (next.has(expandKey)) next.delete(expandKey); else next.add(expandKey);
                          return next;
                        })}
                      >
                        <span className="inline-block w-3 text-[var(--text-muted)]">{isExpanded ? "▾" : "▸"}</span>
                        {s.name}
                      </button>
                      <span className="text-[var(--text-muted)] text-[10px]">
                        {(s.clients && s.clients.length > 0 ? s.clients : [s.client]).join(", ")}
                        {s.profileName && ` (profile: ${s.profileName})`}
                      </span>
                    </div>
                    {isExpanded && s.config && (
                      <pre className="ml-5 mt-1 mb-1 max-h-28 overflow-auto rounded-md bg-[var(--bg-input)] p-2 text-[10px] text-[var(--text-secondary)]">
                        {JSON.stringify(s.config, null, 2)}
                      </pre>
                    )}
                  </div>
                );
              })}

              {/* Select all / Deselect all */}
              <div className="mt-1.5 flex items-center gap-2">
                <button
                  type="button"
                  className="text-[10px] text-[var(--accent-muted)] hover:text-[var(--accent)] transition-colors"
                  onClick={() => setAllDupeSelected(group.fingerprint, true)}
                >
                  Select all
                </button>
                <button
                  type="button"
                  className="text-[10px] text-[var(--accent-muted)] hover:text-[var(--accent)] transition-colors"
                  onClick={() => setAllDupeSelected(group.fingerprint, false)}
                >
                  Deselect all
                </button>
              </div>
            </div>
          ))}
        </Card>
      )}

      <Button
        variant="primary"
        onClick={() => {
          // Collect removal targets from deselected servers in duplicate groups
          const removedNames = new Set<string>();
          const removalTargets: RemovalTarget[] = duplicateGroups.flatMap((g): RemovalTarget[] => {
            const deselected = g.servers.filter((s) => !g.selected.has(s.name));
            if (deselected.length === 0) return [];
            deselected.forEach((s) => removedNames.add(s.name));
            if (g.kind === "name-conflict" || g.kind === "profile-conflict") {
              return deselected.map((s) => ({
                name: s.originalName ?? s.name,
                client: s.client,
              }));
            }
            return deselected.map((s) => s.name);
          });
          const effectiveServers = discoveredServers.filter((s) => !removedNames.has(s.name));
          // Serialize duplicate selections for persistence across back-navigation
          const dupeSelections: DuplicateSelections = {};
          for (const g of duplicateGroups) {
            dupeSelections[g.fingerprint] = [...g.selected];
          }
          // Collect deduped (renamed) names of deselected servers for backend skip filtering
          const skipServers = [...removedNames];
          onNext(clients.filter((c) => c.enabled).map((c) => c.id), effectiveServers, removalTargets, dupeSelections, skipServers);
        }}
        className="w-full"
      >
        {selectedCount > 0
          ? `Continue with ${selectedCount} App${selectedCount === 1 ? "" : "s"}`
          : "Skip"}
      </Button>
    </div>
  );
}
