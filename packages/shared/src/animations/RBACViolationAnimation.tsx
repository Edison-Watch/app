/**
 * RBAC violation animation.
 *
 * Visualises how AI agents can break Role-Based Access Control:
 *   1. A Google Docs document accessible to users A and B
 *   2. AI agents read the document on behalf of user A
 *   3. Agents forward the content to user C via Gmail
 *   4. C now has access to info they shouldn't - RBAC violated
 *
 * Flow: Document → AI Agents → Gmail
 *
 * 10s loop. Pure SVG + CSS. Respects `prefers-reduced-motion`.
 *
 * Requires CSS custom properties: --text-primary, --accent, --text-muted.
 */

import { useId } from 'react'
import { AGENT_REGISTRY, type AgentIconEntry } from '../agent-registry'

const R = '#d94040'
const WARN_Y = '#f59e0b'
const DRIVE_GREEN = '#00ac47'

const GDRIVE_SVG = '<path fill="#0066da" d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3L27.5 53H0c0 1.55.4 3.1 1.2 4.5z"/><path fill="#00ac47" d="M43.65 25 29.9 1.2c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44A9.06 9.06 0 0 0 0 53h27.5z"/><path fill="#ea4335" d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75L86.1 57.5c.8-1.4 1.2-2.95 1.2-4.5H59.798l5.852 11.5z"/><path fill="#00832d" d="M43.65 25 57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2z"/><path fill="#2684fc" d="M59.8 53H27.5L13.75 76.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z"/><path fill="#ffba00" d="m73.4 26.5-12.7-22c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25 59.8 53h27.45c0-1.55-.4-3.1-1.2-4.5z"/>'
const GDRIVE_SVG_VIEWBOX = '0 0 87.3 78'

const GMAIL_SVG = '<g fill="none" fill-rule="evenodd"><g fill-rule="nonzero"><path fill="#4285f4" d="M34.91 448.818h81.454V251L0 163.727V413.91c0 19.287 15.622 34.91 34.91 34.91z"/><path fill="#34a853" d="M395.636 448.818h81.455c19.287 0 34.909-15.622 34.909-34.909V163.727L395.636 251z"/><path fill="#fbbc04" d="M395.636 99.727V251L512 163.727v-46.545c0-43.142-49.25-67.782-83.782-41.891z"/></g><path fill="#ea4335" d="M116.364 251V99.727L256 204.455 395.636 99.727V251L256 355.727z"/><path fill="#c5221f" fill-rule="nonzero" d="M0 117.182v46.545L116.364 251V99.727L83.782 75.291C49.25 49.4 0 74.04 0 117.18z"/></g>'
const GMAIL_SVG_VIEWBOX = '0 49.4 512 399.42'

const PERSON_PATH =
  'M230.92,212c-15.23-26.33-38.7-45.21-66.09-54.16a72,72,0,1,0-73.66,0c-27.39,8.94-50.86,27.82-66.09,54.16a8,8,0,1,0,13.85,8c18.84-32.56,52.14-52,89.07-52s70.23,19.44,89.07,52a8,8,0,1,0,13.85-8ZM72,96a56,56,0,1,1,56,56A56.06,56.06,0,0,1,72,96Z'

const MCP_D1 =
  'M15.688 2.343a2.588 2.588 0 00-3.61 0l-9.626 9.44a.863.863 0 01-1.203 0 .823.823 0 010-1.18l9.626-9.44a4.313 4.313 0 016.016 0 4.116 4.116 0 011.204 3.54 4.3 4.3 0 013.609 1.18l.05.05a4.115 4.115 0 010 5.9l-8.706 8.537a.274.274 0 000 .393l1.788 1.754a.823.823 0 010 1.18.863.863 0 01-1.203 0l-1.788-1.753a1.92 1.92 0 010-2.754l8.706-8.538a2.47 2.47 0 000-3.54l-.05-.049a2.588 2.588 0 00-3.607-.003l-7.172 7.034-.002.002-.098.097a.863.863 0 01-1.204 0 .823.823 0 010-1.18l7.273-7.133a2.47 2.47 0 00-.003-3.537z'
const MCP_D2 =
  'M14.485 4.703a.823.823 0 000-1.18.863.863 0 00-1.204 0l-7.119 6.982a4.115 4.115 0 000 5.9 4.314 4.314 0 006.016 0l7.12-6.982a.823.823 0 000-1.18.863.863 0 00-1.204 0l-7.119 6.982a2.588 2.588 0 01-3.61 0 2.47 2.47 0 010-3.54l7.12-6.982z'

const AGENTS = [
  AGENT_REGISTRY['codex'],
  AGENT_REGISTRY['claude-desktop'],
  AGENT_REGISTRY['cursor'],
  AGENT_REGISTRY['copilot'],
]

