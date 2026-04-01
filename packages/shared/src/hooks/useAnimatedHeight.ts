import { useEffect, useRef, useState } from "react";

/**
 * Observes the scroll height of a content element and returns it.
 * Picks up all size changes: tab switches, async loads, subtab switches, etc.
 *
 * Pair with a framer-motion `<motion.div animate={{ height }}>` wrapper
 * to smoothly animate container height changes.
 */
export function useAnimatedHeight() {
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | "auto">("auto");

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    const observer = new ResizeObserver(() => {
      setHeight(el.scrollHeight);
    });
    observer.observe(el);
    // Also observe all direct children so we catch internal reflows
    for (const child of el.children) {
      observer.observe(child);
    }

    return () => observer.disconnect();
  }, []);

  return { contentRef, height };
}
