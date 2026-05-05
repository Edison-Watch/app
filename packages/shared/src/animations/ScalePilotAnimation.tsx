/**
 * Scale-Pilot Animation - business-value docs animation.
 *
 * Phase 1 - "Stuck pilot": A single Engineering team experiments with AI;
 *           the rest of the org (Sales, Finance, Legal, HR) is dark. The
 *           admin has no visibility.
 * Transition: Edison Watch fades in as a unified control plane.
 * Phase 2 - "Org-wide rollout": All departments activate together, routing
 *           AI traffic through Edison to enterprise tools. The admin gains
 *           full visibility with policy verdicts (accept/deny) at the gateway.
 *
 * 14s loop. Pure SVG + CSS. Respects `prefers-reduced-motion`.
 *
 * Requires CSS custom properties: --text-primary, --accent, --text-muted.
 */
import { useId } from 'react'
import { AGENT_REGISTRY } from '../agent-registry/index'
import {
  ADMIN_PATH, AgentIcon, DANGER, EdisonLogo, EYE_PATH, EYE_SLASH_PATH,
  McpIcon, McpPacket, ORANGE as O, ProgressBar, SHIELD_CHECK_PATH,
} from './_shared'

const CURSOR = AGENT_REGISTRY['cursor']
const CLAUDE_DESKTOP = AGENT_REGISTRY['claude-desktop']
const M365_COPILOT = AGENT_REGISTRY['m365-copilot']
const CLAUDE_COWORK = AGENT_REGISTRY['claude-cowork']
const CHATGPT = AGENT_REGISTRY['chatgpt']