const CSS = `
.rbac { color: var(--text-primary); }
.rbac .rbac-line { stroke-dashoffset: 0; animation: rbac-lf 2s linear infinite; }

.rbac .rbac-arrow1  { animation: rbac-a1 10s ease-in-out infinite; }
.rbac .rbac-pkt1    { animation: rbac-p1 10s ease-in-out infinite; }
.rbac .rbac-arrow2  { animation: rbac-a2 10s ease-in-out infinite; }
.rbac .rbac-pkt2    { animation: rbac-p2 10s ease-in-out infinite; }
.rbac .rbac-warn    { animation: rbac-warn 10s ease-in-out infinite; }
.rbac .rbac-label1  { animation: rbac-l1 10s ease-in-out infinite; }
.rbac .rbac-label2  { animation: rbac-l2 10s ease-in-out infinite; }
.rbac .rbac-flash   { animation: rbac-flash 10s ease-in-out infinite; }
.rbac .rbac-output  { animation: rbac-out 10s ease-in-out infinite; }
.rbac .rbac-aglow   { animation: rbac-aglow 10s ease-in-out infinite; }
.rbac .rbac-progress { transform-origin: 20px 198px; animation: rbac-prog 10s linear infinite; }

@keyframes rbac-lf { to { stroke-dashoffset: -12; } }

@keyframes rbac-a1 {
  0%,10%  { opacity: 0; }
  14%     { opacity: 1; }
  82%     { opacity: 1; }
  88%     { opacity: 0; }
  100%    { opacity: 0; }
}

@keyframes rbac-p1 {
  0%,12%  { transform: translate(96px, 36px); opacity: 0; }
  14%     { transform: translate(96px, 36px); opacity: .8; }
  24%     { transform: translate(200px, 64px); opacity: 1; }
  26%     { transform: translate(200px, 64px); opacity: 0; }
  100%    { transform: translate(200px, 64px); opacity: 0; }
}

@keyframes rbac-l1 {
  0%,10%  { opacity: 0; }
  14%     { opacity: 1; }
  82%     { opacity: 1; }
  88%     { opacity: 0; }
  100%    { opacity: 0; }
}

@keyframes rbac-aglow {
  0%,22%  { fill-opacity: 0; }
  26%     { fill-opacity: 0.08; }
  38%     { fill-opacity: 0.08; }
  42%     { fill-opacity: 0; }
  100%    { fill-opacity: 0; }
}

@keyframes rbac-a2 {
  0%,38%  { opacity: 0; }
  42%     { opacity: 1; }
  82%     { opacity: 1; }
  88%     { opacity: 0; }
  100%    { opacity: 0; }
}

@keyframes rbac-p2 {
  0%,40%  { transform: translate(306px, 88px); opacity: 0; }
  42%     { transform: translate(306px, 88px); opacity: .8; }
  52%     { transform: translate(408px, 98px); opacity: 1; }
  54%     { transform: translate(408px, 98px); opacity: 0; }
  100%    { transform: translate(408px, 98px); opacity: 0; }
}

@keyframes rbac-l2 {
  0%,38%  { opacity: 0; }
  42%     { opacity: 1; }
  82%     { opacity: 1; }
  88%     { opacity: 0; }
  100%    { opacity: 0; }
}

@keyframes rbac-warn {
  0%,52%  { opacity: 0; }
  56%     { opacity: 1; }
  82%     { opacity: 1; }
  88%     { opacity: 0; }
  100%    { opacity: 0; }
}

@keyframes rbac-flash {
  0%,50%  { fill-opacity: 0; }
  54%     { fill-opacity: 0.12; }
  58%     { fill-opacity: 0.04; }
  62%,100%{ fill-opacity: 0; }
}

@keyframes rbac-out {
  0%,48%  { opacity: 0; }
  52%     { opacity: 1; }
  82%     { opacity: 1; }
  88%     { opacity: 0; }
  100%    { opacity: 0; }
}

@keyframes rbac-prog {
  0%   { transform: scaleX(0); }
  100% { transform: scaleX(1); }
}

@media (prefers-reduced-motion: reduce) {
  .rbac .rbac-line, .rbac .rbac-pkt1, .rbac .rbac-pkt2,
  .rbac .rbac-aglow, .rbac .rbac-progress { animation: none; }
  .rbac .rbac-arrow1, .rbac .rbac-arrow2 { animation: none; opacity: 1; }
  .rbac .rbac-label1, .rbac .rbac-label2 { animation: none; opacity: 1; }
  .rbac .rbac-warn { animation: none; opacity: 1; }
  .rbac .rbac-flash { animation: none; fill-opacity: 0; }
  .rbac .rbac-output { animation: none; opacity: 1; }
  .rbac .rbac-pkt1, .rbac .rbac-pkt2 { opacity: 0; }
  .rbac .rbac-progress { animation: none; transform: scaleX(1); }
}
`

