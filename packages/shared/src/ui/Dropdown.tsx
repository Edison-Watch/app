import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

export interface DropdownItem {
  key: string;
  label: ReactNode;
  disabled?: boolean;
  danger?: boolean;
}

interface DropdownProps {
  trigger: ReactNode;
  items: DropdownItem[];
  onSelect: (key: string) => void;
  align?: "left" | "right";
}

export default function Dropdown({ trigger, items, onSelect, align = "left" }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setFocusedIndex(-1);
  }, []);

  const enabledItems = items.filter((i) => !i.disabled);

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

      switch (e.key) {
        case "Escape":
          e.preventDefault();
          close();
          break;
        case "ArrowDown":
          e.preventDefault();
          setFocusedIndex((i) => (i + 1) % enabledItems.length);
          break;
        case "ArrowUp":
          e.preventDefault();
          setFocusedIndex((i) => (i - 1 + enabledItems.length) % enabledItems.length);
          break;
        case "Enter":
        case " ":
          e.preventDefault();
          if (focusedIndex >= 0 && focusedIndex < enabledItems.length) {
            onSelect(enabledItems[focusedIndex].key);
            close();
          }
          break;
      }
    },
    [open, close, enabledItems, focusedIndex, onSelect],
  );

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        close();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, close]);

  return (
    <div ref={containerRef} className="relative inline-block" onKeyDown={handleKeyDown}>
      <div
        role="button"
        tabIndex={0}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o);
          if (!open) setFocusedIndex(0);
        }}
      >
        {trigger}
      </div>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          className={`absolute z-50 mt-1 min-w-[10rem] rounded-md border border-[var(--border)] bg-[var(--bg-raised)] shadow-lg py-1 ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {items.map((item) => {
            const enabledIdx = enabledItems.indexOf(item);
            const isFocused = enabledIdx === focusedIndex;
            return (
              <button
                key={item.key}
                role="menuitem"
                disabled={item.disabled}
                tabIndex={-1}
                className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                  item.disabled
                    ? "text-[var(--text-muted)] cursor-not-allowed"
                    : item.danger
                      ? "text-[var(--danger)] hover:bg-red-500/10"
                      : "text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                } ${isFocused && !item.disabled ? "bg-[var(--bg-hover)]" : ""}`}
                onClick={() => {
                  if (item.disabled) return;
                  onSelect(item.key);
                  close();
                }}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
