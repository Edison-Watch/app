import type { ReactNode } from "react";

interface CardProps {
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}

export default function Card({ header, footer, children, className = "" }: CardProps) {
  return (
    <div
      className={`rounded-lg border border-[var(--border)] bg-[var(--bg-raised)] overflow-hidden ${className}`}
      style={{
        borderTopColor: "var(--accent-dim)",
        background:
          "linear-gradient(180deg, var(--bg-overlay) 0%, var(--bg-raised) 48px)",
      }}
    >
      {header && (
        <div className="px-5 py-4 border-b border-[var(--border)] text-[var(--text-primary)] font-medium">
          {header}
        </div>
      )}
      <div className="px-5 py-4">{children}</div>
      {footer && (
        <div className="px-5 py-3 border-t border-[var(--border)] bg-[var(--bg-base)]/50">
          {footer}
        </div>
      )}
    </div>
  );
}
