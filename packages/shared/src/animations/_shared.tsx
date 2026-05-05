/**
 * Internal helpers shared across the animation components in this folder.
 *
 * Consolidates the SVG primitives, Phosphor icon path strings, color
 * constants, and the small JSX building blocks (MCP icon, agent icon,
 * Edison logo, MCP-shaped packet, progress bar) that the individual
 * animations would otherwise each redeclare.
 *
 * Each animation still owns its own CSS prefix (`ek-`, `ew-`, `pi-`,
 * `rbac-`, `dca-`, `afc-`) and keyframe schedule; this module only
 * extracts the visually identical pieces.
 */

import type { AgentIconEntry } from '../agent-registry'
import {
  EDISON_E_PATH,
  EDISON_FRAME_PATH,
  EDISON_LOGO_VIEWBOX,
  EDISON_WATCH_FILL_PATH,
  EDISON_WATCH_STROKE_PATH,
} from '../svg/edison-logo-svg'
import { MCP_ICON_PATHS, MCP_ICON_VIEWBOX } from '../svg/mcp-svg'

/* ──────────────────────────────────────────────────────────────────────
 * Colors
 * ────────────────────────────────────────────────────────────────────── */

/** Brand orange used for "before Edison" / unencrypted / pre-trifecta state. */
export const ORANGE = '#da7756'
/** Saturated red used for attacker / RBAC violation visuals. */
export const RED = '#d94040'
/** Tailwind red-500 used for danger badges (eye-slash, X marks, quarantine). */
export const DANGER = '#ef4444'

/* ──────────────────────────────────────────────────────────────────────
 * Phosphor icon path data (viewBox 0 0 256 256)
 * ────────────────────────────────────────────────────────────────────── */

export const EYE_PATH =
  'M247.31,124.76c-.35-.79-8.82-19.58-27.65-38.41C194.57,61.26,162.88,48,128,48S61.43,61.26,36.34,86.35C17.51,105.18,9,124,8.69,124.76a8,8,0,0,0,0,6.5c.35.79,8.82,19.57,27.65,38.4C61.43,194.74,93.12,208,128,208s66.57-13.26,91.66-38.34c18.83-18.83,27.3-37.61,27.65-38.4A8,8,0,0,0,247.31,124.76ZM128,192c-30.78,0-57.67-11.19-79.93-33.25A133.47,133.47,0,0,1,25,128,133.33,133.33,0,0,1,48.07,97.25C70.33,75.19,97.22,64,128,64s57.67,11.19,79.93,33.25A133.46,133.46,0,0,1,231.05,128C223.84,141.46,192.43,192,128,192Zm0-112a48,48,0,1,0,48,48A48.05,48.05,0,0,0,128,80Zm0,80a32,32,0,1,1,32-32A32,32,0,0,1,128,160Z'

export const EYE_SLASH_PATH =
  'M53.92,34.62A8,8,0,1,0,42.08,45.38L61.32,66.55C25,88.84,9.38,123.2,8.69,124.76a8,8,0,0,0,0,6.5c.35.79,8.82,19.57,27.65,38.4C61.43,194.74,93.12,208,128,208a127.11,127.11,0,0,0,52.07-10.83l22,24.21a8,8,0,1,0,11.84-10.76Zm47.33,75.84,41.67,45.85a32,32,0,0,1-41.67-45.85ZM128,192c-30.78,0-57.67-11.19-79.93-33.25A133.16,133.16,0,0,1,25,128c4.69-8.79,19.66-33.39,47.35-49.38l18,19.75a48,48,0,0,0,63.66,70l14.73,16.2A112,112,0,0,1,128,192Zm6-95.43a8,8,0,0,1,3-15.72,48.16,48.16,0,0,1,38.77,42.64,8,8,0,0,1-7.22,8.71,6.39,6.39,0,0,1-.75,0,8,8,0,0,1-8-7.26A32.09,32.09,0,0,0,134,96.57Zm113.28,34.69c-.42.94-10.55,23.37-33.36,43.8a8,8,0,1,1-10.67-11.92A132.77,132.77,0,0,0,231.05,128a133.15,133.15,0,0,0-23.12-30.77C185.67,75.19,158.78,64,128,64a118.37,118.37,0,0,0-19.36,1.57A8,8,0,1,1,106,49.79,134,134,0,0,1,128,48c34.88,0,66.57,13.26,91.66,38.35,18.83,18.83,27.3,37.62,27.65,38.41A8,8,0,0,1,247.31,131.26Z'

