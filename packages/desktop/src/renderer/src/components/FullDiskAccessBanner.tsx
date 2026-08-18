import { useEffect, useState } from "react";

/** Mirror of the main-process FullDiskAccessInfo (see main/detectord/fullDiskAccess.ts). */
interface FullDiskAccessInfo {
  state: "granted" | "denied" | "unknown";
  binaryPath: string;
}

// Poll cadence is chosen per state, because only one of them is worth watching
// closely. Each poll is an IPC round-trip plus a daemon `status()` call, which
// re-reads the enrollment and quarantine files, so a fixed fast interval is
// sustained background work for a machine that is simply set up correctly.

/** Banner is up and the user is likely in System Settings right now. Feel live. */
export const POLL_DENIED_MS = 5000;
/** Daemon unreachable: back off instead of reconnecting to a dead socket every 5s. */
export const POLL_UNKNOWN_MS = 30000;

/**
 * Actionable strip shown while the detector daemon lacks macOS Full Disk Access.
 *
 * Without it the daemon declines to watch $HOME - watching it would prompt
 * separately for Desktop, Documents and Downloads - so changes to
 * `~/.claude.json` are picked up by the periodic rescan instead of live events.
 * Detection is degraded, not stopped, which is why this is amber and distinct
 * from DaemonWarningBanner's red "nothing is running at all".
 *
 * Polled rather than pushed: the user grants this in System Settings, outside
 * the app, and macOS gives us no notification when they do. Only a definite
 * `denied` renders - `unknown` (daemon down, or too old to report the field)
 * shows nothing, since a permissions banner appearing during a routine daemon
 * restart would be worse than none.
 *
 * Not dismissible while it applies: it clears itself within POLL_DENIED_MS of
 * the grant landing, so there is nothing to dismiss.
 */
export default function FullDiskAccessBanner(): React.ReactNode {
  const [info, setInfo] = useState<FullDiskAccessInfo | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Full Disk Access is a macOS concept. Off macOS `getFullDiskAccessInfo()`
    // returns a constant `granted` without ever consulting the daemon, so even
    // one poll is a wasted IPC round-trip for an answer that cannot change.
    // Leaving `info` null renders
    // nothing, which is what we want on those platforms anyway.
    if (window.api.platform !== "darwin") return;

    let mounted = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    // Self-scheduling rather than setInterval, so the next delay can depend on
    // what we just learned. `granted` schedules nothing at all: that is the
    // steady state for a correctly set up machine, and the only transition that
    // has to be caught promptly is denied -> granted. A later revoke is rare and
    // is picked up on the next window focus, below.
    const poll = (): void => {
      const settle = (next: FullDiskAccessInfo | null): void => {
        if (!mounted) return;
        setInfo(next);
        const delay =
          next?.state === "denied"
            ? POLL_DENIED_MS
            : next?.state === "granted"
              ? null
              : POLL_UNKNOWN_MS;
        if (delay !== null) timer = setTimeout(poll, delay);
      };
      // Called, not awaited, and guarded on both failure modes: an older main
      // process has no handler (the invoke rejects) and an older preload has no
      // method at all (calling it throws synchronously, which would escape a
      // .catch() and take the whole view down). Either way we fall silent
      // rather than render a permissions warning we can't substantiate.
      try {
        void window.api.detectord
          .fullDiskAccess()
          .then((i) => settle(i))
          .catch(() => settle(null));
      } catch {
        settle(null);
      }
    };

    poll();

    // Returning to the window is exactly when the user comes back from System
    // Settings, and it costs nothing while they are away - so it covers both the
    // grant we stopped polling for and a later revoke.
    const onFocus = (): void => poll();
    window.addEventListener("focus", onFocus);

    return () => {
      mounted = false;
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  if (!info || info.state !== "denied") return null;

  const copyPath = (): void => {
    void navigator.clipboard.writeText(info.binaryPath).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div
      role="alert"
      className="flex items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-1.5"
    >
      <svg viewBox="0 0 16 16" fill="none" className="h-3 w-3 shrink-0 text-amber-400" aria-hidden="true">
        <path
          d="M8 5v4m0 2.5v.01M7.1 1.8 1.3 12.2A1 1 0 0 0 2.2 13.7h11.6a1 1 0 0 0 .9-1.5L8.9 1.8a1 1 0 0 0-1.8 0Z"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="truncate text-[11px] text-[var(--text-secondary)]">
        Detection is delayed: grant Full Disk Access to the SealGate daemon so it can watch your
        agent configs as they change.
      </span>
      <button
        type="button"
        onClick={() => void window.api.detectord.openFullDiskAccessSettings()}
        className="ml-auto shrink-0 rounded border border-amber-500/40 px-2 py-0.5 text-[11px] text-amber-300 hover:bg-amber-500/15"
      >
        Open Settings
      </button>
      {/* The pane's + button opens a file picker that hides bundle internals,
          so the user needs the path to paste into Cmd-Shift-G. */}
      <button
        type="button"
        onClick={copyPath}
        title={info.binaryPath}
        className="shrink-0 rounded border border-amber-500/40 px-2 py-0.5 text-[11px] text-amber-300 hover:bg-amber-500/15"
      >
        {copied ? "Copied" : "Copy path"}
      </button>
    </div>
  );
}
