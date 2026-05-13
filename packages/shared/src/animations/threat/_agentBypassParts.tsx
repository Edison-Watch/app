/**
 * Shared building blocks for the agent-bypass animation family
 * (HumanAccessAnimation, AgentBypassPathAnimation, AgentBypassAnimation).
 */

import React from 'react'

export const GREEN = '#3ddc84'

export const PERSON_PATH =
  'M230.92,212c-15.23-26.33-38.7-45.21-66.09-54.16a72,72,0,1,0-73.66,0c-27.39,8.94-50.86,27.82-66.09,54.16a8,8,0,1,0,13.85,8c18.84-32.56,52.14-52,89.07-52s70.23,19.44,89.07,52a8,8,0,1,0,13.85-8ZM72,96a56,56,0,1,1,56,56A56.06,56.06,0,0,1,72,96Z'

/**
 * SSO/RBAC mesh wall: a thin slab with a 5×7 grid pattern. Used to
 * represent a traditional authn/authz boundary that blocks unapproved
 * traffic. `color` selects accent (active) vs muted (defeated).
 */
export function MeshWall({
  x, y, width, height, label, color
}: {
  x: number; y: number; width: number; height: number
  label?: string; color: string
}): React.ReactNode {
  const cols = 5
  const rows = 7
  const dx = width / cols
  const dy = height / rows
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} rx="2"
        fill="var(--text-primary)" fillOpacity="0.02"
        stroke={color} strokeOpacity="0.7" strokeWidth="1.4" />
      {Array.from({ length: cols - 1 }, (_, i) => (
        <line key={`v${i}`}
          x1={x + (i + 1) * dx} y1={y}
          x2={x + (i + 1) * dx} y2={y + height}
          stroke={color} strokeOpacity="0.45" strokeWidth="0.8" />
      ))}
      {Array.from({ length: rows - 1 }, (_, i) => (
        <line key={`h${i}`}
          x1={x} y1={y + (i + 1) * dy}
          x2={x + width} y2={y + (i + 1) * dy}
          stroke={color} strokeOpacity="0.45" strokeWidth="0.8" />
      ))}
      {label && (
        <text x={x + width / 2} y={y - 6} textAnchor="middle"
          fill={color} fillOpacity="0.85"
          fontSize="9" fontWeight="600"
          fontFamily="system-ui,sans-serif">
          {label}
        </text>
      )}
    </g>
  )
}

/**
 * Stacked-square "data" icon (3 layers, cyan/accent glow). Mimics the
 * cube-stack illustration in the marketing diagram.
 */
export function DataCylinder({
  cx, cy, size = 36, className
}: {
  cx: number; cy: number; size?: number; className?: string
}): React.ReactNode {
  const w = size
  const h = size * 1.4
  const ry = size * 0.22
  const top = cy - h / 2
  const bot = cy + h / 2
  const x0 = cx - w / 2
  return (
    <g className={className}>
      <rect x={x0} y={top + ry} width={w} height={h - ry * 2}
        fill="var(--accent)" fillOpacity="0.15" />
      <ellipse cx={cx} cy={top + ry} rx={w / 2} ry={ry}
        fill="var(--accent)" fillOpacity="0.15" />
      <ellipse cx={cx} cy={bot - ry} rx={w / 2} ry={ry}
        fill="var(--accent)" fillOpacity="0.25" />
      <line x1={x0} y1={top + ry} x2={x0} y2={bot - ry}
        stroke="var(--accent)" strokeOpacity="0.6" strokeWidth="1" />
      <line x1={x0 + w} y1={top + ry} x2={x0 + w} y2={bot - ry}
        stroke="var(--accent)" strokeOpacity="0.6" strokeWidth="1" />
      <ellipse cx={cx} cy={bot - ry} rx={w / 2} ry={ry}
        fill="none"
        stroke="var(--accent)" strokeOpacity="0.6" strokeWidth="1" />
      <ellipse cx={cx} cy={top + ry} rx={w / 2} ry={ry}
        fill="var(--accent)" fillOpacity="0.45"
        stroke="var(--accent)" strokeOpacity="0.8" strokeWidth="1" />
      <line x1={cx - w * 0.2} y1={top + ry + ry * 0.6} x2={cx + w * 0.2} y2={top + ry + ry * 0.6}
        stroke="var(--accent)" strokeOpacity="0.3" strokeWidth="0.6" />
      <line x1={cx - w * 0.28} y1={top + ry + ry * 1.8} x2={cx + w * 0.28} y2={top + ry + ry * 1.8}
        stroke="var(--accent)" strokeOpacity="0.2" strokeWidth="0.6" />
    </g>
  )
}