/* ── Brand SVGs for the enterprise tools on the right ── */
const SLACK_SVG = '<g clip-rule="evenodd" fill-rule="evenodd"><path d="m897.4 0c-135.3.1-244.8 109.9-244.7 245.2-.1 135.3 109.5 245.1 244.8 245.2h244.8v-245.1c.1-135.3-109.5-245.1-244.9-245.3.1 0 .1 0 0 0m0 654h-652.6c-135.3.1-244.9 109.9-244.8 245.2-.2 135.3 109.4 245.1 244.7 245.3h652.7c135.3-.1 244.9-109.9 244.8-245.2.1-135.4-109.5-245.2-244.8-245.3z" fill="#36c5f0"/><path d="m2447.6 899.2c.1-135.3-109.5-245.1-244.8-245.2-135.3.1-244.9 109.9-244.8 245.2v245.3h244.8c135.3-.1 244.9-109.9 244.8-245.3zm-652.7 0v-654c.1-135.2-109.4-245-244.7-245.2-135.3.1-244.9 109.9-244.8 245.2v654c-.2 135.3 109.4 245.1 244.7 245.3 135.3-.1 244.9-109.9 244.8-245.3z" fill="#2eb67d"/><path d="m1550.1 2452.5c135.3-.1 244.9-109.9 244.8-245.2.1-135.3-109.5-245.1-244.8-245.2h-244.8v245.2c-.1 135.2 109.5 245 244.8 245.2zm0-654.1h652.7c135.3-.1 244.9-109.9 244.8-245.2.2-135.3-109.4-245.1-244.7-245.3h-652.7c-135.3.1-244.9 109.9-244.8 245.2-.1 135.4 109.4 245.2 244.7 245.3z" fill="#ecb22e"/><path d="m0 1553.2c-.1 135.3 109.5 245.1 244.8 245.2 135.3-.1 244.9-109.9 244.8-245.2v-245.2h-244.8c-135.3.1-244.9 109.9-244.8 245.2zm652.7 0v654c-.2 135.3 109.4 245.1 244.7 245.3 135.3-.1 244.9-109.9 244.8-245.2v-653.9c.2-135.3-109.4-245.1-244.7-245.3-135.4 0-244.9 109.8-244.8 245.1 0 0 0 .1 0 0" fill="#e01e5a"/></g>'
const GITHUB_SVG = '<path fill-rule="evenodd" clip-rule="evenodd" d="M8 0C3.58 0 0 3.58 0 8C0 11.54 2.29 14.53 5.47 15.59C5.87 15.66 6.02 15.42 6.02 15.21C6.02 15.02 6.01 14.39 6.01 13.72C4 14.09 3.48 13.23 3.32 12.78C3.23 12.55 2.84 11.84 2.5 11.65C2.22 11.5 1.82 11.13 2.49 11.12C3.12 11.11 3.57 11.7 3.72 11.94C4.44 13.15 5.59 12.81 6.05 12.6C6.12 12.08 6.33 11.73 6.56 11.53C4.78 11.33 2.92 10.64 2.92 7.58C2.92 6.71 3.23 5.99 3.74 5.43C3.66 5.23 3.38 4.41 3.82 3.31C3.82 3.31 4.49 3.1 6.02 4.13C6.66 3.95 7.34 3.86 8.02 3.86C8.7 3.86 9.38 3.95 10.02 4.13C11.55 3.09 12.22 3.31 12.22 3.31C12.66 4.41 12.38 5.23 12.3 5.43C12.81 5.99 13.12 6.7 13.12 7.58C13.12 10.65 11.25 11.33 9.47 11.53C9.76 11.78 10.01 12.26 10.01 13.01C10.01 14.08 10 14.94 10 15.21C10 15.42 10.15 15.67 10.55 15.59C13.71 14.53 16 11.53 16 8C16 3.58 12.42 0 8 0Z" transform="scale(64)" fill="var(--text-primary)"/>'
function onedriveSvg(p: string) {
  return `<defs><radialGradient id="${p}-od_a" cx="-446.23" cy="850.24" r="6.99" gradientTransform="matrix(28.88 32.01 53.7 -48.4 -32750.77 55564.7)" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#4894fe"/><stop offset=".7" stop-color="#0934b3"/></radialGradient><radialGradient id="${p}-od_b" cx="-463.71" cy="855.09" r="6.99" gradientTransform="matrix(-126.94 135.46 101.24 94.78 -144561.83 -18444.24)" gradientUnits="userSpaceOnUse"><stop offset=".17" stop-color="#23c0fe"/><stop offset=".53" stop-color="#1c91ff"/></radialGradient><linearGradient id="${p}-od_g" x1="638.67" x2="638.67" y1="2.44" y2="421.76" gradientTransform="matrix(1 0 0 -1 0 617.01)" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#0086ff"/><stop offset=".49" stop-color="#0bf"/></linearGradient></defs><path d="M276.36 94.08C123.48 94.08 9.21 209.84.6 338.79c5.33 27.79 22.83 82.65 50.24 79.84 34.26-3.52 120.56 0 194.17-123.26 53.77-90.04 164.37-201.29 31.35-201.29Z" fill="url(#${p}-od_a)"/><path d="M240.99 142.19c-51.39 75.26-120.56 183.1-143.91 217.03-27.75 40.34-101.25 23.2-95.16-34.62a237.4 237.4 0 0 0-1.38 14.19C-9.51 489.22 119.43 614.14 279.88 614.14c176.84 0 598.58-203.81 555.9-408.02C790.8 86.1 664.36 0 521.07 0S285.94 76.36 241 142.19Z" fill="url(#${p}-od_b)"/><path d="M277.34 614.23s422.24.77 493.86.77c129.97 0 228.8-98.16 228.8-212.69s-100.8-212.1-228.8-212.1-201.7 88.57-257.06 185.25c-64.87 113.29-147.62 237.41-236.8 238.77Z" fill="url(#${p}-od_g)"/>`
}
const JIRA_SVG = '<path d="M11.571 11.513H0a5.218 5.218 0 0 0 5.232 5.215h2.13v2.057A5.215 5.215 0 0 0 12.575 24V12.518a1.005 1.005 0 0 0-1.005-1.005zm5.723-5.756H5.736a5.215 5.215 0 0 0 5.215 5.214h2.129v2.058a5.218 5.218 0 0 0 5.215 5.214V6.762a1.001 1.001 0 0 0-1.001-1.005zM23.013 0H11.455a5.215 5.215 0 0 0 5.215 5.215h2.129v2.057A5.215 5.215 0 0 0 24 12.483V1.005A1.001 1.001 0 0 0 23.013 0z" fill="#2684FF"/>'

