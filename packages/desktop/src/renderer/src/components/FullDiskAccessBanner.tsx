import { useEffect, useState } from "react";

/** Mirror of the main-process FullDiskAccessInfo (see main/detectord/fullDiskAccess.ts). */
interface FullDiskAccessInfo {
  state: "granted" | "denied" | "unknown";
  binaryPath: string;
}

/** How often to re-ask. The grant is made in System Settings, so there's no event to wait on. */
const POLL_MS = 5000;

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
 * Not dismissible while it applies: it clears itself within POLL_MS of the
 * grant landing, so there is nothing to dismiss.
 */
export default function FullDiskAccessBanner(): React.ReactNode {
  const [info, setInfo] = useState<FullDiskAccessInfo | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let mounted = true;
    const poll = (): void => {
      // Called, not awaited, and guarded on both failure modes: an older main
      // process has no handler (the invoke rejects) and an older preload has no
      // method at all (calling it throws synchronously, which would escape a
      // .catch() and take the whole view down). Either way we fall silent
      // rather than render a permissions warning we can't substantiate.
      try {
        void window.api.detectord
          .fullDiskAccess()
          .then((i) => {
            if (mounted) setInfo(i);
          })
          .catch(() => {
            if (mounted) setInfo(null);
          });
      } catch {
        if (mounted) setInfo(null);
      }
    };
    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      mounted = false;
      clearInterval(timer);
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