export const ADMIN_PATH =
  'M228.25,63.07l-4.66-2.69a23.6,23.6,0,0,0,0-8.76l4.66-2.69a8,8,0,0,0-8-13.86l-4.67,2.7A23.92,23.92,0,0,0,208,33.38V28a8,8,0,0,0-16,0v5.38a23.92,23.92,0,0,0-7.58,4.39l-4.67-2.7a8,8,0,1,0-8,13.86l4.66,2.69a23.6,23.6,0,0,0,0,8.76l-4.66,2.69a8,8,0,0,0,4,14.93,7.92,7.92,0,0,0,4-1.07l4.67-2.7A23.92,23.92,0,0,0,192,78.62V84a8,8,0,0,0,16,0V78.62a23.92,23.92,0,0,0,7.58-4.39l4.67,2.7a7.92,7.92,0,0,0,4,1.07,8,8,0,0,0,4-14.93ZM192,56a8,8,0,1,1,8,8A8,8,0,0,1,192,56Zm29.35,48.11a8,8,0,0,0-6.57,9.21A88.85,88.85,0,0,1,216,128a87.62,87.62,0,0,1-22.24,58.41,79.66,79.66,0,0,0-36.06-28.75,48,48,0,1,0-59.4,0,79.66,79.66,0,0,0-36.06,28.75A88,88,0,0,1,128,40a88.76,88.76,0,0,1,14.68,1.22,8,8,0,0,0,2.64-15.78,103.92,103.92,0,1,0,85.24,85.24A8,8,0,0,0,221.35,104.11ZM96,120a32,32,0,1,1,32,32A32,32,0,0,1,96,120ZM74.08,197.5a64,64,0,0,1,107.84,0,87.83,87.83,0,0,1-107.84,0Z'

export const SHIELD_CHECK_PATH =
  'M208,40H48A16,16,0,0,0,32,56v56c0,52.72,25.52,84.67,46.93,102.19,23.06,18.86,46,25.26,47,25.53a8,8,0,0,0,4.2,0c1-.27,23.91-6.67,47-25.53C198.48,196.67,224,164.72,224,112V56A16,16,0,0,0,208,40Zm0,72c0,37.07-13.66,67.16-40.6,89.42A129.3,129.3,0,0,1,128,223.62a128.25,128.25,0,0,1-38.92-21.81C61.82,179.51,48,149.3,48,112l0-56,160,0ZM82.34,141.66a8,8,0,0,1,11.32-11.32L112,148.69l50.34-50.35a8,8,0,0,1,11.32,11.32l-56,56a8,8,0,0,1-11.32,0Z'

/* ──────────────────────────────────────────────────────────────────────
 * Components
 * ────────────────────────────────────────────────────────────────────── */

/** MCP "paperclip" logo, two-path SVG, colored + opacity tunable. */
export function McpIcon({ x, y, size, color, opacity = '0.65' }: {
  x: number; y: number; size: number; color: string; opacity?: string
}): React.ReactNode {
  return (
    <svg x={x} y={y} width={size} height={size} viewBox={MCP_ICON_VIEWBOX}>
      <path d={MCP_ICON_PATHS[0]} fill={color} fillOpacity={opacity} />
      <path d={MCP_ICON_PATHS[1]} fill={color} fillOpacity={opacity} />
    </svg>
  )
}

/** Branded square containing the agent's icon (Claude, Cursor, Codex, ...). */
export function AgentIcon({ agent, x, y, size = 20 }: {
  agent: AgentIconEntry; x: number; y: number; size?: number
}): React.ReactNode {
  const inner = size - 4
  return (
    <g>
      <rect x={x} y={y} width={size} height={size} rx={5} fill={agent.brandColor} />
      {agent.customSvg ? (
        <svg
          x={x + 2} y={y + 2} width={inner} height={inner}
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
export function EdisonLogo({ x, y, w, h }: {
  x: number; y: number; w: number; h: number
}): React.ReactNode {
  return (
    <svg x={x} y={y} width={w} height={h} viewBox={EDISON_LOGO_VIEWBOX}>
      <path d={EDISON_E_PATH} fill="var(--accent)" fillOpacity="0.8" stroke="var(--accent)" strokeWidth="5" strokeMiterlimit="10" />
      <path d={EDISON_WATCH_FILL_PATH} fill="var(--accent)" fillOpacity="0.8" />
      <path d={EDISON_WATCH_STROKE_PATH} fill="none" stroke="var(--accent)" strokeOpacity="0.8" strokeWidth="4" strokeMiterlimit="10" />
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
export function ProgressBar({ y, width, x = 20, className }: {
  y: number; width: number; x?: number; className: string
}): React.ReactNode {
  return (
    <>
      <rect x={x} y={y} width={width} height="1.5" rx="0.75"
        fill="var(--text-primary)" fillOpacity="0.1" />
      <rect className={className} x={x} y={y} width={width} height="1.5" rx="0.75"
        fill="var(--text-primary)" fillOpacity="0.35" />
    </>
  )
}