/* ──────────────────────────────────────────────────────────────────────
 * Animation timing / cycle: 14s
 *   0–28%   Phase 1 stalled (only Engineering pilot active, sends 1 packet)
 *   28–36%  Edison fades in
 *   36–95%  Phase 2 - all departments activate together, packets stagger
 *           through Edison with policy verdicts (accept/deny)
 *   95–100% Hold final state (full org lit, all verdicts visible)
 * ────────────────────────────────────────────────────────────────────── */

const CSS = `
.spa { color: var(--text-primary); }

.spa .spa-line { stroke-dashoffset:0; animation: spa-lf 2s linear infinite; }
.spa .spa-pkt path, .spa .spa-pkt circle { fill: currentColor; }

/* phase visibility */
.spa .spa-stalled { animation: spa-sv 14s ease-in-out infinite; }
.spa .spa-edison  { animation: spa-ev 14s ease-in-out infinite; transform-origin: 360px 150px; }
.spa .spa-scaled  { animation: spa-rv 14s ease-in-out infinite; }
.spa .spa-pulse   { transform-origin:360px 150px; animation: spa-pulse 1.4s cubic-bezier(.2,.8,.4,1) infinite; }

/* department activation (phase 2 - all activate together) */
.spa .spa-dept-eng    { animation: spa-eng    14s ease-in-out infinite; transform-origin: 16px 50%; }
.spa .spa-dept-sales  { animation: spa-sales  14s ease-in-out infinite; transform-origin: 16px 50%; }
.spa .spa-dept-fin    { animation: spa-fin    14s ease-in-out infinite; transform-origin: 16px 50%; }
.spa .spa-dept-legal  { animation: spa-legal  14s ease-in-out infinite; transform-origin: 16px 50%; }
.spa .spa-dept-hr     { animation: spa-hr     14s ease-in-out infinite; transform-origin: 16px 50%; }

/* engineering is always on (the pilot) */
@keyframes spa-eng    { 0%,100% { opacity:1; } }
/* others are dark in phase 1, all activate together when Edison appears */
@keyframes spa-sales  { 0%,28% { opacity:.18; } 36%,100% { opacity:1; } }
@keyframes spa-fin    { 0%,28% { opacity:.18; } 36%,100% { opacity:1; } }
@keyframes spa-legal  { 0%,28% { opacity:.18; } 36%,100% { opacity:1; } }
@keyframes spa-hr     { 0%,28% { opacity:.18; } 36%,100% { opacity:1; } }

/* packets - each is colored orange before Edison and accent after */
.spa .spa-pkt-eng    { color:${O}; animation: spa-pkt-eng    14s ease-in-out infinite; }
.spa .spa-pkt-sales  { color:${O}; animation: spa-pkt-sales  14s ease-in-out infinite; }
.spa .spa-pkt-fin    { color:${O}; animation: spa-pkt-fin    14s ease-in-out infinite; }
.spa .spa-pkt-legal  { color:${O}; animation: spa-pkt-legal  14s ease-in-out infinite; }
.spa .spa-pkt-hr     { color:${O}; animation: spa-pkt-hr     14s ease-in-out infinite; }

/* policy verdict badges - synced to packet arrivals at Edison */
.spa .spa-v-eng   { animation: spa-v-eng   14s ease-in-out infinite; }
.spa .spa-v-sales { animation: spa-v-sales 14s ease-in-out infinite; }
.spa .spa-v-fin   { animation: spa-v-fin   14s ease-in-out infinite; }
.spa .spa-v-legal { animation: spa-v-legal 14s ease-in-out infinite; }
.spa .spa-v-hr    { animation: spa-v-hr    14s ease-in-out infinite; }
@keyframes spa-v-eng   { 0%,43% { opacity:0; transform:scale(0.5); } 45% { opacity:1; transform:scale(1); } 100% { opacity:1; transform:scale(1); } }
@keyframes spa-v-sales { 0%,55% { opacity:0; transform:scale(0.5); } 57% { opacity:1; transform:scale(1); } 100% { opacity:1; transform:scale(1); } }
@keyframes spa-v-fin   { 0%,67% { opacity:0; transform:scale(0.5); } 69% { opacity:1; transform:scale(1); } 100% { opacity:1; transform:scale(1); } }
@keyframes spa-v-legal { 0%,79% { opacity:0; transform:scale(0.5); } 81% { opacity:1; transform:scale(1); } 100% { opacity:1; transform:scale(1); } }
@keyframes spa-v-hr    { 0%,90% { opacity:0; transform:scale(0.5); } 92% { opacity:1; transform:scale(1); } 100% { opacity:1; transform:scale(1); } }

/* ── keyframes ── */
@keyframes spa-lf { to { stroke-dashoffset: -12; } }

@keyframes spa-sv {
  0%,28%  { opacity:1; }
  36%     { opacity:0; }
  100%    { opacity:0; }
}
@keyframes spa-ev {
  0%,28%  { opacity:0; transform:scale(.85); }
  36%     { opacity:1; transform:scale(1); }
  100%    { opacity:1; transform:scale(1); }
}
@keyframes spa-rv {
  0%,28%  { opacity:0; }
  36%     { opacity:1; }
  100%    { opacity:1; }
}

/* Phase 1: Engineering pilot tries to reach GitHub directly. The packet
   stalls / dims as it crosses the gap - implying friction without controls. */
@keyframes spa-pkt-eng {
  0%,1%   { opacity:0; }
  3%      { transform:translate(220px,55px);  opacity:.8; color:${O}; }
  14%     { transform:translate(560px,40px);  opacity:1;  color:${O}; }
  18%     { transform:translate(560px,40px);  opacity:0;  color:${O}; }
  /* phase 2: re-emerge through Edison to GitHub (allowed, accent) */
  36%     { opacity:0; }
  38%     { transform:translate(220px,55px);  opacity:.8; color:${O}; }
  43%     { transform:translate(330px,150px); opacity:1;  color:${O}; }
  44%     { transform:translate(360px,150px); opacity:.3; color:var(--accent); }
  45%     { transform:translate(390px,150px); opacity:1;  color:var(--accent); }
  53%     { transform:translate(560px,40px);  opacity:1;  color:var(--accent); }
  54%     { transform:translate(560px,40px);  opacity:0; }
  55%,100%{ opacity:0; }
}

/* Phase 2 packets - Sales → Slack, Finance → OneDrive, Legal → Jira, HR → GitHub */
@keyframes spa-pkt-sales {
  0%,49%  { opacity:0; }
  50%     { transform:translate(220px,100px); opacity:.8; color:${O}; }
  55%     { transform:translate(330px,150px); opacity:1;  color:${O}; }
  56%     { transform:translate(360px,150px); opacity:.3; color:var(--accent); }
  57%     { transform:translate(390px,150px); opacity:1;  color:var(--accent); }
  65%     { transform:translate(560px,110px); opacity:1;  color:var(--accent); }
  66%     { transform:translate(560px,110px); opacity:0; }
  67%,100%{ opacity:0; }
}
@keyframes spa-pkt-fin {
  0%,61%  { opacity:0; }
  62%     { transform:translate(220px,145px); opacity:.8; color:${O}; }
  67%     { transform:translate(330px,150px); opacity:1;  color:${O}; }
  68%     { transform:translate(360px,150px); opacity:.3; color:var(--accent); }
  69%     { transform:translate(390px,150px); opacity:1;  color:var(--accent); }
  77%     { transform:translate(560px,180px); opacity:1;  color:var(--accent); }
  78%     { transform:translate(560px,180px); opacity:0; }
  79%,100%{ opacity:0; }
}
@keyframes spa-pkt-legal {
  0%,73%  { opacity:0; }
  74%     { transform:translate(220px,190px); opacity:.8; color:${O}; }
  79%     { transform:translate(330px,150px); opacity:1;  color:${O}; }
  80%     { transform:translate(360px,150px); opacity:.3; color:var(--accent); }
  81%     { transform:translate(390px,150px); opacity:1;  color:var(--accent); }
  89%     { transform:translate(560px,250px); opacity:1;  color:var(--accent); }
  90%     { transform:translate(560px,250px); opacity:0; }
  91%,100%{ opacity:0; }
}
/* HR packet → DENIED at Edison (stops at gateway, flashes red) */
@keyframes spa-pkt-hr {
  0%,84%  { opacity:0; }
  85%     { transform:translate(220px,235px); opacity:.8; color:${O}; }
  90%     { transform:translate(325px,155px); opacity:1;  color:${O}; }
  91%     { transform:translate(325px,155px); opacity:.6; color:${DANGER}; }
  93%     { transform:translate(325px,155px); opacity:0;  color:${DANGER}; }
  94%,100%{ opacity:0; }
}

@keyframes spa-pulse {
  0%   { transform:scale(1);   opacity:0; }
  10%  { transform:scale(1);   opacity:.4; }
  60%  { transform:scale(1.6); opacity:0; }
  100% { transform:scale(1.6); opacity:0; }
}

.spa .spa-progress { transform-origin:20px 295px; animation: spa-prog 14s linear infinite; }
@keyframes spa-prog {
  0%   { transform:scaleX(0); }
  100% { transform:scaleX(1); }
}

@media (prefers-reduced-motion:reduce) {
  .spa .spa-line, .spa .spa-pulse,
  .spa .spa-stalled, .spa .spa-edison, .spa .spa-scaled,
  .spa .spa-pkt-eng, .spa .spa-pkt-sales, .spa .spa-pkt-fin,
  .spa .spa-pkt-legal, .spa .spa-pkt-hr,
  .spa .spa-dept-sales, .spa .spa-dept-fin, .spa .spa-dept-legal, .spa .spa-dept-hr,
  .spa .spa-v-eng, .spa .spa-v-sales, .spa .spa-v-fin,
  .spa .spa-v-legal, .spa .spa-v-hr { animation:none; }
  .spa .spa-pkt-eng, .spa .spa-pkt-sales, .spa .spa-pkt-fin,
  .spa .spa-pkt-legal, .spa .spa-pkt-hr { opacity:0; }
  .spa .spa-progress { animation:none; transform:scaleX(1); }
  .spa .spa-edison  { opacity:1; transform:scale(1); }
  .spa .spa-stalled { opacity:0; }
  .spa .spa-scaled  { opacity:1; }
  .spa .spa-dept-sales, .spa .spa-dept-fin,
  .spa .spa-dept-legal, .spa .spa-dept-hr { opacity:1; }
  .spa .spa-v-eng, .spa .spa-v-sales, .spa .spa-v-fin,
  .spa .spa-v-legal, .spa .spa-v-hr { opacity:1; }
}
`

