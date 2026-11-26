import { useEffect, useState } from "react";

import type {
  KeepAwakeEffective,
  KeepAwakeLocal,
  StdiodKeepAwake
} from "../../../../main/stdiod/types";

const POLL_MS = 3000;
// The daemon reads a new choice within about 5 s. After this long, stop
// saying "Applying…": the daemon is probably not running.
const APPLY_WAIT_MS = 10000;

const CHOICES: { value: KeepAwakeLocal; label: string }[] = [
  { value: "auto", label: "Follow dashboard" },
  { value: "on", label: "On" },
  { value: "off", label: "Off" }
];

const NOW: Record<KeepAwakeEffective, string> = {
  active: "Keeping this computer awake while it is plugged in.",
  on_battery: "On, but paused while this computer runs on battery.",
  inactive: "This computer can sleep as usual.",
  unsupported: "This system did not allow SealGate to keep it awake."
};

/**
 * Settings card (Config tab) for the local keep-awake choice. Shown only
 * when the local tunnel daemon is installed and reports keep-awake state,
 * which only the Windows daemon does: keep-awake is Windows-only.
 * "Follow dashboard" uses the value the machine owner sets on the
 * dashboard; "On" and "Off" override it on this computer.
 */
export default function KeepAwakeCard(): React.ReactNode {
  const [keepAwake, setKeepAwake] = useState<StdiodKeepAwake | null>(null);
  // False when the daemon that wrote state.json has stopped: its last
  // keep_awake value then no longer holds.
  const [daemonRunning, setDaemonRunning] = useState<boolean | null>(null);
  // True while the CLI call runs. The buttons are locked only then.
  const [busy, setBusy] = useState(false);
  // The saved choice that the daemon has not applied yet.
  const [saved, setSaved] = useState<KeepAwakeLocal | null>(null);
  const [savedLate, setSavedLate] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const load = (): void => {
      window.api.stdiod
        .status()
        .then((status) => {
          if (!mounted) return;
          setKeepAwake(status.installed ? (status.state?.keep_awake ?? null) : null);
          setDaemonRunning(status.daemonRunning ?? null);
        })
        // A failed read keeps the last state; the next poll tries again.
        .catch(() => {});
    };
    load();
    const timer = setInterval(load, POLL_MS);
    const unsubscribe = window.api.stdiod.onChanged(load);
    return () => {
      mounted = false;
      clearInterval(timer);
      unsubscribe();
    };
  }, []);

  // Until state.json shows the saved choice, keep showing it as selected.
  useEffect(() => {
    if (saved && keepAwake?.local === saved) {
      setSaved(null);
      setSavedLate(false);
    }
  }, [keepAwake, saved]);

  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSavedLate(true), APPLY_WAIT_MS);
    return () => clearTimeout(timer);
  }, [saved]);

  if (!keepAwake) return null;

  const selected = saved ?? keepAwake.local;
  const choose = async (choice: KeepAwakeLocal): Promise<void> => {
    if (choice === selected) return;
    setError(null);
    setBusy(true);
    try {
      const result = await window.api.stdiod.setKeepAwake(choice);
      if (result.ok) {
        setSavedLate(false);
        setSaved(choice === keepAwake.local ? null : choice);
      } else {
        setError(result.errorMessage ?? "Could not change the setting.");
      }
    } finally {
      setBusy(false);
    }
  };

  let statusText =
    daemonRunning === false
      ? "The local tunnel is not running, so this computer can sleep as usual."
      : NOW[keepAwake.effective];
  if (busy || (saved && !savedLate)) statusText = "Applying…";
  else if (saved) statusText = "Saved. It takes effect when the local tunnel is running.";

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] px-4 py-3">
      <span className="text-xs font-semibold text-[var(--text-secondary)]">
        Keep this computer awake when plugged in
      </span>
      <span className="text-[11px] text-[var(--text-muted)]">
        Lets AI apps reach your local tools while you are away. The screen can still turn off,
        and closing a laptop lid still puts it to sleep.
      </span>
      <div
        className="flex gap-1"
        role="radiogroup"
        aria-label="Keep awake"
        aria-busy={busy}
        onKeyDown={(event) => {
          // Radio-group keys: arrows move to the next or previous choice.
          const step =
            event.key === "ArrowRight" || event.key === "ArrowDown"
              ? 1
              : event.key === "ArrowLeft" || event.key === "ArrowUp"
                ? -1
                : 0;
          if (step === 0 || busy) return;
          event.preventDefault();
          const index = CHOICES.findIndex((choice) => choice.value === selected);
          const next = CHOICES[(index + step + CHOICES.length) % CHOICES.length];
          if (!next) return;
          const buttons = event.currentTarget.querySelectorAll("button");
          buttons[CHOICES.indexOf(next)]?.focus();
          void choose(next.value);
        }}
      >
        {CHOICES.map((choice) => (
          <button
            key={choice.value}
            type="button"
            role="radio"
            aria-checked={selected === choice.value}
            // Roving focus: only the selected choice is in the tab order.
            tabIndex={selected === choice.value ? 0 : -1}
            // aria-disabled instead of disabled, so the focused button keeps
            // focus while a change is applied.
            aria-disabled={busy}
            onClick={() => {
              if (!busy) void choose(choice.value);
            }}
            className={`${
              choice.value === "auto" ? "flex-[1.8]" : "flex-1"
            } whitespace-nowrap rounded-md px-2 py-1 text-xs transition-colors aria-disabled:opacity-60 ${
              selected === choice.value
                ? "bg-[var(--accent)] font-medium text-[var(--bg-base)]"
                : "bg-[var(--bg-input)] text-[var(--text-primary)]"
            }`}
          >
            {choice.value === "auto"
              ? `${choice.label} (${keepAwake.desired ? "on" : "off"})`
              : choice.label}
          </button>
        ))}
      </div>
      <span className="text-[11px] text-[var(--text-muted)]">
        {statusText}
      </span>
      {error && <span className="text-[11px] text-[var(--danger,#e5484d)]">{error}</span>}
    </div>
  );
}
