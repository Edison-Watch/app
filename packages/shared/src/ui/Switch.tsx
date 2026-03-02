import { useCallback, type KeyboardEvent } from "react";

interface SwitchProps {
  checked: boolean;
  onChange?: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  loading?: boolean;
}

export default function Switch({ checked, onChange, label, disabled, loading }: SwitchProps) {
  const isDisabled = disabled || loading;

  const handleClick = useCallback(() => {
    if (!isDisabled) onChange?.(!checked);
  }, [isDisabled, checked, onChange]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (isDisabled) return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        onChange?.(!checked);
      }
    },
    [isDisabled, checked, onChange],
  );

  return (
    <label className={`inline-flex items-center gap-2 ${isDisabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={isDisabled}
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
          checked ? "bg-[var(--accent)]" : "bg-gray-600"
        }`}
      >
        <span
          className={`pointer-events-none inline-flex h-4 w-4 items-center justify-center rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-4" : "translate-x-0"
          }`}
        >
          {loading && (
            <svg className="h-3 w-3 animate-spin text-gray-400" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
              <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" />
            </svg>
          )}
        </span>
      </button>
      {label && (
        <span className="text-sm text-[var(--text-secondary)]">{label}</span>
      )}
    </label>
  );
}
