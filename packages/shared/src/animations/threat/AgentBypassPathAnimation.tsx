/**
 * Agent bypass path animation (single panel).
 *
 * AI agents (Claude Code, Cursor, …) skip the SSO/RBAC mesh wall and
 * reach the data store via an unmonitored over-the-wall arc. The wall
 * flickers red as the bypass succeeds and a warning label fades in.
 *
 * 10s loop. Pure SVG + CSS. Respects `prefers-reduced-motion`.
 *
 * Requires CSS custom properties: --text-primary, --accent, --text-muted.
 *
 * This is the "bypass path" half of {@link AgentBypassAnimation}; it
 * can be rendered standalone (e.g. for mobile/responsive layouts) or
 * paired with {@link HumanAccessAnimation}.
 */

import { useId } from 'react'
import { AGENT_REGISTRY } from '../../agent-registry'
import { AgentIcon, ProgressBar, RED as R } from '../_shared'
import { DataCylinder, MeshWall } from './_agentBypassParts'

const AGENTS = [
  AGENT_REGISTRY['claude-code'],
  AGENT_REGISTRY['cursor'],
  AGENT_REGISTRY['codex'],
  AGENT_REGISTRY['copilot'],
]

const CSS = `
.abp-anim { color: var(--text-primary); }

.abp-anim .abp-line { stroke-dashoffset: 0; animation: abp-lf 2s linear infinite; }

.abp-anim .abp-pkt-bad  { animation: abp-bad  10s ease-in-out infinite; }
.abp-anim .abp-glow-bad { animation: abp-glow-b 10s ease-in-out infinite; }

.abp-anim .abp-wall-bad-flash { animation: abp-wall-flash 10s ease-in-out infinite; }
.abp-anim .abp-warn { animation: abp-warn 10s ease-in-out infinite; }

.abp-anim .abp-progress { transform-origin: 20px 218px; animation: abp-prog 10s linear infinite; }

@keyframes abp-lf { to { stroke-dashoffset: -12; } }

/* RED packet: agent → arc up over wall → data
   Waypoints (normalized to 0-340 viewBox):
     start ( 89, 110), up (112, 50), apex (189, 32),
     down  (266,  50), end (286, 110) */
@keyframes abp-bad {
  0%,3%   { transform: translate(89px,110px);  opacity: 0; }
  5%      { transform: translate(89px,110px);  opacity: .9; }
  14%     { transform: translate(112px,50px);  opacity: 1; }
  22%     { transform: translate(189px,32px);  opacity: 1; }
  32%     { transform: translate(266px,50px);  opacity: 1; }
  40%     { transform: translate(286px,110px); opacity: 1; }
  44%     { transform: translate(286px,110px); opacity: 0; }
  53%     { transform: translate(89px,110px);  opacity: 0; }
  55%     { transform: translate(89px,110px);  opacity: .9; }
  64%     { transform: translate(112px,50px);  opacity: 1; }
  72%     { transform: translate(189px,32px);  opacity: 1; }
  82%     { transform: translate(266px,50px);  opacity: 1; }
  90%     { transform: translate(286px,110px); opacity: 1; }
  94%     { transform: translate(286px,110px); opacity: 0; }
  100%    { transform: translate(286px,110px); opacity: 0; }
}

@keyframes abp-glow-b {
  0%,38%  { fill-opacity: 0; }
  42%     { fill-opacity: 0.22; }
  48%     { fill-opacity: 0.05; }
  88%     { fill-opacity: 0.05; }
  92%     { fill-opacity: 0.28; }
  98%,100%{ fill-opacity: 0; }
}

@keyframes abp-wall-flash {
  0%,40%   { opacity: 0; }
  44%      { opacity: 0.7; }
  56%      { opacity: 0.15; }
  90%      { opacity: 0.15; }
  94%      { opacity: 0.7; }
  100%     { opacity: 0; }
}

@keyframes abp-warn {
  0%,46%   { opacity: 0; }
  52%,92%  { opacity: 1; }
  96%,100% { opacity: 0; }
}

@keyframes abp-prog {
  0%   { transform: scaleX(0); }
  100% { transform: scaleX(1); }
}

@media (prefers-reduced-motion: reduce) {
  .abp-anim .abp-line,
  .abp-anim .abp-pkt-bad, .abp-anim .abp-glow-bad,
  .abp-anim .abp-wall-bad-flash, .abp-anim .abp-warn,
  .abp-anim .abp-progress { animation: none; }
  .abp-anim .abp-pkt-bad { opacity: 0; }
  .abp-anim .abp-glow-bad { fill-opacity: 0.1; }
  .abp-anim .abp-wall-bad-flash { opacity: 0.15; }
  .abp-anim .abp-warn { opacity: 1; }
  .abp-anim .abp-progress { transform: scaleX(1); }
}
`

