/**
 * Agent bypass animation.
 *
 * Side-by-side comparison illustrating why traditional access control
 * fails for AI agents:
 *   - Left panel: a human user authenticates through an SSO/RBAC mesh
 *     wall and reaches the data store (green path through the wall).
 *   - Right panel: AI agents (ChatGPT, Claude, ...) skip the wall
 *     entirely and reach the same data via an unmonitored path
 *     (red arc going up and over the wall).
 *
 * 10s loop. Pure SVG + CSS. Respects `prefers-reduced-motion`.
 *
 * Requires CSS custom properties: --text-primary, --accent, --text-muted.
 */

import { useId } from 'react'
import { AGENT_REGISTRY } from '../agent-registry'
import { AgentIcon, ProgressBar, RED as R } from './_shared'

const GREEN = '#3ddc84'

const PERSON_PATH =
  'M230.92,212c-15.23-26.33-38.7-45.21-66.09-54.16a72,72,0,1,0-73.66,0c-27.39,8.94-50.86,27.82-66.09,54.16a8,8,0,1,0,13.85,8c18.84-32.56,52.14-52,89.07-52s70.23,19.44,89.07,52a8,8,0,1,0,13.85-8ZM72,96a56,56,0,1,1,56,56A56.06,56.06,0,0,1,72,96Z'

const AGENTS = [
  AGENT_REGISTRY['claude-code'],
  AGENT_REGISTRY['cursor'],
  AGENT_REGISTRY['codex'],
  AGENT_REGISTRY['copilot'],
]

/* ──────────────────────────────────────────────────────────────────────
 * Sub-components (panel-internal building blocks)
 * ────────────────────────────────────────────────────────────────────── */

/**
 * SSO/RBAC mesh wall: a thin slab with a 5×7 grid pattern. Used to
 * represent a traditional authn/authz boundary that blocks unapproved
 * traffic. `intact` controls whether the wall renders in the accent
 * (good) or muted (defeated) palette.
 */
