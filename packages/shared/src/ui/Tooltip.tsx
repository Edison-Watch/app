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
      const rect = tooltipRef.current.getBoundingClientRect();
      let flipped = placement;
      let { top, left } = pos;
      if (placement === "top" && rect.top < 0) { flipped = "bottom"; top = trigger.bottom + 8; }
      else if (placement === "bottom" && rect.bottom > window.innerHeight) { flipped = "top"; top = trigger.top - 8; }
      else if (placement === "left" && rect.left < 0) { flipped = "right"; left = trigger.right + 8; }
      else if (placement === "right" && rect.right > window.innerWidth) { flipped = "left"; left = trigger.left - 8; }
      if (flipped !== placement) {
        setCoords({ top, left });
        setActualPlacement(flipped);
      }
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
