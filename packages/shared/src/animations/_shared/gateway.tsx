/**
 * Edison Gateway badge - the central "Edison" mark that anchors the
 * "policy enforced here" metaphor. Composed of a pulse ring + the full
 * Edison Watch logo, optionally with a label below.
 *
 * The pulse keyframe (`scale(1) → scale(1.5-1.6)` over 1.33-1.5s with
 * `cubic-bezier(.2,.8,.4,1)`) is identical across 9+ animations. Each
 * animation still declares its own keyframe under its own prefix; this
 * component just standardizes the markup.
 */

import { EdisonLogo } from './icons'

/**
 * @param cx,cy   center of the badge
 * @param r       pulse-ring radius (default 30 - matches the hero size)
 * @param logoW   logo width (default `r * 1.8`)
 * @param label   optional label rendered below the logo
 * @param pulseClassName  the per-animation class driving the pulse keyframe
 */
export function EdisonGateway({
  cx,
  cy,
  r = 30,
  logoW,
  label,
  pulseClassName
}: {
  cx: number
  cy: number
  r?: number
  logoW?: number
  label?: string
  pulseClassName?: string
}): React.ReactNode {
  const w = logoW ?? r * 1.8
  const h = w * 0.975
  return (
    <>
      <circle
        className={pulseClassName}
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke="var(--accent)"
        strokeOpacity="0.5"
        strokeWidth="1.5"
      />
      <EdisonLogo x={cx - w / 2} y={cy - h / 2} w={w} h={h} />
      {label !== undefined && (
        <text
          x={cx}
          y={cy + r + 15}
          textAnchor="middle"
          fill="var(--text-primary)"
          fontSize="9"
          fontWeight="bold"
          fontFamily="system-ui,sans-serif"
        >
          {label}
        </text>
      )}
    </>
  )
}
