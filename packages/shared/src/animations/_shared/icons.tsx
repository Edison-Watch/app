/**
 * Iconography reused across animations.
 *
 * Each component renders into an `<svg>` positioned via `x`/`y` so it
 * can sit inside a parent animation `<svg>`. The Edison logo, MCP
 * paperclip, and agent square are all theme-aware via `var(--accent)`
 * or the caller's `fill`/`color`.
 */

import type { AgentIconEntry } from '../../agent-registry'
import {
  EDISON_E_PATH,
  EDISON_FRAME_PATH,
  EDISON_LOGO_VIEWBOX,
  EDISON_WATCH_FILL_PATH,
  EDISON_WATCH_STROKE_PATH
} from '../../svg/edison-logo-svg'
import { MCP_ICON_PATHS, MCP_ICON_VIEWBOX } from '../../svg/mcp-svg'

/** MCP "paperclip" logo, two-path SVG, colored + opacity tunable. */
export function McpIcon({
  x,
  y,
  size,
  color,
  opacity = '0.65'
}: {
  x: number
  y: number
  size: number
  color: string
  opacity?: string
}): React.ReactNode {
  return (
    <svg x={x} y={y} width={size} height={size} viewBox={MCP_ICON_VIEWBOX}>
      <path d={MCP_ICON_PATHS[0]} fill={color} fillOpacity={opacity} />
      <path d={MCP_ICON_PATHS[1]} fill={color} fillOpacity={opacity} />
    </svg>
  )
}

/**
 * Dome-headed robot with ring antenna, cut-out visor, and pill eyes.
 * Body, antenna, and eyes all take the caller's `fill`/`fillOpacity`;
 * the visor is punched out of the head via evenodd so the background
 * shows through cleanly on any tint (green safe, red corrupted, ...).
 */
export function RobotIcon({
  x,
  y,
  size,
  fill,
  fillOpacity = '0.55'
}: {
  x: number
  y: number
  size: number
  fill: string
  fillOpacity?: string
}): React.ReactNode {
  return (
    <svg x={x} y={y} width={size} height={size} viewBox="0 0 256 256">
      <circle
        cx="128"
        cy="24"
        r="10"
        fill="none"
        stroke={fill}
        strokeOpacity={fillOpacity}
        strokeWidth="6"
      />
      <rect x="125" y="34" width="6" height="20" fill={fill} fillOpacity={fillOpacity} />
      <path
        fillRule="evenodd"
        d="M40,144a88,88,0,0,1,176,0v44a44,44,0,0,1-44,44H84a44,44,0,0,1-44-44Z M92,116 h72 a28,28 0 0 1 28,28 v24 a28,28 0 0 1 -28,28 h-72 a28,28 0 0 1 -28,-28 v-24 a28,28 0 0 1 28,-28 z"
        fill={fill}
        fillOpacity={fillOpacity}
      />
      <rect x="88" y="138" width="24" height="36" rx="12" fill={fill} fillOpacity={fillOpacity} />
      <rect x="144" y="138" width="24" height="36" rx="12" fill={fill} fillOpacity={fillOpacity} />
    </svg>
  )
}

/** Branded square containing the agent's icon (Claude, Cursor, Codex, ...). */
export function AgentIcon({
  agent,
  x,
  y,
  size = 20
}: {
  agent: AgentIconEntry
  x: number
  y: number
  size?: number
}): React.ReactNode {
  const inner = size - 4
  return (
    <g>
      <rect x={x} y={y} width={size} height={size} rx={5} fill={agent.brandColor} />
      {agent.customSvg ? (
        <svg
          x={x + 2}
          y={y + 2}
          width={inner}
          height={inner}
          viewBox={agent.customViewBox || '0 0 24 24'}
          {...(agent.crispEdges ? { shapeRendering: 'crispEdges' } : {})}
          dangerouslySetInnerHTML={{ __html: agent.customSvg }}
        />
      ) : agent.svgPath ? (
        <svg x={x + 2} y={y + 2} width={inner} height={inner} viewBox="0 0 24 24">
          <path d={agent.svgPath} fill={agent.svgFill || '#fff'} />
        </svg>
      ) : null}
    </g>
  )
}

/**
 * Full Edison Watch logo (E + "Watch" subscript + frame) in accent color.
 * Used by animations that depict Edison as an active gateway/wrapper.
 */
export function EdisonLogo({
  x,
  y,
  w,
  h
}: {
  x: number
  y: number
  w: number
  h: number
}): React.ReactNode {
  return (
    <svg x={x} y={y} width={w} height={h} viewBox={EDISON_LOGO_VIEWBOX}>
      <path
        d={EDISON_E_PATH}
        fill="var(--accent)"
        fillOpacity="0.8"
        stroke="var(--accent)"
        strokeWidth="5"
        strokeMiterlimit="10"
      />
      <path d={EDISON_WATCH_FILL_PATH} fill="var(--accent)" fillOpacity="0.8" />
      <path
        d={EDISON_WATCH_STROKE_PATH}
        fill="none"
        stroke="var(--accent)"
        strokeOpacity="0.8"
        strokeWidth="4"
        strokeMiterlimit="10"
      />
      <path d={EDISON_FRAME_PATH} fill="var(--accent)" fillOpacity="0.8" />
    </svg>
  )
}

/**
 * Animated packet shaped like the MCP logo: a translucent halo with a
 * smaller MCP icon inside. Color is driven by `currentColor` so the
 * caller can swap palette via CSS (e.g. orange → accent).
 */
export function McpPacket(): React.ReactNode {
  return (
    <>
      <circle r="10" fill="currentColor" fillOpacity="0.12" />
      <g fill="currentColor" transform="translate(-6,-6) scale(0.5)">
        <path d={MCP_ICON_PATHS[0]} />
        <path d={MCP_ICON_PATHS[1]} />
      </g>
    </>
  )
}

/**
 * Progress bar (track + animated fill) anchored to the bottom of an
 * animation. The fill rect uses `className` so each animation can drive
 * the timing via its own `<prefix>-progress` keyframe.
 */
export function ProgressBar({
  y,
  width,
  x = 20,
  className
}: {
  y: number
  width: number
  x?: number
  className: string
}): React.ReactNode {
  return (
    <>
      <rect
        x={x}
        y={y}
        width={width}
        height="1.5"
        rx="0.75"
        fill="var(--text-primary)"
        fillOpacity="0.1"
      />
      <rect
        className={className}
        x={x}
        y={y}
        width={width}
        height="1.5"
        rx="0.75"
        fill="var(--text-primary)"
        fillOpacity="0.35"
      />
    </>
  )
}
