import { useState } from "react";
import { Button } from "@edison-watch/shared/ui";
import { getActiveEnvName, getEnv } from "@edison-watch/shared/config";

/**
 * Pre-login entry point for self-hosted deployments: lets the user point the
 * app at any Edison backend by URL (a docker-compose stack, a Railway
 * instance, ...). Shown under the sign-in card on the welcome step.
 *
 * The URL is verified against the backend's /api/v1/health endpoint before it
 * is persisted; on success the main process switches the active environment
 * to "custom" and the renderer reloads against the new origin.
 */

/** Add https:// when the user pastes a bare hostname. */
function withScheme(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

async function checkBackendHealth(origin: string): Promise<boolean> {
  try {
    const res = await fetch(`${origin.replace(/\/$/, "")}/api/v1/health`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(7000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export default function CustomServerConnect(): React.ReactNode {
  const isCustom = getActiveEnvName() === "custom";
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const handleConnect = async (): Promise<void> => {
    const origin = withScheme(url);
    if (!origin) {
      setError("Enter your server's URL.");
      return;
    }
    setBusy(true);
    setError("");
    const healthy = await checkBackendHealth(origin);
    if (!healthy) {
      setBusy(false);
      setError("Could not reach an Edison server at that URL. Check the address and try again.");
      return;
    }
    const result = await window.api.config.setCustomBackend(origin);
    if (!result.ok) {
      setBusy(false);
      setError(result.error);
      return;
    }
    // The main process broadcasts env:changed - useAuth reloads the window.
    // Keep the button disabled until that happens.
  };

  const handleUseDefault = async (): Promise<void> => {
    setBusy(true);
    await window.api.config.useDefaultBackend();
    // env:changed triggers the reload; nothing else to do here.
  };

  // Connected to a self-hosted server: show which one, offer the way back.
  if (isCustom) {
    return (
      <div className="flex flex-col items-center gap-1">
        <p className="text-center text-xs text-[var(--text-muted)]">
          Server: <span className="font-mono text-[var(--text-secondary)]">{getEnv().API_BASE_URL}</span>
        </p>
        <button
          type="button"
          onClick={() => void handleUseDefault()}
          disabled={busy}
          className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors underline underline-offset-2 disabled:opacity-50"
        >
          Use the default Edison server instead
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-center text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors underline underline-offset-2"
      >
        Using a self-hosted Edison server? Connect by URL
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] px-4 py-3 flex flex-col gap-2">
      <label htmlFor="custom-server-url" className="text-xs font-medium text-[var(--text-secondary)]">
        Self-hosted server URL
      </label>
      <input
        id="custom-server-url"
        type="text"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !busy) void handleConnect();
        }}
        placeholder="https://edison.your-company.com"
        autoFocus
        spellCheck={false}
        data-testid="custom-server-url-input"
        className="w-full rounded-md border border-[var(--border)] bg-[var(--bg-input)] px-2.5 py-1.5 text-xs font-mono text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none"
      />
      <p className="text-[11px] text-[var(--text-muted)]">
        The address you open the Edison dashboard on - sign-in and the MCP gateway run on the same
        origin.
      </p>
      {error && (
        <p className="text-[11px] text-[var(--danger)]" role="alert">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setOpen(false);
            setError("");
          }}
          disabled={busy}
          className="flex-1"
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="primary"
          onClick={() => void handleConnect()}
          disabled={busy || !url.trim()}
          className="flex-1"
          data-testid="custom-server-connect"
        >
          {busy ? "Connecting…" : "Connect"}
        </Button>
      </div>
    </div>
  );
}