/* ──────────────────────────────────────────────────────────────────────
 * Building blocks
 * ────────────────────────────────────────────────────────────────────── */

interface DeptEntry {
  label: string
  agent: typeof CURSOR
  headcount: number
}

function DepartmentRow({
  y, dept, className,
}: {
  y: number; dept: DeptEntry; className: string
}): React.ReactNode {
  const tileX = 104
  const tileSize = 18
  const tileGap = 4
  return (
    <g className={className}>
      {/* Dept pill background */}
      <rect x={8} y={y} width={210} height={28} rx={6}
        fill="var(--text-primary)" fillOpacity="0.03"
        stroke="var(--text-muted)" strokeOpacity="0.3" strokeWidth="1" />
      {/* Department label */}
      <text x={16} y={y + 18}
        fill="var(--text-primary)" fontSize="9" fontWeight="bold"
        fontFamily="system-ui,sans-serif">
        {dept.label}
      </text>
      {/* AI agent in use by this department */}
      <AgentIcon agent={dept.agent} x={tileX - 24} y={y + 4} size={20} />
      {/* Headcount pips (employees on AI) */}
      {Array.from({ length: dept.headcount }).map((_, i) => (
        <g key={i}>
          <rect
            x={tileX + i * (tileSize + tileGap)}
            y={y + 5}
            width={tileSize}
            height={tileSize}
            rx={4}
            fill="var(--accent)"
            fillOpacity="0.12"
            stroke="var(--accent)"
            strokeOpacity="0.45"
            strokeWidth="1"
          />
          <circle
            cx={tileX + i * (tileSize + tileGap) + tileSize / 2}
            cy={y + 5 + tileSize / 2 - 1}
            r="2.4"
            fill="var(--accent)"
            fillOpacity="0.7"
          />
          <path
            d={`M ${tileX + i * (tileSize + tileGap) + 3} ${y + 5 + tileSize - 2}
                Q ${tileX + i * (tileSize + tileGap) + tileSize / 2} ${y + 5 + tileSize - 7}
                  ${tileX + i * (tileSize + tileGap) + tileSize - 3} ${y + 5 + tileSize - 2}`}
            fill="none"
            stroke="var(--accent)"
            strokeOpacity="0.7"
            strokeWidth="1.4"
          />
        </g>
      ))}
    </g>
  )
}