function AgentIcon({ agent, x, y, size = 28 }: {
  agent: AgentIconEntry; x: number; y: number; size?: number
}): React.ReactNode {
  const inner = size - 4
  return (
    <g>
      <rect x={x} y={y} width={size} height={size} rx={6} fill={agent.brandColor} />
      {agent.customSvg ? (
        <svg
          x={x + 2} y={y + 2} width={inner} height={inner}
          viewBox={agent.customViewBox || '0 0 24 24'}
          shapeRendering="crispEdges"
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

function McpIcon({ x, y, size, color, opacity = '0.65' }: {
  x: number; y: number; size: number; color: string; opacity?: string
}): React.ReactNode {
  return (
    <svg x={x} y={y} width={size} height={size} viewBox="0 0 24 24">
      <path d={MCP_D1} fill={color} fillOpacity={opacity} />
      <path d={MCP_D2} fill={color} fillOpacity={opacity} />
    </svg>
  )
}

export default function RBACViolationAnimation(): React.ReactNode {
  const id = useId()
  return (
    <div className="flex justify-center">
      <style>{CSS}</style>
      <svg
        className="rbac"
        viewBox="0 0 560 200"
        style={{ width: '100%', maxWidth: 560, height: 'auto' }}
        xmlns="http://www.w3.org/2000/svg"
        role="presentation"
        aria-hidden="true"
      >
        <defs>
          <marker id={`${id}-arr`} viewBox="0 0 10 10" refX="9" refY="5"
            markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0 1 L9 5 L0 9 Z" fill="var(--text-muted)" fillOpacity={0.5} />
          </marker>
          <marker id={`${id}-arrR`} viewBox="0 0 10 10" refX="9" refY="5"
            markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0 1 L9 5 L0 9 Z" fill={R} fillOpacity={0.5} />
          </marker>
        </defs>

        {/* ===== GOOGLE DRIVE (top-left) ===== */}
        <svg x="30" y="8" width="48" height="48" viewBox={GDRIVE_SVG_VIEWBOX}
          dangerouslySetInnerHTML={{ __html: GDRIVE_SVG }} />

        {/* MCP icon next to Drive */}
        <McpIcon x={84} y={18} size={16} color={DRIVE_GREEN} opacity="0.45" />

        {/* Users A and B */}
        <svg x="20" y="74" width="22" height="22" viewBox="0 0 256 256">
          <path d={PERSON_PATH} fill="var(--text-primary)" fillOpacity="0.55" />
        </svg>
        <text x="31" y="106" textAnchor="middle"
          fill="var(--text-primary)" fillOpacity="0.7" fontSize="9" fontWeight="bold"
          fontFamily="system-ui,sans-serif">A</text>

        <svg x="58" y="74" width="22" height="22" viewBox="0 0 256 256">
          <path d={PERSON_PATH} fill="var(--text-primary)" fillOpacity="0.55" />
        </svg>
        <text x="69" y="106" textAnchor="middle"
          fill="var(--text-primary)" fillOpacity="0.7" fontSize="9" fontWeight="bold"
          fontFamily="system-ui,sans-serif">B</text>

        <text x="50" y="122" textAnchor="middle"
          fill="var(--text-primary)" fillOpacity="0.5" fontSize="7.5"
          fontFamily="system-ui,sans-serif">
          {'Input: Users { A, B }'}
        </text>

        {/* ===== AI AGENTS (center) ===== */}
        <rect x="200" y="30" width="106" height="92" rx="6"
          fill="var(--text-primary)" fillOpacity="0.02"
          stroke="var(--text-muted)" strokeOpacity="0.2" strokeWidth="1"
          strokeDasharray="4 3" />
        <rect className="rbac-aglow" x="200" y="30" width="106" height="92" rx="6"
          fill="var(--accent)" fillOpacity="0" />

        {/* 2×2 agent grid */}
        <AgentIcon agent={AGENTS[0]} x={208} y={38} size={30} />
        <AgentIcon agent={AGENTS[1]} x={248} y={38} size={30} />
        <AgentIcon agent={AGENTS[2]} x={208} y={78} size={30} />
        <AgentIcon agent={AGENTS[3]} x={248} y={78} size={30} />

        <text x="253" y="138" textAnchor="middle"
          fill="var(--text-primary)" fillOpacity="0.5" fontSize="8" fontWeight="bold"
          fontFamily="system-ui,sans-serif">
          AI Agents
        </text>

        {/* ===== ARROW 1: Doc → Agents ===== */}
        <g className="rbac-arrow1">
          <line className="rbac-line" x1="96" y1="36" x2="200" y2="64"
            stroke="var(--text-muted)" strokeOpacity="0.45" strokeWidth="1.5"
            strokeDasharray="3 3" markerEnd={`url(#${id}-arr)`} />
        </g>

        {/* Label: "Read on behalf of A" */}
        <g className="rbac-label1">
          <text x="148" y="38" textAnchor="middle"
            fill="var(--text-primary)" fillOpacity="0.65" fontSize="8" fontWeight="600"
            fontFamily="system-ui,sans-serif">
            Read on behalf of A
          </text>
        </g>

        {/* Packet 1: Drive data */}
        <g className="rbac-pkt1">
          <circle r="5" fill={DRIVE_GREEN} fillOpacity="0.35" />
          <circle r="2.5" fill={DRIVE_GREEN} fillOpacity="0.7" />
        </g>

        {/* ===== GMAIL (bottom-right) ===== */}
        <McpIcon x={386} y={86} size={16} color="var(--text-muted)" opacity="0.4" />

        <svg x="410" y="78" width="48" height="42" viewBox={GMAIL_SVG_VIEWBOX}
          dangerouslySetInnerHTML={{ __html: GMAIL_SVG }} />

        {/* Red flash on Gmail area */}
        <rect className="rbac-flash" x="403" y="73" width="64" height="52" rx="5"
          fill={R} fillOpacity="0" />

        {/* Output users A and C */}
        <g className="rbac-output">
          <svg x="400" y="130" width="20" height="20" viewBox="0 0 256 256">
            <path d={PERSON_PATH} fill="var(--text-primary)" fillOpacity="0.55" />
          </svg>
          <text x="410" y="160" textAnchor="middle"
            fill="var(--text-primary)" fillOpacity="0.7" fontSize="9" fontWeight="bold"
            fontFamily="system-ui,sans-serif">A</text>

          <svg x="445" y="130" width="20" height="20" viewBox="0 0 256 256">
            <path d={PERSON_PATH} fill={R} fillOpacity="0.7" />
          </svg>
          <text x="455" y="160" textAnchor="middle"
            fill={R} fillOpacity="0.85" fontSize="9" fontWeight="bold"
            fontFamily="system-ui,sans-serif">C</text>
        </g>

        <g className="rbac-output">
          <text x="432" y="176" textAnchor="middle"
            fill="var(--text-primary)" fillOpacity="0.5" fontSize="7.5"
            fontFamily="system-ui,sans-serif">
            {'Output: Users { A, C }'}
          </text>
        </g>

        {/* ===== ARROW 2: Agents → Gmail (red = violation) ===== */}
        <g className="rbac-arrow2">
          <line className="rbac-line" x1="306" y1="88" x2="408" y2="98"
            stroke={R} strokeOpacity="0.4" strokeWidth="1.5"
            strokeDasharray="3 3" markerEnd={`url(#${id}-arrR)`} />
        </g>

        {/* Label: "Send to C" */}
        <g className="rbac-label2">
          <text x="356" y="78" textAnchor="middle"
            fill={R} fillOpacity="0.75" fontSize="8" fontWeight="600"
            fontFamily="system-ui,sans-serif">
            Send to C
          </text>
        </g>

        {/* Packet 2: envelope shape */}
        <g className="rbac-pkt2">
          <rect x="-8" y="-6" width="16" height="12" rx="2"
            fill={R} fillOpacity="0.25" stroke={R} strokeOpacity="0.5" strokeWidth="0.8" />
          <path d="M-8,-6 L0,2 L8,-6"
            fill="none" stroke={R} strokeOpacity="0.6" strokeWidth="0.8" strokeLinejoin="round" />
        </g>

        {/* ===== WARNING ===== */}
        <g className="rbac-warn">
          <text x="500" y="62" textAnchor="middle"
            fill={WARN_Y} fontSize="8.5" fontWeight="bold"
            fontFamily="system-ui,sans-serif">
            ⚠ Violates RBAC
          </text>
          <text x="500" y="74" textAnchor="middle"
            fill={R} fillOpacity="0.7" fontSize="7"
            fontFamily="system-ui,sans-serif">
            Now C can access the doc
          </text>
        </g>

        {/* ===== PROGRESS BAR ===== */}
        <rect x="20" y="198" width="520" height="1.5" rx="0.75"
          fill="var(--text-primary)" fillOpacity="0.1" />
        <rect className="rbac-progress" x="20" y="198" width="520" height="1.5" rx="0.75"
          fill="var(--text-primary)" fillOpacity="0.35" />
      </svg>
    </div>
  )
}
