/**
 * Human SSO/RBAC access animation (single panel).
 *
 * A human user authenticates through an SSO/RBAC mesh wall and reaches
 * the data store. The wall scans the request with a radar sweep, then
 * a green checkmark flashes and the packet is allowed through.
 *
 * 10s loop. Pure SVG + CSS. Respects `prefers-reduced-motion`.
 *
 * Requires CSS custom properties: --text-primary, --accent, --text-muted.
 *
 * This is the "good path" half of {@link AgentBypassAnimation}; it can
 * be rendered standalone (e.g. for mobile/responsive layouts) or
 * paired with {@link AgentBypassPathAnimation}.
 */

import { useId } from 'react'
import { ProgressBar } from '../_shared'
import { DataCylinder, GREEN, MeshWall, PERSON_PATH } from './_agentBypassParts'

const CSS = `
.hac-anim { color: var(--text-primary); }

.hac-anim .hac-line { stroke-dashoffset: 0; animation: hac-lf 2s linear infinite; }

.hac-anim .hac-pkt-good  { animation: hac-good   10s ease-in-out infinite; }
.hac-anim .hac-glow-good { animation: hac-glow-g 10s ease-in-out infinite; }

.hac-anim .hac-radar-sweep {
  transform-origin: 185px 115px;
  animation: hac-radar 10s linear infinite;
}
.hac-anim .hac-radar-rings { animation: hac-radar-vis 10s ease-in-out infinite; }
.hac-anim .hac-radar-glow  { animation: hac-radar-glow 10s ease-in-out infinite; }
.hac-anim .hac-check       { animation: hac-check 10s ease-in-out infinite; }

.hac-anim .hac-progress { transform-origin: 20px 218px; animation: hac-prog 10s linear infinite; }

@keyframes hac-lf { to { stroke-dashoffset: -12; } }

/* GREEN packet: user → wall center (HOLD for scan) → exit wall → data
   Waypoints: start (95,116), hold (185,116), exit (220,116), end (282,116) */
@keyframes hac-good {
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

@keyframes hac-radar {
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

@keyframes hac-radar-vis {
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

@keyframes hac-radar-glow {
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

@keyframes hac-check {
  0%,24%  { opacity: 0; transform: scale(0.5); }
  26%     { opacity: 1; transform: scale(1); }
  30%     { opacity: 0; transform: scale(1); }
  74%     { opacity: 0; transform: scale(0.5); }
  76%     { opacity: 1; transform: scale(1); }
  80%     { opacity: 0; transform: scale(1); }
  100%    { opacity: 0; transform: scale(1); }
}

@keyframes hac-glow-g {
  0%,36%  { fill-opacity: 0; }
  40%     { fill-opacity: 0.18; }
  46%     { fill-opacity: 0.05; }
  86%     { fill-opacity: 0.05; }
  90%     { fill-opacity: 0.22; }
  96%,100%{ fill-opacity: 0; }
}

@keyframes hac-prog {
  0%   { transform: scaleX(0); }
  100% { transform: scaleX(1); }
}

@media (prefers-reduced-motion: reduce) {
  .hac-anim .hac-line,
  .hac-anim .hac-pkt-good, .hac-anim .hac-glow-good,
  .hac-anim .hac-radar-sweep, .hac-anim .hac-radar-rings,
  .hac-anim .hac-radar-glow, .hac-anim .hac-check,
  .hac-anim .hac-progress { animation: none; }
  .hac-anim .hac-radar-sweep, .hac-anim .hac-radar-rings { opacity: 0; }
  .hac-anim .hac-pkt-good { opacity: 0; }
  .hac-anim .hac-glow-good { fill-opacity: 0.1; }
  .hac-anim .hac-progress { transform: scaleX(1); }
}
`

export default function HumanAccessAnimation(): React.ReactNode {
  const id = useId()
  return (
    <div className="flex justify-center">
      <style>{CSS}</style>
      <svg
        className="hac-anim"
        viewBox="0 0 340 230"
        style={{ width: '100%', maxWidth: 400, height: 'auto' }}
        xmlns="http://www.w3.org/2000/svg"
        role="presentation"
        aria-hidden="true"
      >
        <defs>
          <marker id={`${id}-arrG`} viewBox="0 0 10 10" refX="9" refY="5"
            markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0 1 L9 5 L0 9 Z" fill={GREEN} fillOpacity={0.7} />
          </marker>
          <clipPath id={`${id}-wallClip`}>
            <rect x="150" y="50" width="70" height="130" rx="2" />
          </clipPath>
        </defs>

        {/* Panel frame */}
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

        {/* Radar scan overlay clipped to the wall */}
        <g clipPath={`url(#${id}-wallClip)`}>
          <rect className="hac-radar-glow"
            x="150" y="50" width="70" height="130"
            fill={GREEN} fillOpacity="0" />
          <g className="hac-radar-rings">
            <circle cx="185" cy="115" r="16" fill="none"
              stroke={GREEN} strokeOpacity="0.5" strokeWidth="0.8" />
            <circle cx="185" cy="115" r="32" fill="none"
              stroke={GREEN} strokeOpacity="0.35" strokeWidth="0.8" />
            <circle cx="185" cy="115" r="48" fill="none"
              stroke={GREEN} strokeOpacity="0.2" strokeWidth="0.8" />
            <circle cx="185" cy="115" r="64" fill="none"
              stroke={GREEN} strokeOpacity="0.12" strokeWidth="0.8" />
          </g>
          <g className="hac-radar-sweep">
            <path
              d={`M185,115 L185,45 A70,70 0 0,0 ${185 - 70 * Math.sin(Math.PI / 6)},${115 - 70 * Math.cos(Math.PI / 6)} Z`}
              fill={GREEN} fillOpacity="0.12" />
            <line x1="185" y1="115" x2="185" y2="45"
              stroke={GREEN} strokeOpacity="0.8" strokeWidth="1.5" />
          </g>
        </g>

        {/* Scan-approved checkmark */}
        <g className="hac-check" style={{ transformOrigin: '185px 96px' }}>
          <circle cx="185" cy="96" r="8" fill={GREEN} fillOpacity="0.2"
            stroke={GREEN} strokeOpacity="0.7" strokeWidth="1" />
          <path d="M180,96 L184,100 L191,92"
            fill="none" stroke={GREEN} strokeWidth="1.8"
            strokeLinecap="round" strokeLinejoin="round" />
        </g>

        {/* Allowed-flow arrow (under packets) */}
        <line className="hac-line" x1="92" y1="116" x2="262" y2="116"
          stroke={GREEN} strokeOpacity="0.45" strokeWidth="1.5"
          strokeDasharray="3 3" markerEnd={`url(#${id}-arrG)`} />

        {/* "Data" label */}
        <text x="290" y="42" textAnchor="middle"
          fill="var(--text-primary)" fillOpacity="0.85"
          fontSize="11" fontWeight="600"
          fontFamily="system-ui,sans-serif">
          Data
        </text>

        {/* Data cube */}
        <DataCylinder cx={290} cy={120} size={42} />
        {/* Glow flash on packet arrival */}
        <rect className="hac-glow-good"
          x="262" y="62" width="56" height="116" rx="6"
          fill={GREEN} fillOpacity="0" />

        {/* Green packet (rides waypoints via translate) */}
        <g className="hac-pkt-good">
          <circle r="6" fill={GREEN} fillOpacity="0.25" />
          <circle r="3" fill={GREEN} fillOpacity="0.85" />
        </g>

        <ProgressBar y={222} width={300} className="hac-progress" />
      </svg>
    </div>
  )
}
