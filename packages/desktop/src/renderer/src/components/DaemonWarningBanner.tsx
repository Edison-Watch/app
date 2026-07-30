import { useEffect, useState } from "react";

/** Mirror of the main-process DetectordHealth (see main/detectord/health.ts). */
interface DetectordHealth {
  ok: boolean;
  kind?: "missing-binary" | "unreachable" | "error";
  message?: string;
  detail?: string;
  since: number;
}

/**
 * One-line strip shown while the detector daemon isn't answering.
 *
 * Deliberately terse: it sits above every view, so it states the condition and
 * stops. The explanation and the remedy belong in the missing-binary dialog,
 * and the underlying error belongs in the log - it's on the tooltip here only
 * so support can get at it without it shouting at everyone else.
 *
 * Not dismissible: while the daemon is down nothing is detecting or
 * quarantining, and a quiet app would read as "nothing to report".
 */
export default function DaemonWarningBanner(): React.ReactNode {
  const [health, setHealth] = useState<DetectordHealth | null>(null);

  useEffect(() => {
    let mounted = true;
    window.api.detectord.health().then((h) => {
      if (mounted) setHealth(h);
    });
    const off = window.api.detectord.onHealth(setHealth);
    return () => {
      mounted = false;
      off();
    };
  }, []);

  if (!health || health.ok) return null;

  return (
    <div
      role="alert"
      title={health.detail ?? undefined}
      className="flex items-center gap-2 border-b border-red-500/30 bg-red-500/10 px-4 py-1.5"
    >
      <svg viewBox="0 0 16 16" fill="none" className="h-3 w-3 shrink-0 text-red-400" aria-hidden="true">
        <path
          d="M8 5v4m0 2.5v.01M7.1 1.8 1.3 12.2A1 1 0 0 0 2.2 13.7h11.6a1 1 0 0 0 .9-1.5L8.9 1.8a1 1 0 0 0-1.8 0Z"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="truncate text-[11px] text-[var(--text-secondary)]">
        {health.message ?? "Degraded: the agent and MCP detection daemon is unavailable."}
      </span>
    </div>
  );
}