function MeshWall({
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
function DataCylinder({
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

/* ──────────────────────────────────────────────────────────────────────
 * Animation CSS
 * ────────────────────────────────────────────────────────────────────── */

const CSS = `
.ab-anim { color: var(--text-primary); }

.ab-anim .ab-line { stroke-dashoffset: 0; animation: ab-lf 2s linear infinite; }

/* Two packets per 10s loop on each side */
.ab-anim .ab-pkt-good { animation: ab-good 10s ease-in-out infinite; }
.ab-anim .ab-pkt-bad  { animation: ab-bad  10s ease-in-out infinite; }

/* Cube glow pulses with packet arrivals */
.ab-anim .ab-glow-good { animation: ab-glow-g 10s ease-in-out infinite; }
.ab-anim .ab-glow-bad  { animation: ab-glow-b 10s ease-in-out infinite; }

/* Radar scan on the good-side wall when packet passes through */
.ab-anim .ab-radar-sweep {
  transform-origin: 185px 115px;
  animation: ab-radar 10s linear infinite;
}
.ab-anim .ab-radar-rings { animation: ab-radar-vis 10s ease-in-out infinite; }
.ab-anim .ab-radar-glow  { animation: ab-radar-glow 10s ease-in-out infinite; }
.ab-anim .ab-check       { animation: ab-check 10s ease-in-out infinite; }

/* Bad-side wall flickers red as the bypass succeeds */
.ab-anim .ab-wall-bad-flash { animation: ab-wall-flash 10s ease-in-out infinite; }

/* Warning label fade in with the second bypass */
.ab-anim .ab-warn { animation: ab-warn 10s ease-in-out infinite; }

.ab-anim .ab-progress { transform-origin: 20px 218px; animation: ab-prog 10s linear infinite; }

@keyframes ab-lf { to { stroke-dashoffset: -12; } }

/* GREEN packet: user → wall center (HOLD for scan) → exit wall → data
   Path waypoints (left panel):
     start  ( 95, 116)  user
     hold   (185, 116)  wall center – pauses here during radar scan
     exit   (220, 116)  wall right edge
     end    (282, 116)  data front layer
   Two passes: 4-44%, 54-94% */
@keyframes ab-good {
  0%,3%   { transform: translate(95px,116px);  opacity: 0; }
  5%      { transform: translate(95px,116px);  opacity: .9; }
  14%     { transform: translate(185px,116px); opacity: 1; }
  15%,25% { transform: translate(185px,116px); opacity: 1; }
  29%     { transform: translate(220px,116px); opacity: 1; }
  38%     { transform: translate(282px,116px); opacity: 1; }
  42%     { transform: translate(282px,116px); opacity: 0; }
  53%     { transform: translate(95px,116px);  opacity: 0; }
  55%     { transform: translate(95px,116px);  opacity: .9; }
  64%     { transform: translate(185px,116px); opacity: 1; }
  65%,75% { transform: translate(185px,116px); opacity: 1; }
  79%     { transform: translate(220px,116px); opacity: 1; }
  88%     { transform: translate(282px,116px); opacity: 1; }
  92%     { transform: translate(282px,116px); opacity: 0; }
  100%    { transform: translate(282px,116px); opacity: 0; }
}

/* RED packet: agent → arc up over wall → data
   Path waypoints (right panel):
     start  (475, 110)  agent top
     up     (498,  50)
     apex   (575,  32)  above wall
     down   (652,  50)
     end    (672, 110)  data
   Two passes: 4-44%, 54-94% */
@keyframes ab-bad {
  0%,3%   { transform: translate(475px,110px); opacity: 0; }
  5%      { transform: translate(475px,110px); opacity: .9; }
  14%     { transform: translate(498px,50px);  opacity: 1; }
  22%     { transform: translate(575px,32px);  opacity: 1; }
  32%     { transform: translate(652px,50px);  opacity: 1; }
  40%     { transform: translate(672px,110px); opacity: 1; }
  44%     { transform: translate(672px,110px); opacity: 0; }
  53%     { transform: translate(475px,110px); opacity: 0; }
  55%     { transform: translate(475px,110px); opacity: .9; }
  64%     { transform: translate(498px,50px);  opacity: 1; }
  72%     { transform: translate(575px,32px);  opacity: 1; }
  82%     { transform: translate(652px,50px);  opacity: 1; }
  90%     { transform: translate(672px,110px); opacity: 1; }
  94%     { transform: translate(672px,110px); opacity: 0; }
  100%    { transform: translate(672px,110px); opacity: 0; }
}

/* Radar sweep: two full rotations while packet is held at wall center (15-25%, 65-75%) */
@keyframes ab-radar {
  0%,13%  { transform: rotate(0deg); opacity: 0; }
  15%     { transform: rotate(0deg); opacity: 1; }
  25%     { transform: rotate(360deg); opacity: 1; }
  27%     { transform: rotate(360deg); opacity: 0; }
  63%     { transform: rotate(0deg); opacity: 0; }
  65%     { transform: rotate(0deg); opacity: 1; }
  75%     { transform: rotate(360deg); opacity: 1; }
  77%     { transform: rotate(360deg); opacity: 0; }
  100%    { transform: rotate(360deg); opacity: 0; }
}

@keyframes ab-radar-vis {
  0%,13%  { opacity: 0; }
  15%     { opacity: 0.6; }
  25%     { opacity: 0.6; }
  27%     { opacity: 0; }
  63%     { opacity: 0; }
  65%     { opacity: 0.6; }
  75%     { opacity: 0.6; }
  77%     { opacity: 0; }
  100%    { opacity: 0; }
}

@keyframes ab-radar-glow {
  0%,13%  { fill-opacity: 0; }
  15%     { fill-opacity: 0.08; }
  25%     { fill-opacity: 0.08; }
  27%     { fill-opacity: 0; }
  63%     { fill-opacity: 0; }
  65%     { fill-opacity: 0.08; }
  75%     { fill-opacity: 0.08; }
  77%     { fill-opacity: 0; }
  100%    { fill-opacity: 0; }
}

/* Scan-approved checkmark flash after radar completes */
@keyframes ab-check {
  0%,24%  { opacity: 0; transform: scale(0.5); }
  26%     { opacity: 1; transform: scale(1); }
  30%     { opacity: 0; transform: scale(1); }
  74%     { opacity: 0; transform: scale(0.5); }
  76%     { opacity: 1; transform: scale(1); }
  80%     { opacity: 0; transform: scale(1); }
  100%    { opacity: 0; transform: scale(1); }
}

@keyframes ab-glow-g {
  0%,36%  { fill-opacity: 0; }
  40%     { fill-opacity: 0.18; }
  46%     { fill-opacity: 0.05; }
  86%     { fill-opacity: 0.05; }
  90%     { fill-opacity: 0.22; }
  96%,100%{ fill-opacity: 0; }
}

@keyframes ab-glow-b {
  0%,38%  { fill-opacity: 0; }
  42%     { fill-opacity: 0.22; }
  48%     { fill-opacity: 0.05; }
  88%     { fill-opacity: 0.05; }
  92%     { fill-opacity: 0.28; }
  98%,100%{ fill-opacity: 0; }
}

@keyframes ab-wall-flash {
  0%,40%   { opacity: 0; }
  44%      { opacity: 0.7; }
  56%      { opacity: 0.15; }
  90%      { opacity: 0.15; }
  94%      { opacity: 0.7; }
  100%     { opacity: 0; }
}

@keyframes ab-warn {
  0%,46%   { opacity: 0; }
  52%,92%  { opacity: 1; }
  96%,100% { opacity: 0; }
}

@keyframes ab-prog {
  0%   { transform: scaleX(0); }
  100% { transform: scaleX(1); }
}

@media (prefers-reduced-motion: reduce) {
  .ab-anim .ab-line,
  .ab-anim .ab-pkt-good, .ab-anim .ab-pkt-bad,
  .ab-anim .ab-glow-good, .ab-anim .ab-glow-bad,
  .ab-anim .ab-wall-bad-flash, .ab-anim .ab-warn,
  .ab-anim .ab-radar-sweep, .ab-anim .ab-radar-rings,
  .ab-anim .ab-radar-glow, .ab-anim .ab-check,
  .ab-anim .ab-progress { animation: none; }
  .ab-anim .ab-radar-sweep, .ab-anim .ab-radar-rings { opacity: 0; }
  .ab-anim .ab-pkt-good, .ab-anim .ab-pkt-bad { opacity: 0; }
  .ab-anim .ab-glow-good, .ab-anim .ab-glow-bad { fill-opacity: 0.1; }
  .ab-anim .ab-wall-bad-flash { opacity: 0.15; }
  .ab-anim .ab-warn { opacity: 1; }
  .ab-anim .ab-progress { transform: scaleX(1); }
}
`

/* ──────────────────────────────────────────────────────────────────────
 * Component
 * ────────────────────────────────────────────────────────────────────── */

export default function AgentBypassAnimation(): React.ReactNode {
  const id = useId()
  return (
    <div className="flex justify-center">
      <style>{CSS}</style>
      <svg
        className="ab-anim"
        viewBox="0 0 720 230"
        style={{ width: '100%', maxWidth: 800, height: 'auto' }}
        xmlns="http://www.w3.org/2000/svg"
        role="presentation"
        aria-hidden="true"
      >
        <defs>
          <marker id={`${id}-arrG`} viewBox="0 0 10 10" refX="9" refY="5"
            markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0 1 L9 5 L0 9 Z" fill={GREEN} fillOpacity={0.7} />
          </marker>
          <marker id={`${id}-arrR`} viewBox="0 0 10 10" refX="9" refY="5"
            markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0 1 L9 5 L0 9 Z" fill={R} fillOpacity={0.8} />
          </marker>
        </defs>

        {/* ════════════════════════════════════════════════════════════
             LEFT PANEL - Human / SSO / Data (allowed)
            ════════════════════════════════════════════════════════════ */}
        <rect x="6" y="6" width="328" height="208" rx="14"
          fill="var(--text-primary)" fillOpacity="0.015"
          stroke="var(--text-muted)" strokeOpacity="0.18" strokeWidth="1" />

        {/* "Human" label */}
        <text x="62" y="34" textAnchor="middle"
          fill="var(--text-primary)" fillOpacity="0.85"
          fontSize="11" fontWeight="600"
          fontFamily="system-ui,sans-serif">
          Human
        </text>

        {/* User icon */}
        <svg x="40" y="78" width="44" height="44" viewBox="0 0 256 256">
          <path d={PERSON_PATH} fill="var(--text-primary)" fillOpacity="0.7" />
        </svg>
        <text x="62" y="146" textAnchor="middle"
          fill="var(--text-primary)" fillOpacity="0.55"
          fontSize="10" fontWeight="500"
          fontFamily="system-ui,sans-serif">
          User
        </text>

        {/* Mesh wall (SSO/RBAC) */}
        <MeshWall x={150} y={50} width={70} height={130}
          label="SSO/RBAC" color="var(--accent)" />

        {/* Radar scan overlay on the wall */}
        <defs>
          <clipPath id={`${id}-wallClip`}>
            <rect x="150" y="50" width="70" height="130" rx="2" />
          </clipPath>
        </defs>
        <g clipPath={`url(#${id}-wallClip)`}>
          {/* Green glow behind the scan */}
          <rect className="ab-radar-glow"
            x="150" y="50" width="70" height="130"
            fill={GREEN} fillOpacity="0" />
          {/* Concentric rings */}
          <g className="ab-radar-rings">
            <circle cx="185" cy="115" r="16" fill="none"
              stroke={GREEN} strokeOpacity="0.5" strokeWidth="0.8" />
            <circle cx="185" cy="115" r="32" fill="none"
              stroke={GREEN} strokeOpacity="0.35" strokeWidth="0.8" />
            <circle cx="185" cy="115" r="48" fill="none"
              stroke={GREEN} strokeOpacity="0.2" strokeWidth="0.8" />
            <circle cx="185" cy="115" r="64" fill="none"
              stroke={GREEN} strokeOpacity="0.12" strokeWidth="0.8" />
          </g>
          {/* Sweep arm + trail */}
          <g className="ab-radar-sweep">
            {/* Pie-wedge trail (30° behind the arm) */}
            <path
              d={`M185,115 L185,45 A70,70 0 0,0 ${185 - 70 * Math.sin(Math.PI / 6)},${115 - 70 * Math.cos(Math.PI / 6)} Z`}
              fill={GREEN} fillOpacity="0.12" />
            {/* Sweep arm line */}
            <line x1="185" y1="115" x2="185" y2="45"
              stroke={GREEN} strokeOpacity="0.8" strokeWidth="1.5" />
          </g>
        </g>

        {/* Scan-approved checkmark (flashes after radar completes) */}
        <g className="ab-check" style={{ transformOrigin: '185px 96px' }}>
          <circle cx="185" cy="96" r="8" fill={GREEN} fillOpacity="0.2"
            stroke={GREEN} strokeOpacity="0.7" strokeWidth="1" />
          <path d="M180,96 L184,100 L191,92"
            fill="none" stroke={GREEN} strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round" />
        </g>

        {/* Allowed-flow arrow (under packets) */}
        <line className="ab-line" x1="92" y1="116" x2="262" y2="116"
          stroke={GREEN} strokeOpacity="0.45" strokeWidth="1.5"
          strokeDasharray="3 3" markerEnd={`url(#${id}-arrG)`} />

        {/* "Data" label */}
        <text x="290" y="42" textAnchor="middle"
          fill="var(--text-primary)" fillOpacity="0.85"
          fontSize="11" fontWeight="600"
          fontFamily="system-ui,sans-serif">
          Data
        </text>

        {/* Data cube (left) */}
        <DataCylinder cx={290} cy={120} size={42} />
        {/* Glow flash on packet arrival */}
        <rect className="ab-glow-good"
          x="262" y="62" width="56" height="116" rx="6"
          fill={GREEN} fillOpacity="0" />

        {/* Green packet */}
        <g className="ab-pkt-good">
          <circle r="6" fill={GREEN} fillOpacity="0.25" />
          <circle r="3" fill={GREEN} fillOpacity="0.85" />
        </g>

        {/* ════════════════════════════════════════════════════════════
             RIGHT PANEL - Agents / Bypass / Data (denied path)
            ════════════════════════════════════════════════════════════ */}
        <rect x="386" y="6" width="328" height="208" rx="14"
          fill="var(--text-primary)" fillOpacity="0.015"
          stroke="var(--text-muted)" strokeOpacity="0.18" strokeWidth="1" />

        {/* "Agent Bypass" label (warning red) */}
        <text x="450" y="28" textAnchor="middle"
          fill={R} fillOpacity="0.9"
          fontSize="11" fontWeight="700"
          fontFamily="system-ui,sans-serif">
          Agent Bypass
        </text>

        {/* Agents box: 2x2 grid */}
        <rect x="412" y="50" width="78" height="78" rx="8"
          fill="var(--text-primary)" fillOpacity="0.03"
          stroke={R} strokeOpacity="0.35" strokeWidth="1"
          strokeDasharray="4 3" />
        <AgentIcon agent={AGENTS[0]} x={420} y={58} size={28} />
        <AgentIcon agent={AGENTS[1]} x={454} y={58} size={28} />
        <AgentIcon agent={AGENTS[2]} x={420} y={92} size={28} />
        <AgentIcon agent={AGENTS[3]} x={454} y={92} size={28} />

        <text x="451" y="146" textAnchor="middle"
          fill="var(--text-primary)" fillOpacity="0.55"
          fontSize="10" fontWeight="500"
          fontFamily="system-ui,sans-serif">
          Agents
        </text>

        {/* Mesh wall (still present, but bypassed) */}
        <MeshWall x={540} y={50} width={70} height={130}
          color="var(--text-muted)" />
        {/* Red flash on the wall when bypass succeeds */}
        <rect className="ab-wall-bad-flash"
          x="540" y="50" width="70" height="130" rx="2"
          fill={R} fillOpacity="0.18" />

        {/* "Data" label */}
        <text x="675" y="42" textAnchor="middle"
          fill="var(--text-primary)" fillOpacity="0.85"
          fontSize="11" fontWeight="600"
          fontFamily="system-ui,sans-serif">
          Data
        </text>

        {/* Data cube (right) */}
        <DataCylinder cx={675} cy={120} size={42} />
        <rect className="ab-glow-bad"
          x="647" y="62" width="56" height="116" rx="6"
          fill={R} fillOpacity="0" />

        {/* Bypass arc (red, going OVER the wall) */}
        <path className="ab-line"
          d="M 475 96 C 478 28, 670 28, 672 96"
          fill="none"
          stroke={R} strokeOpacity="0.55" strokeWidth="1.5"
          strokeDasharray="3 3" markerEnd={`url(#${id}-arrR)`} />

        {/* Red packet (rides arc via translate waypoints) */}
        <g className="ab-pkt-bad">
          <circle r="6" fill={R} fillOpacity="0.28" />
          <circle r="3" fill={R} fillOpacity="0.9" />
        </g>

        {/* Warning text near the apex */}
        <g className="ab-warn">
          <text x="540" y="200" textAnchor="middle"
            fill={R} fillOpacity="0.85"
            fontSize="9" fontWeight="600"
            fontFamily="system-ui,sans-serif">
            ⚠ Agents are overprivileged by default
          </text>
        </g>

        {/* ════════════════════════════════════════════════════════════
             PROGRESS BAR
            ════════════════════════════════════════════════════════════ */}
        <ProgressBar y={222} width={680} className="ab-progress" />
      </svg>
    </div>
  )
}
