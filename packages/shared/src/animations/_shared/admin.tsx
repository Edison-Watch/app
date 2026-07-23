/**
 * Admin figure - the gear-and-person icon plus "Admin" label used at
 * the top of every fleet/policy animation (metaphor A).
 */

import { ADMIN_PATH } from './svg-paths'

/**
 * @param cx     horizontal center of the figure (text and icon both centered)
 * @param y      top of the icon (label sits ~14px below the icon)
 * @param size   icon side length (default 26)
 * @param label  label text below (default "Admin", pass null to omit)
 * @param color  CSS color for icon + label (default `var(--text-primary)`)
 */
export function AdminFigure({
  cx,
  y,
  size = 26,
  label = 'Admin',
  color = 'var(--text-primary)',
  iconOpacity = '0.7',
  labelOpacity = '1'
}: {
  cx: number
  y: number
  size?: number
  label?: string | null
  color?: string
  iconOpacity?: string
  labelOpacity?: string
}): React.ReactNode {
  return (
    <g>
      <svg x={cx - size / 2} y={y} width={size} height={size} viewBox="0 0 256 256">
        <path d={ADMIN_PATH} fill={color} fillOpacity={iconOpacity} />
      </svg>
      {label !== null && (
        <text
          x={cx}
          y={y + size + 12}
          textAnchor="middle"
          fill={color}
          fillOpacity={labelOpacity}
          fontSize="8"
          fontWeight="bold"
          fontFamily="system-ui,sans-serif"
        >
          {label}
        </text>
      )}
    </g>
  )
}
