/**
 * Dashed flow line - the universal "MCP traffic" connector between
 * laptops, Edison, and MCP servers. Every animation declares the same
 * `strokeDasharray="3 3"` + marching-ants keyframe; this component just
 * standardizes the markup so the per-animation CSS only has to declare
 * the keyframe.
 */

/**
 * @param className the animation-owned class driving the marching-ants
 *   animation, e.g. `"afc-line"`. Required; the keyframe (`0 → -12`
 *   `stroke-dashoffset` over 2s) is still declared per-animation.
 */
export function FlowLine({
  x1, y1, x2, y2, stroke, strokeOpacity = 0.5,
  strokeWidth = 1.5, strokeDasharray = '3 3', className,
}: {
  x1: number; y1: number; x2: number; y2: number
  /**
   * Stroke color. Pass `var(--text-muted)` for "before Edison" / inert,
   * `var(--accent)` for "via Edison", or a `DANGER`/`RED`/`GREEN`
   * constant for semantic flows.
   */
  stroke: string
  strokeOpacity?: number | string
  strokeWidth?: number | string
  strokeDasharray?: string
  className?: string
}): React.ReactNode {
  return (
    <line className={className}
      x1={x1} y1={y1} x2={x2} y2={y2}
      stroke={stroke} strokeOpacity={strokeOpacity}
      strokeWidth={strokeWidth} strokeDasharray={strokeDasharray} />
  )
}