function ToolServer({ x, y, iconSvg, iconViewBox, label }: {
  x: number; y: number; iconSvg?: string; iconViewBox?: string; label: string
}): React.ReactNode {
  return (
    <g>
      <rect x={x} y={y} width={56} height={44} rx={6}
        fill="var(--text-primary)" fillOpacity="0.03"
        stroke="var(--text-muted)" strokeOpacity="0.35" strokeWidth="1" />
      {iconSvg ? (
        <svg x={x + 16} y={y + 8} width={24} height={24}
          viewBox={iconViewBox || '0 0 24 24'}
          dangerouslySetInnerHTML={{ __html: iconSvg }} />
      ) : (
        <McpIcon x={x + 16} y={y + 8} size={24} color="var(--text-muted)" opacity="0.6" />
      )}
      <text x={x + 28} y={y + 56} textAnchor="middle"
        fill="var(--text-muted)" fontSize="8" fontFamily="system-ui,sans-serif">
        {label}
      </text>
    </g>
  )
}

const DEPTS: DeptEntry[] = [
  { label: 'Engineering', agent: CURSOR,         headcount: 5 },
  { label: 'Sales',       agent: CLAUDE_DESKTOP, headcount: 5 },
  { label: 'Finance',     agent: M365_COPILOT,   headcount: 4 },
  { label: 'Legal',       agent: CLAUDE_COWORK,  headcount: 4 },
  { label: 'HR & Ops',    agent: CHATGPT,        headcount: 5 },
]

