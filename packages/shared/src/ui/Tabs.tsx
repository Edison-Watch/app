import { useCallback, useRef, type KeyboardEvent } from "react";
import { useSearchParams } from "react-router";

export interface TabItem {
  key: string;
  label: string;
  badge?: number;
}

interface TabsProps {
  tabs: TabItem[];
  /** URL search param name. Defaults to "tab" */
  param?: string;
  /** Fallback tab key when param is missing from URL */
  defaultTab?: string;
  /** Called after tab changes */
  onChange?: (key: string) => void;
}

export default function Tabs({
  tabs,
  param = "tab",
  defaultTab,
  onChange,
}: TabsProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const active = searchParams.get(param) ?? defaultTab ?? tabs[0]?.key ?? "";
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const setTab = useCallback(
    (key: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set(param, key);
          return next;
        },
        { replace: true },
      );
      onChange?.(key);
    },
    [setSearchParams, param, onChange],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const idx = tabs.findIndex((t) => t.key === active);
      let next: number;

      if (e.key === "ArrowRight") {
        e.preventDefault();
        next = (idx + 1) % tabs.length;
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        next = (idx - 1 + tabs.length) % tabs.length;
      } else if (e.key === "Home") {
        e.preventDefault();
        next = 0;
      } else if (e.key === "End") {
        e.preventDefault();
        next = tabs.length - 1;
      } else {
        return;
      }

      setTab(tabs[next]!.key);
      tabRefs.current[next]?.focus();
    },
    [tabs, active, setTab],
  );

  return (
    <div
      role="tablist"
      className="flex gap-1 border-b border-[var(--border)]"
      onKeyDown={handleKeyDown}
    >
      {tabs.map((tab, i) => {
        const isActive = active === tab.key;
        return (
          <button
            key={tab.key}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            onClick={() => setTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              isActive
                ? "border-[var(--accent)] text-[var(--accent)]"
                : "border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            {tab.label}
            {tab.badge != null && (
              <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--accent)]/15 px-1.5 text-[10px] font-semibold text-[var(--accent)]">
                {tab.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
