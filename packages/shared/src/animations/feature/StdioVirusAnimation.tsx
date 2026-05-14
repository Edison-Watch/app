/**
 * STDIO MCP virus-spread animation (standalone).
 *
 * A robot on a laptop spawns an in-process MCP server (red), and malware
 * blooms outward from inside the MCP box across the laptop. 12s loop.
 * Pure SVG + CSS. Respects `prefers-reduced-motion`.
 *
 * `StdioVirusContent` returns the inner SVG fragment (with its own scoped
 * `<style>` and `<defs>`) so it can be dropped into a parent SVG at the
 * original `0..186 x 0..132` coordinate range. The default export wraps it
 * in a standalone SVG container.
 *
 * Requires CSS custom properties: --text-primary, --text-muted.
 */

import { McpIcon, RED as R, RobotIcon } from '../_shared'

const MALWARE_PATH =
  'M136,108a28,28,0,1,0-28,28A28,28,0,0,0,136,108Zm-28,12a12,12,0,1,1,12-12A12,12,0,0,1,108,120Zm68-8a16,16,0,1,1-16,16A16,16,0,0,1,176,112Zm-32,64a16,16,0,1,1-16-16A16,16,0,0,1,144,176Zm96-56H223.66a95.52,95.52,0,0,0-22.39-53.95l12.39-12.39a8,8,0,0,0-11.32-11.32L190,54.73A95.52,95.52,0,0,0,136,32.34V16a8,8,0,0,0-16,0V32.34A95.52,95.52,0,0,0,66.05,54.73L53.66,42.34A8,8,0,0,0,42.34,53.66L54.73,66.05a95.52,95.52,0,0,0-22.39,54H16a8,8,0,0,0,0,16H32.34A95.52,95.52,0,0,0,54.73,190L42.34,202.34a8,8,0,0,0,11.32,11.32l12.39-12.39a95.52,95.52,0,0,0,54,22.39V240a8,8,0,0,0,16,0V223.66A95.52,95.52,0,0,0,190,201.27l12.39,12.39a8,8,0,0,0,11.32-11.32L201.27,190A95.52,95.52,0,0,0,223.66,136H240a8,8,0,0,0,0-16ZM128,208a80,80,0,1,1,80-80A80.09,80.09,0,0,1,128,208Z'

export const STDIO_VIRUS_CSS = `
.sv-anim { color: var(--text-primary); }
.sv-anim .sv-line { stroke-dashoffset: 0; animation: sv-lf 2s linear infinite; }

.sv-anim .sv-spawn { animation: sv-spawn 12s ease-in-out infinite; }
.sv-anim .sv-m0    { animation: sv-m0 12s ease-in-out infinite; }
.sv-anim .sv-m1    { animation: sv-m1 12s ease-in-out infinite; }
.sv-anim .sv-m2    { animation: sv-m2 12s ease-in-out infinite; }
.sv-anim .sv-m3    { animation: sv-m3 12s ease-in-out infinite; }

@keyframes sv-lf { to { stroke-dashoffset: -12; } }

@keyframes sv-spawn {
  0%,8%  { opacity:0; } 14% { opacity:1; } 92% { opacity:1; } 97%,100% { opacity:0; }
}

/* Malware origin: starts inside MCP box center (93,37), grows. Stays visible once appeared. */
@keyframes sv-m0 {
  0%,15% { opacity:0; transform:translate(93px,37px) scale(0); }
  22%    { opacity:1; transform:translate(93px,37px) scale(1); }
  30%    { opacity:1; transform:translate(80px,70px) scale(1); }
  100%   { opacity:1; transform:translate(80px,70px) scale(1); }
}
/* Spreads to bottom-left of laptop */
@keyframes sv-m1 {
  0%,24% { opacity:0; transform:translate(93px,37px) scale(0); }
  28%    { opacity:0.4; transform:translate(93px,37px) scale(.5); }
  40%    { opacity:0.8; transform:translate(28px,90px) scale(1); }
  100%   { opacity:0.8; transform:translate(28px,90px) scale(1); }
}
/* Spreads to bottom-right of laptop */
@keyframes sv-m2 {
  0%,32% { opacity:0; transform:translate(93px,37px) scale(0); }
  36%    { opacity:0.4; transform:translate(93px,37px) scale(.5); }
  48%    { opacity:0.7; transform:translate(136px,86px) scale(1); }
  100%   { opacity:0.7; transform:translate(136px,86px) scale(1); }
}
/* Spreads to center-right area */
@keyframes sv-m3 {
  0%,40% { opacity:0; transform:translate(93px,37px) scale(0); }
  44%    { opacity:0.3; transform:translate(93px,37px) scale(.5); }
  56%    { opacity:0.6; transform:translate(142px,60px) scale(1); }
  100%   { opacity:0.6; transform:translate(142px,60px) scale(1); }
}

@media (prefers-reduced-motion:reduce) {
  .sv-anim .sv-line, .sv-anim .sv-spawn,
  .sv-anim .sv-m0, .sv-anim .sv-m1, .sv-anim .sv-m2, .sv-anim .sv-m3 { animation:none; }
  .sv-anim .sv-spawn { opacity:1; }
  .sv-anim .sv-m0 { opacity:1; transform:translate(80px,70px) scale(1); }
  .sv-anim .sv-m1 { opacity:.8; transform:translate(28px,90px) scale(1); }
  .sv-anim .sv-m2 { opacity:.7; transform:translate(136px,86px) scale(1); }
  .sv-anim .sv-m3 { opacity:.6; transform:translate(142px,60px) scale(1); }
}
`