export default function AgentBypassPathAnimation(): React.ReactNode {
  const id = useId()
  return (
    <div className="flex justify-center">
      <style>{CSS}</style>
      <svg
        className="abp-anim"
        viewBox="0 0 340 230"
        style={{ width: '100%', maxWidth: 400, height: 'auto' }}
        xmlns="http://www.w3.org/2000/svg"
        role="presentation"
        aria-hidden="true"
      >
        <defs>
          <marker id={`${id}-arrR`} viewBox="0 0 10 10" refX="9" refY="5"
            markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0 1 L9 5 L0 9 Z" fill={R} fillOpacity={0.8} />
          </marker>
        </defs>

        {/* Panel frame */}
        <rect x="6" y="6" width="328" height="208" rx="14"
          fill="var(--text-primary)" fillOpacity="0.015"
          stroke="var(--text-muted)" strokeOpacity="0.18" strokeWidth="1" />

        {/* "Agent Bypass" label */}
        <text x="64" y="28" textAnchor="middle"
          fill={R} fillOpacity="0.9"
          fontSize="11" fontWeight="700"
          fontFamily="system-ui,sans-serif">
          Agent Bypass
        </text>

        {/* Agents box: 2x2 grid */}
        <rect x="26" y="50" width="78" height="78" rx="8"
          fill="var(--text-primary)" fillOpacity="0.03"
          stroke={R} strokeOpacity="0.35" strokeWidth="1"
          strokeDasharray="4 3" />
        <AgentIcon agent={AGENTS[0]} x={34} y={58} size={28} />
        <AgentIcon agent={AGENTS[1]} x={68} y={58} size={28} />
        <AgentIcon agent={AGENTS[2]} x={34} y={92} size={28} />
        <AgentIcon agent={AGENTS[3]} x={68} y={92} size={28} />

        <text x="65" y="146" textAnchor="middle"
          fill="var(--text-primary)" fillOpacity="0.55"
          fontSize="10" fontWeight="500"
          fontFamily="system-ui,sans-serif">
          Agents
        </text>

        {/* Mesh wall (still present, but bypassed) */}
        <MeshWall x={154} y={50} width={70} height={130}
          color="var(--text-muted)" />
        {/* Red flash on the wall when bypass succeeds */}
        <rect className="abp-wall-bad-flash"
          x="154" y="50" width="70" height="130" rx="2"
          fill={R} fillOpacity="0.18" />

        {/* "Data" label */}
        <text x="289" y="42" textAnchor="middle"
          fill="var(--text-primary)" fillOpacity="0.85"
          fontSize="11" fontWeight="600"
          fontFamily="system-ui,sans-serif">
          Data
        </text>

        {/* Data cube */}
        <DataCylinder cx={289} cy={120} size={42} />
        <rect className="abp-glow-bad"
          x="261" y="62" width="56" height="116" rx="6"
          fill={R} fillOpacity="0" />

        {/* Bypass arc (red, going OVER the wall) */}
        <path className="abp-line"
          d="M 89 96 C 92 28, 284 28, 286 96"
          fill="none"
          stroke={R} strokeOpacity="0.55" strokeWidth="1.5"
          strokeDasharray="3 3" markerEnd={`url(#${id}-arrR)`} />

        {/* Red packet (rides arc via translate waypoints) */}
        <g className="abp-pkt-bad">
          <circle r="6" fill={R} fillOpacity="0.28" />
          <circle r="3" fill={R} fillOpacity="0.9" />
        </g>

        {/* Warning text near the apex */}
        <g className="abp-warn">
          <text x="154" y="200" textAnchor="middle"
            fill={R} fillOpacity="0.85"
            fontSize="9" fontWeight="600"
            fontFamily="system-ui,sans-serif">
            ⚠ Agents are overprivileged by default
          </text>
        </g>

        <ProgressBar y={222} width={300} className="abp-progress" />
      </svg>
    </div>
  )
}
