import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

type Placement = "top" | "bottom" | "left" | "right";

interface TooltipProps {
  content: ReactNode;
  placement?: Placement;
  className?: string;
  children: ReactNode;
}

function computePosition(
  trigger: DOMRect,
  placement: Placement,
): { top: number; left: number } {
  if (placement === "top") return { top: trigger.top - 8, left: trigger.left + trigger.width / 2 };
  if (placement === "bottom") return { top: trigger.bottom + 8, left: trigger.left + trigger.width / 2 };
  if (placement === "left") return { top: trigger.top + trigger.height / 2, left: trigger.left - 8 };
  return { top: trigger.top + trigger.height / 2, left: trigger.right + 8 };
}

const TRANSFORM: Record<Placement, string> = {
  top: "translate(-50%, -100%)",
  bottom: "translate(-50%, 0)",
  left: "translate(-100%, -50%)",
  right: "translate(0, -50%)",
};

export default function Tooltip({ content, placement = "top", className, children }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const [actualPlacement, setActualPlacement] = useState(placement);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const tooltipId = useRef(`tooltip-${Math.random().toString(36).slice(2, 8)}`);

  const show = useCallback(() => setVisible(true), []);
  const hide = useCallback(() => {
    setVisible(false);
    setCoords(null);
  }, []);

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const trigger = triggerRef.current.getBoundingClientRect();
    const pos = computePosition(trigger, placement);
    setCoords(pos);
    setActualPlacement(placement);

    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      if (!tooltipRef.current) return;
      const margin = 8;
      let flipped: Placement = placement;
      let { top, left } = pos;

      const rect = tooltipRef.current.getBoundingClientRect();
      if (placement === "top" && rect.top < margin) { flipped = "bottom"; top = trigger.bottom + margin; }
      else if (placement === "bottom" && rect.bottom > window.innerHeight - margin) { flipped = "top"; top = trigger.top - margin; }
      else if (placement === "left" && rect.left < margin) { flipped = "right"; left = trigger.right + margin; }
      else if (placement === "right" && rect.right > window.innerWidth - margin) { flipped = "left"; left = trigger.left - margin; }

      // Recompute effective rect after any flip, then shift along the cross-axis
      // so the tooltip stays inside the viewport when wider/taller than the gap
      // between the trigger and the viewport edge.
      const width = rect.width;
      const height = rect.height;
      if (flipped === "top" || flipped === "bottom") {
        const halfW = width / 2;
        const minLeft = margin + halfW;
        const maxLeft = window.innerWidth - margin - halfW;
        if (maxLeft >= minLeft) left = Math.min(Math.max(left, minLeft), maxLeft);
      } else {
        const halfH = height / 2;
        const minTop = margin + halfH;
        const maxTop = window.innerHeight - margin - halfH;
        if (maxTop >= minTop) top = Math.min(Math.max(top, minTop), maxTop);
      }

      setCoords({ top, left });
      if (flipped !== placement) setActualPlacement(flipped);
    });
  }, [placement]);

  // Position on show + reposition on scroll/resize
  useEffect(() => {
    if (!visible) return;
    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [visible, updatePosition]);

  // Reset placement when preference changes
  useEffect(() => {
    setActualPlacement(placement);
  }, [placement]);

  // Inject aria-describedby onto the child element so screen readers
  // associate the tooltip with the actual focusable control, not the wrapper.
  const describedBy = visible ? tooltipId.current : undefined;
  let augmentedChildren: ReactNode = children;
  if (isValidElement<Record<string, unknown>>(children)) {
    const existing = children.props["aria-describedby"];
    const merged = existing
      ? `${existing} ${tooltipId.current}`
      : tooltipId.current;
    augmentedChildren = cloneElement(children, {
      "aria-describedby": visible ? merged : existing || undefined,
    });
  }

  return (
    <span
      ref={triggerRef}
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {augmentedChildren}
      {visible &&
        coords &&
        createPortal(
          <div
            ref={tooltipRef}
            id={describedBy}
            role="tooltip"
            style={{
              position: "fixed",
              top: coords.top,
              left: coords.left,
              transform: TRANSFORM[actualPlacement],
              zIndex: 9999,
            }}
            className={`${className ?? "max-w-xs"} rounded-lg border border-[var(--border)] bg-[var(--bg-overlay)] px-3 py-2 text-xs text-[var(--text-primary)] shadow-lg pointer-events-none`}
          >
            {content}
          </div>,
          document.body,
        )}
    </span>
  );
}
