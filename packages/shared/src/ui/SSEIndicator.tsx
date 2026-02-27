export type SSEStatus = "connected" | "reconnecting" | "disconnected";

const STATUS_CONFIG = {
  connected: { color: "bg-[var(--success)]", label: "Connected" },
  reconnecting: { color: "bg-[var(--warning)]", label: "Reconnecting..." },
  disconnected: { color: "bg-[var(--danger)]", label: "Disconnected" },
} as const;

export default function SSEIndicator({ status }: { status: SSEStatus }) {
  const config = STATUS_CONFIG[status];

  return (
    <div className="relative group inline-flex items-center">
      <span
        className={`inline-block w-2 h-2 rounded-full ${config.color} ${
          status === "reconnecting" ? "animate-pulse" : ""
        }`}
        aria-label={config.label}
      />
      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 text-xs rounded bg-[var(--bg-overlay)] border border-[var(--border)] text-[var(--text-secondary)] whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
        {config.label}
      </span>
    </div>
  );
}
