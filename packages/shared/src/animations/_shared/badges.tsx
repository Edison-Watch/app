/**
 * Verdict badge - the green check or red X circle that pops in at the
 * gateway when a packet arrives. The single most ubiquitous shared
 * metaphor in the animation set (see CLAUDE.md metaphor A).
 *
 * Each call wraps the badge in a `<g className="<prefix>-vN">` whose
 * keyframe handles the pop-in (`scale(0.5) opacity:0` → `scale(1)
 * opacity:1`). Pass that class via `className`; the badge itself only
 * draws static SVG.
 */

import { DANGER } from "./colors";

export type VerdictVariant = "allow" | "deny";

/**
 * @param cx,cy    badge center
 * @param r        badge radius (7-12 in practice; default 8)
 * @param variant  'allow' = accent check, 'deny' = DANGER X
 * @param className the animation-owned wrapper class driving pop-in
 */
export function VerdictBadge({
  cx,
  cy,
  r = 8,
  variant,
  className,
  strokeWidth,
}: {
  cx: number;
  cy: number;
  r?: number;
  variant: VerdictVariant;
  className?: string;
  /** Glyph stroke width; defaults to `r * 0.2` (≈ 1.4 at r=7, 1.8 at r=9). */
  strokeWidth?: number;
}): React.ReactNode {
  const color = variant === "allow" ? "var(--accent)" : DANGER;
  const sw = strokeWidth ?? Math.max(1.2, r * 0.2);
  const transformOrigin = `${cx}px ${cy}px`;
  return (
    <g className={className} style={{ transformOrigin }}>
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill={color}
        fillOpacity="0.12"
        stroke={color}
        strokeOpacity="0.5"
        strokeWidth="1"
      />
      {variant === "allow" ? (
        <polyline
          points={`${cx - r * 0.55},${cy} ${cx - r * 0.22},${cy + r * 0.33} ${cx + r * 0.55},${cy - r * 0.44}`}
          fill="none"
          stroke={color}
          strokeWidth={sw}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <>
          <line
            x1={cx - r * 0.44}
            y1={cy - r * 0.44}
            x2={cx + r * 0.44}
            y2={cy + r * 0.44}
            stroke={color}
            strokeWidth={sw}
            strokeLinecap="round"
          />
          <line
            x1={cx + r * 0.44}
            y1={cy - r * 0.44}
            x2={cx - r * 0.44}
            y2={cy + r * 0.44}
            stroke={color}
            strokeWidth={sw}
            strokeLinecap="round"
          />
        </>
      )}
    </g>
  );
}
