import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

type Placement = "top" | "bottom" | "left" | "right";

interface TooltipProps {
  content: ReactNode;
  placement?: Placement;
  children: ReactNode;
}

export default function Tooltip({ content, placement = "top", children }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [actualPlacement, setActualPlacement] = useState(placement);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const tooltipId = useRef(`tooltip-${Math.random().toString(36).slice(2, 8)}`);

  const show = useCallback(() => setVisible(true), []);
  const hide = useCallback(() => setVisible(false), []);

  // Auto-flip if tooltip overflows viewport
  useEffect(() => {
    if (!visible || !tooltipRef.current) return;
    const rect = tooltipRef.current.getBoundingClientRect();
    let flipped = placement;
    if (placement === "top" && rect.top < 0) flipped = "bottom";
    else if (placement === "bottom" && rect.bottom > window.innerHeight) flipped = "top";
    else if (placement === "left" && rect.left < 0) flipped = "right";
    else if (placement === "right" && rect.right > window.innerWidth) flipped = "left";
    if (flipped !== actualPlacement) setActualPlacement(flipped);
  }, [visible, placement, actualPlacement]);

  // Reset placement when preference changes
  useEffect(() => {
    setActualPlacement(placement);
  }, [placement]);

  const positionClasses: Record<Placement, string> = {
    top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
    left: "right-full top-1/2 -translate-y-1/2 mr-2",
    right: "left-full top-1/2 -translate-y-1/2 ml-2",
  };

  return (
    <span
      ref={triggerRef}
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      aria-describedby={visible ? tooltipId.current : undefined}
    >
      {children}
      {visible && (
        <div
          ref={tooltipRef}
          id={tooltipId.current}
          role="tooltip"
          className={`absolute z-50 max-w-xs rounded-lg border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2 text-xs text-[var(--text-primary)] shadow-lg pointer-events-none ${positionClasses[actualPlacement]}`}
        >
          {content}
        </div>
      )}
    </span>
  );
}