const ROW_YS = [40, 85, 130, 175, 220]

export default function ScalePilotAnimation(): React.ReactNode {
  const id = useId()
  const odSvg = onedriveSvg(id)

  return (
    <div className="flex justify-center">
      <style>{CSS}</style>
      <svg
        className="spa"
        width={720}
        height={300}
        viewBox="0 0 720 300"
        xmlns="http://www.w3.org/2000/svg"
        role="presentation"
        aria-hidden="true"
      >
        {/* ══ Top: Admin ══ */}
        <g>
          <svg x={347} y={2} width={26} height={26} viewBox="0 0 256 256">
            <path d={ADMIN_PATH} fill="var(--text-primary)" fillOpacity="0.7" />
          </svg>
          <text x="360" y="40" textAnchor="middle"
            fill="var(--text-primary)" fontSize="8" fontWeight="bold"
            fontFamily="system-ui,sans-serif">
            Admin
          </text>
        </g>

        {/* Phase 1: stalled state - eye-slash, "Pilot stalled" */}
        <g className="spa-stalled">
          <svg x={344} y={48} width={32} height={32} viewBox="0 0 256 256">
            <path d={EYE_SLASH_PATH} fill={DANGER} fillOpacity="0.7" />
          </svg>
          <text x="360" y="92" textAnchor="middle"
            fill={DANGER} fillOpacity="0.75" fontSize="9" fontWeight="bold"
            fontFamily="system-ui,sans-serif">
            Pilot stalled
          </text>
          <text x="360" y="104" textAnchor="middle"
            fill="var(--text-muted)" fontSize="7.5"
            fontFamily="system-ui,sans-serif">
            no visibility, can't approve scale-out
          </text>
        </g>

        {/* Phase 2: scaled state - eye, shield, "Org-wide rollout" */}
        <g className="spa-scaled">
          <svg x={344} y={48} width={32} height={32} viewBox="0 0 256 256">
            <path d={EYE_PATH} fill="var(--accent)" fillOpacity="0.85" />
          </svg>
          <text x="360" y="92" textAnchor="middle"
            fill="var(--accent)" fillOpacity="0.9" fontSize="9" fontWeight="bold"
            fontFamily="system-ui,sans-serif">
            Org-wide rollout
          </text>
          <text x="360" y="104" textAnchor="middle"
            fill="var(--text-muted)" fontSize="7.5"
            fontFamily="system-ui,sans-serif">
            unified visibility & deterministic controls
          </text>
        </g>

        {/* ══ Phase 1: direct line from Engineering → GitHub ══ */}
        <g className="spa-stalled">
          <line className="spa-line" x1="220" y1="55" x2="560" y2="40"
            stroke={DANGER} strokeOpacity="0.45" strokeWidth="1.5" strokeDasharray="3 3" />
          <text x="115" y="278" textAnchor="middle"
            fill="var(--text-muted)" fontSize="8" fontFamily="system-ui,sans-serif">
            Engineering pilot only
          </text>
        </g>

        {/* ══ Edison gateway (fades in for Phase 2) ══ */}
        <g className="spa-edison">
          <circle className="spa-pulse" cx="360" cy="150" r="32"
            fill="none" stroke="var(--accent)" strokeOpacity="0.5" strokeWidth="1.5" />
          <EdisonLogo x={333} y={124} w={54} h={52.5} />
          <text x="360" y="195" textAnchor="middle"
            fill="var(--text-primary)" fontSize="9" fontWeight="bold"
            fontFamily="system-ui,sans-serif">
            Edison Watch
          </text>
          <text x="360" y="207" textAnchor="middle"
            fill="var(--text-muted)" fontSize="7.5"
            fontFamily="system-ui,sans-serif">
            unified control plane
          </text>
          {/* Shield badge near gateway */}
          <svg x={395} y={170} width={14} height={14} viewBox="0 0 256 256">
            <path d={SHIELD_CHECK_PATH} fill="var(--accent)" fillOpacity="0.7" />
          </svg>
        </g>

        {/* ══ Phase 2: routed connection lines ══ */}
        <g className="spa-scaled">
          {/* Departments → Edison (muted) */}
          {ROW_YS.map((ry) => (
            <line key={ry} className="spa-line"
              x1="220" y1={ry + 15} x2="328" y2="150"
              stroke="var(--text-muted)" strokeOpacity="0.45" strokeWidth="1.5"
              strokeDasharray="3 3" />
          ))}
          {/* Edison → tools (accent) */}
          {[40, 110, 180, 250].map((ty) => (
            <line key={ty} className="spa-line"
              x1="392" y1="150" x2="560" y2={ty + 15}
              stroke="var(--accent)" strokeOpacity="0.5" strokeWidth="1.5"
              strokeDasharray="3 3" />
          ))}
          <text x="115" y="278" textAnchor="middle"
            fill="var(--accent)" fillOpacity="0.85" fontSize="8" fontWeight="bold"
            fontFamily="system-ui,sans-serif">
            Every team, every tool
          </text>
        </g>

        {/* ══ Department rows (always present; activate together in Phase 2) ══ */}
        <DepartmentRow y={ROW_YS[0]} dept={DEPTS[0]} className="spa-dept-eng" />
        <DepartmentRow y={ROW_YS[1]} dept={DEPTS[1]} className="spa-dept-sales" />
        <DepartmentRow y={ROW_YS[2]} dept={DEPTS[2]} className="spa-dept-fin" />
        <DepartmentRow y={ROW_YS[3]} dept={DEPTS[3]} className="spa-dept-legal" />
        <DepartmentRow y={ROW_YS[4]} dept={DEPTS[4]} className="spa-dept-hr" />

        {/* ══ Policy verdicts near Edison (Phase 2, staggered with packets) ══ */}
        {/* Engineering → allowed */}
        <g className="spa-v-eng" style={{ transformOrigin: '310px 120px' }}>
          <circle cx="310" cy="120" r="8"
            fill="var(--accent)" fillOpacity="0.12" stroke="var(--accent)" strokeOpacity="0.5" strokeWidth="1" />
          <polyline points="305.5,120 308,122.5 314.5,116"
            fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </g>
        {/* Sales → allowed */}
        <g className="spa-v-sales" style={{ transformOrigin: '310px 135px' }}>
          <circle cx="310" cy="135" r="8"
            fill="var(--accent)" fillOpacity="0.12" stroke="var(--accent)" strokeOpacity="0.5" strokeWidth="1" />
          <polyline points="305.5,135 308,137.5 314.5,131"
            fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </g>
        {/* Finance → allowed */}
        <g className="spa-v-fin" style={{ transformOrigin: '310px 150px' }}>
          <circle cx="310" cy="150" r="8"
            fill="var(--accent)" fillOpacity="0.12" stroke="var(--accent)" strokeOpacity="0.5" strokeWidth="1" />
          <polyline points="305.5,150 308,152.5 314.5,146"
            fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </g>
        {/* Legal → allowed */}
        <g className="spa-v-legal" style={{ transformOrigin: '310px 165px' }}>
          <circle cx="310" cy="165" r="8"
            fill="var(--accent)" fillOpacity="0.12" stroke="var(--accent)" strokeOpacity="0.5" strokeWidth="1" />
          <polyline points="305.5,165 308,167.5 314.5,161"
            fill="none" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </g>
        {/* HR & Ops → denied */}
        <g className="spa-v-hr" style={{ transformOrigin: '310px 180px' }}>
          <circle cx="310" cy="180" r="8"
            fill={DANGER} fillOpacity="0.12" stroke={DANGER} strokeOpacity="0.5" strokeWidth="1" />
          <line x1="306.5" y1="176.5" x2="313.5" y2="183.5" stroke={DANGER} strokeWidth="1.6" strokeLinecap="round" />
          <line x1="313.5" y1="176.5" x2="306.5" y2="183.5" stroke={DANGER} strokeWidth="1.6" strokeLinecap="round" />
        </g>

        {/* ══ Right column: enterprise tools (always visible) ══ */}
        <ToolServer x={560} y={18}  iconSvg={GITHUB_SVG}   iconViewBox="0 0 1024 1024" label="GitHub" />
        <ToolServer x={560} y={88}  iconSvg={SLACK_SVG}    iconViewBox="0 0 2447.6 2452.5" label="Slack" />
        <ToolServer x={560} y={158} iconSvg={odSvg}        iconViewBox="0 0 1000 615" label="OneDrive" />
        <ToolServer x={560} y={228} iconSvg={JIRA_SVG}     iconViewBox="0 0 24 24" label="Jira" />

        {/* ══ Section labels ══ */}
        <text x="115" y="22" textAnchor="middle"
          fill="var(--text-primary)" fontSize="9" fontWeight="bold"
          fontFamily="system-ui,sans-serif">
          Your Workforce
        </text>
        <text x="588" y="12" textAnchor="middle"
          fill="var(--text-primary)" fontSize="9" fontWeight="bold"
          fontFamily="system-ui,sans-serif">
          Enterprise Tools
        </text>

        {/* ══ Packets ══ */}
        <g className="spa-pkt spa-pkt-eng"><McpPacket /></g>
        <g className="spa-pkt spa-pkt-sales"><McpPacket /></g>
        <g className="spa-pkt spa-pkt-fin"><McpPacket /></g>
        <g className="spa-pkt spa-pkt-legal"><McpPacket /></g>
        <g className="spa-pkt spa-pkt-hr"><McpPacket /></g>

        {/* ══ Progress bar ══ */}
        <ProgressBar y={295} width={680} className="spa-progress" />
      </svg>
    </div>
  )
}
