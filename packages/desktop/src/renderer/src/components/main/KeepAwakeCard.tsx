import { useEffect, useState } from "react";

import type {
  KeepAwakeEffective,
  KeepAwakeLocal,
  StdiodKeepAwake
} from "../../../../main/stdiod/types";

const POLL_MS = 3000;

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
 * when the local tunnel daemon is installed, because the daemon holds the
 * sleep block. "Follow dashboard" uses the value the machine owner sets on
 * the dashboard; "On" and "Off" override it on this computer.
 */
export default function KeepAwakeCard(): React.ReactNode {
  const [keepAwake, setKeepAwake] = useState<StdiodKeepAwake | null>(null);
  const [pending, setPending] = useState<KeepAwakeLocal | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const load = (): void => {
      window.api.stdiod.status().then((status) => {
        if (!mounted) return;
        setKeepAwake(status.installed ? (status.state?.keep_awake ?? null) : null);
      });
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

  // The daemon reads a new choice within a few seconds. Until state.json
  // shows it, keep showing the choice the person just made.
  useEffect(() => {
    if (pending && keepAwake?.local === pending) setPending(null);
  }, [keepAwake, pending]);

  if (!keepAwake) return null;

  const selected = pending ?? keepAwake.local;
  const choose = async (choice: KeepAwakeLocal): Promise<void> => {
    if (choice === selected) return;
    setError(null);
    setPending(choice);
    const result = await window.api.stdiod.setKeepAwake(choice);
    if (!result.ok) {
      setPending(null);
      setError(result.errorMessage ?? "Could not change the setting.");
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] px-4 py-3">
      <span className="text-xs font-semibold text-[var(--text-secondary)]">
        Keep this computer awake when plugged in
      </span>
      <span className="text-[11px] text-[var(--text-muted)]">
        Lets AI apps reach your local tools while you are away. The screen can still turn off,
        and closing a laptop lid still puts it to sleep.
      </span>
      <div className="flex gap-1" role="radiogroup" aria-label="Keep awake">
        {CHOICES.map((choice) => (
          <button
            key={choice.value}
            type="button"
            role="radio"
            aria-checked={selected === choice.value}
            disabled={pending !== null}
            onClick={() => void choose(choice.value)}
            className={`${
              choice.value === "auto" ? "flex-[1.8]" : "flex-1"
            } whitespace-nowrap rounded-md px-2 py-1 text-xs transition-colors disabled:opacity-60 ${
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
        {pending ? "Applying…" : NOW[keepAwake.effective]}
      </span>
      {error && <span className="text-[11px] text-[var(--danger,#e5484d)]">{error}</span>}
    </div>
  );
}