/**
 * Inner SVG fragment, designed to be embedded inside a parent `<svg>` at the
 * coordinate range x:[0..186] y:[0..132]. Includes its own `<style>` and a
 * scoped marker definition (`sv-arrM`).
 */
export function StdioVirusContent(): React.ReactNode {
  return (
    <>
      <style>{STDIO_VIRUS_CSS}</style>
      <g className="sv-anim">
        <defs>
          <marker id="sv-arrM" viewBox="0 0 10 10" refX="9" refY="5"
            markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0 1 L9 5 L0 9 Z" fill="var(--text-muted)" fillOpacity={0.6} />
          </marker>
        </defs>

        {/* Laptop */}
        <rect x="8" y="22" width="170" height="100" rx="6"
          fill="var(--text-primary)" fillOpacity="0.03"
          stroke="var(--text-muted)" strokeOpacity="0.35" strokeWidth="1.5" />
        <rect x="4" y="124" width="178" height="6" rx="3"
          fill="var(--text-primary)" fillOpacity="0.04"
          stroke="var(--text-muted)" strokeOpacity="0.35" strokeWidth="1" />

        {/* Robot */}
        <RobotIcon x={14} y={28} size={24} fill="var(--text-muted)" fillOpacity="0.55" />

        {/* Spawn arrow */}
        <g className="sv-spawn">
          <line className="sv-line" x1="40" y1="40" x2="58" y2="37"
            stroke="var(--text-muted)" strokeOpacity="0.5" strokeWidth="1"
            strokeDasharray="3 3" markerEnd="url(#sv-arrM)" />
        </g>

        {/* MCP process INSIDE laptop  -  always visible */}
        <g>
          <rect x="62" y="26" width="62" height="22" rx="4"
            fill={R} fillOpacity="0.05"
            stroke={R} strokeOpacity="0.4" strokeWidth="1.2" />
          <McpIcon x={78} y={30} size={14} color={R} opacity="0.7" />
          <text x="104" y="41" textAnchor="middle"
            fill={R} fontSize="6" fontWeight="bold" fontFamily="system-ui,sans-serif">
            MCP
          </text>
        </g>

        {/* Malware: origin inside MCP box, then spreads across laptop */}
        <g className="sv-m0">
          <svg x="-9" y="-9" width="18" height="18" viewBox="0 0 256 256">
            <path d={MALWARE_PATH} fill={R} fillOpacity="0.8" />
          </svg>
        </g>
        <g className="sv-m1">
          <svg x="-8" y="-8" width="16" height="16" viewBox="0 0 256 256">
            <path d={MALWARE_PATH} fill={R} fillOpacity="0.7" />
          </svg>
        </g>
        <g className="sv-m2">
          <svg x="-8" y="-8" width="16" height="16" viewBox="0 0 256 256">
            <path d={MALWARE_PATH} fill={R} fillOpacity="0.6" />
          </svg>
        </g>
        <g className="sv-m3">
          <svg x="-7" y="-7" width="14" height="14" viewBox="0 0 256 256">
            <path d={MALWARE_PATH} fill={R} fillOpacity="0.5" />
          </svg>
        </g>
      </g>
    </>
  )
}

export default function StdioVirusAnimation(): React.ReactNode {
  return (
    <div className="flex justify-center">
      <svg
        viewBox="0 0 186 140"
        style={{ width: '100%', maxWidth: 280, height: 'auto' }}
        xmlns="http://www.w3.org/2000/svg"
        role="presentation"
        aria-hidden="true"
      >
        <StdioVirusContent />
      </svg>
    </div>
  )
}
