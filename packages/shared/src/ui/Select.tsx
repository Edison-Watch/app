import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectProps {
  /** Currently selected value (controlled). */
  value?: string;
  /** Default value (uncontrolled). */
  defaultValue?: string;
  /** Fired on selection change. */
  onChange?: (value: string) => void;
  /** Static options. Ignored when `loadOptions` is provided. */
  options?: SelectOption[];
  /** Async option loader. Receives search term, returns options. */
  loadOptions?: (search: string) => Promise<SelectOption[]>;
  /** Placeholder text. */
  placeholder?: string;
  /** Enable search / filter. */
  searchable?: boolean;
  /** Disable the select. */
  disabled?: boolean;
}

export default function Select({
  value: controlledValue,
  defaultValue,
  onChange,
  options: staticOptions,
  loadOptions,
  placeholder = "Select...",
  searchable = false,
  disabled = false,
}: SelectProps) {
  const isControlled = controlledValue !== undefined;
  const [internalValue, setInternalValue] = useState(defaultValue ?? "");
  const currentValue = isControlled ? controlledValue : internalValue;

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [asyncOptions, setAsyncOptions] = useState<SelectOption[]>([]);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const options = loadOptions ? asyncOptions : (staticOptions ?? []);

  const filtered = useMemo(() => {
    if (!searchable || !search) return options;
    const lower = search.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(lower));
  }, [options, search, searchable]);

  const selectedLabel = options.find((o) => o.value === currentValue)?.label ?? "";

  const select = useCallback(
    (val: string) => {
      if (!isControlled) setInternalValue(val);
      onChange?.(val);
      setOpen(false);
      setSearch("");
      setFocusedIndex(-1);
    },
    [isControlled, onChange],
  );

  // Async loading
  useEffect(() => {
    if (!loadOptions || !open) return;
    let cancelled = false;
    setLoading(true);
    loadOptions(search).then((opts) => {
      if (!cancelled) {
        setAsyncOptions(opts);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loadOptions, open, search]);

  // Outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!open) {
        if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
          e.preventDefault();
          setOpen(true);
          setFocusedIndex(0);
        }
        return;
      }

      const enabledFiltered = filtered.filter((o) => !o.disabled);

      switch (e.key) {
        case "Escape":
          e.preventDefault();
          setOpen(false);
          setSearch("");
          break;
        case "ArrowDown":
          e.preventDefault();
          setFocusedIndex((i) => Math.min(i + 1, enabledFiltered.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setFocusedIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (focusedIndex >= 0 && focusedIndex < enabledFiltered.length) {
            select(enabledFiltered[focusedIndex]!.value);
          }
          break;
      }
    },
    [open, filtered, focusedIndex, select],
  );

  return (
    <div ref={containerRef} className="relative" onKeyDown={handleKeyDown}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-md border transition-colors ${
          disabled
            ? "border-[var(--border)] text-[var(--text-muted)] cursor-not-allowed bg-[var(--bg-base)]"
            : "border-[var(--border)] text-[var(--text-primary)] bg-[var(--bg-raised)] hover:border-[var(--accent)] cursor-pointer"
        }`}
        onClick={() => {
          if (disabled) return;
          setOpen((o) => !o);
          if (!open) {
            setFocusedIndex(0);
            requestAnimationFrame(() => inputRef.current?.focus());
          }
        }}
      >
        <span className={currentValue ? "" : "text-[var(--text-muted)]"}>
          {currentValue ? selectedLabel || currentValue : placeholder}
        </span>
        <svg className="w-4 h-4 text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute z-50 mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--bg-raised)] shadow-lg max-h-60 overflow-auto"
        >
          {searchable && (
            <div className="p-2 border-b border-[var(--border)]">
              <input
                ref={inputRef}
                type="text"
                className="w-full px-2 py-1.5 text-sm rounded border border-[var(--border)] bg-[var(--bg-base)] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                placeholder="Search..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setFocusedIndex(0);
                }}
              />
            </div>
          )}

          {loading ? (
            <div className="px-3 py-4 text-sm text-center text-[var(--text-muted)]">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="px-3 py-4 text-sm text-center text-[var(--text-muted)]">No options</div>
          ) : (
            filtered.map((option) => {
              const enabledFiltered = filtered.filter((o) => !o.disabled);
              const enabledIdx = enabledFiltered.indexOf(option);
              const isFocused = enabledIdx === focusedIndex;
              const isSelected = option.value === currentValue;
              return (
                <button
                  key={option.value}
                  role="option"
                  aria-selected={isSelected}
                  disabled={option.disabled}
                  tabIndex={-1}
                  className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                    option.disabled
                      ? "text-[var(--text-muted)] cursor-not-allowed"
                      : "text-[var(--text-primary)] hover:bg-[var(--bg-base)] cursor-pointer"
                  } ${isFocused && !option.disabled ? "bg-[var(--bg-base)]" : ""} ${
                    isSelected ? "font-medium" : ""
                  }`}
                  onClick={() => {
                    if (option.disabled) return;
                    select(option.value);
                  }}
                >
                  {option.label}
                  {isSelected && <span className="ml-2 text-[var(--accent)]">✓</span>}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
