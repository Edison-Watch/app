/**
 * Product Journey Animation - 4-phase progressive accumulation narrative.
 *
 * Phase 1 - "Onboard": Edison client installs on employee laptops (staggered),
 *           scans configs, discovers shadow agents/MCPs. Admin has no
 *           visibility (admin+eye-slash effect).
 * Phase 2 - "Observe": Edison gateway materializes, replacing the blind
 *           spot; all agentic actions flow through Edison with visibility.
 * Phase 3 - "Enforce": Edison blocks policy violations and data
 *           exfiltration; verdict badges (allow/deny) appear.
 * Phase 4 - "Unify": Laptops fade, replaced by ScalePilot-style department
 *           rows showing org-wide AI governance across all teams.
 *
 * 20s loop. Progressive accumulation: each phase adds new elements while
 * prior elements persist. Pure SVG + CSS. Respects `prefers-reduced-motion`.
 */
import { AGENT_REGISTRY } from '../../agent-registry/index'
import {
  ADMIN_PATH,
  AgentIcon,
  DANGER,
  EdisonLogo,
  EYE_PATH,
  EYE_SLASH_PATH,
  McpIcon,
  McpPacket,
  ORANGE as O,
  ProgressBar,
  SHIELD_CHECK_PATH
} from '../_shared'

const CLAUDE = AGENT_REGISTRY['claude-code']
const CURSOR = AGENT_REGISTRY['cursor']
const CODEX = AGENT_REGISTRY['codex']
const CLAUDE_DESKTOP = AGENT_REGISTRY['claude-desktop']
const M365_COPILOT = AGENT_REGISTRY['m365-copilot']
const CLAUDE_COWORK = AGENT_REGISTRY['claude-cowork']
const CHATGPT = AGENT_REGISTRY['chatgpt']

const SCALES_PATH =
  'M239.43,133l-32-80h0a8,8,0,0,0-9.16-4.84L136,62V40a8,8,0,0,0-16,0V65.58L54.26,80.19A8,8,0,0,0,48.57,85h0v.06L16.57,165a7.92,7.92,0,0,0-.57,3c0,23.31,24.54,32,40,32s40-8.69,40-32a7.92,7.92,0,0,0-.57-3L66.92,93.77,120,82V208H104a8,8,0,0,0,0,16h48a8,8,0,0,0,0-16H136V78.42L187,67.1,160.57,133a7.92,7.92,0,0,0-.57,3c0,23.31,24.54,32,40,32s40-8.69,40-32A7.92,7.92,0,0,0,239.43,133ZM56,184c-7.53,0-22.76-3.61-23.93-14.64L56,109.54l23.93,59.82C78.76,180.39,63.53,184,56,184Zm144-32c-7.53,0-22.76-3.61-23.93-14.64L200,77.54l23.93,59.82C222.76,148.39,207.53,152,200,152Z'

const fg = 'var(--text-primary)'
const muted = 'var(--text-muted)'
const accent = 'var(--accent)'

const DEPTS = [
  { label: 'Engineering', agent: CURSOR, pips: 5, y: 50 },
  { label: 'Sales', agent: CLAUDE_DESKTOP, pips: 4, y: 90 },
  { label: 'Finance', agent: M365_COPILOT, pips: 3, y: 130 },
  { label: 'Legal', agent: CLAUDE_COWORK, pips: 3, y: 170 },
  { label: 'HR & Ops', agent: CHATGPT, pips: 4, y: 210 }
]

const CSS = `
.pj { color: var(--text-primary); }
.pj .pj-line { stroke-dashoffset:0; animation: pj-lf 2s linear infinite; }
.pj .pj-pkt path, .pj .pj-pkt circle { fill: currentColor; }

/* Phase element visibility (progressive - once visible, stays) */
.pj .pj-p1 { animation: pj-p1 20s ease-in-out infinite; }
.pj .pj-p2 { animation: pj-p2 20s ease-in-out infinite; }
.pj .pj-p3 { animation: pj-p3 20s ease-in-out infinite; }
.pj .pj-p4 { animation: pj-p4 20s ease-in-out infinite; }

/* Phase 1 "blind" state - visible only during Phase 1, fades when Edison arrives */
.pj .pj-blind { animation: pj-blind 20s ease-in-out infinite; }

/* Phase 4: fade left-side laptops to make room for department rows */
.pj .pj-pre4 { animation: pj-pre4 20s ease-in-out infinite; }

/* Phase labels (each visible only during its phase) */
.pj .pj-l1 { animation: pj-l1 20s ease-in-out infinite; }
.pj .pj-l2 { animation: pj-l2 20s ease-in-out infinite; }
.pj .pj-l3 { animation: pj-l3 20s ease-in-out infinite; }
.pj .pj-l4 { animation: pj-l4 20s ease-in-out infinite; }

/* Step dots */
.pj .pj-s1 { animation: pj-s1 20s ease-in-out infinite; }
.pj .pj-s2 { animation: pj-s2 20s ease-in-out infinite; }
.pj .pj-s3 { animation: pj-s3 20s ease-in-out infinite; }
.pj .pj-s4 { animation: pj-s4 20s ease-in-out infinite; }

/* Edison gateway */
.pj .pj-edison { animation: pj-ed 20s ease-in-out infinite; transform-origin: 350px 153px; }
.pj .pj-pulse  { transform-origin: 350px 153px; animation: pj-pulse 1.4s cubic-bezier(.2,.8,.4,1) infinite; }

/* Phase 1: staggered Edison client install on each laptop */
.pj .pj-inst1 { animation: pj-inst1 20s ease-in-out infinite; transform-origin: 84px 68px; }
.pj .pj-inst2 { animation: pj-inst2 20s ease-in-out infinite; transform-origin: 84px 143px; }
.pj .pj-inst3 { animation: pj-inst3 20s ease-in-out infinite; transform-origin: 84px 218px; }
.pj .pj-iglow1 { animation: pj-iglow1 20s ease-in-out infinite; }
.pj .pj-iglow2 { animation: pj-iglow2 20s ease-in-out infinite; }
.pj .pj-iglow3 { animation: pj-iglow3 20s ease-in-out infinite; }

/* Phase 1 shadow (per-laptop, fades as Edison installs on that laptop) */
.pj .pj-shad1 { animation: pj-shad1 20s ease-in-out infinite; }
.pj .pj-shad2 { animation: pj-shad2 20s ease-in-out infinite; }
.pj .pj-shad3 { animation: pj-shad3 20s ease-in-out infinite; }
.pj .pj-sglow  { animation: pj-sglow 1.5s ease-in-out infinite; }
.pj .pj-scan   { animation: pj-scan 20s ease-in-out infinite; }

/* Packets */
.pj .pj-pkt0 { color: ${O}; animation: pj-pkt0 20s ease-in-out infinite; }
.pj .pj-pkt1 { color: ${O}; animation: pj-pkt1 20s ease-in-out infinite; }
.pj .pj-pkt2 { color: ${O}; animation: pj-pkt2 20s ease-in-out infinite; }
.pj .pj-pkt3 { color: ${O}; animation: pj-pkt3 20s ease-in-out infinite; }
.pj .pj-pkt4 { color: ${O}; animation: pj-pkt4 20s ease-in-out infinite; }

/* Verdict badges */
.pj .pj-va { animation: pj-va 20s ease-in-out infinite; }
.pj .pj-vd { animation: pj-vd 20s ease-in-out infinite; }

/* Progress bar */
.pj .pj-progress { transform-origin: 20px 292px; animation: pj-prog 20s linear infinite; }

/* ── Keyframes ── */
@keyframes pj-lf { to { stroke-dashoffset: -12; } }

/* Progressive element visibility */
@keyframes pj-p1 { 0% { opacity:0; } 3% { opacity:1; } 100% { opacity:1; } }
@keyframes pj-p2 { 0%,22% { opacity:0; } 28% { opacity:1; } 100% { opacity:1; } }
@keyframes pj-p3 { 0%,47% { opacity:0; } 53% { opacity:1; } 100% { opacity:1; } }
@keyframes pj-p4 { 0%,72% { opacity:0; } 78% { opacity:1; } 100% { opacity:1; } }

/* Phase 1 blind state - fades out when Edison arrives */
@keyframes pj-blind {
  0%    { opacity:0; }
  3%    { opacity:1; }
  22%   { opacity:1; }
  28%   { opacity:0; }
  100%  { opacity:0; }
}

/* Hide laptops when Phase 4 department rows appear */
@keyframes pj-pre4 {
  0%,72% { opacity:1; }
  78%    { opacity:0; }
  100%   { opacity:0; }
}

/* Phase labels (swap each phase) */
@keyframes pj-l1 { 0% { opacity:0; } 3% { opacity:1; } 22% { opacity:1; } 26% { opacity:0; } 100% { opacity:0; } }
@keyframes pj-l2 { 0%,23% { opacity:0; } 28% { opacity:1; } 47% { opacity:1; } 51% { opacity:0; } 100% { opacity:0; } }
@keyframes pj-l3 { 0%,48% { opacity:0; } 53% { opacity:1; } 72% { opacity:1; } 76% { opacity:0; } 100% { opacity:0; } }
@keyframes pj-l4 { 0%,73% { opacity:0; } 78% { opacity:1; } 96% { opacity:1; } 100% { opacity:0; } }

/* Step dots (fill progressively) */
@keyframes pj-s1 { 0% { opacity:.2; } 3% { opacity:1; } 100% { opacity:1; } }
@keyframes pj-s2 { 0%,22% { opacity:.2; } 28% { opacity:1; } 100% { opacity:1; } }
@keyframes pj-s3 { 0%,47% { opacity:.2; } 53% { opacity:1; } 100% { opacity:1; } }
@keyframes pj-s4 { 0%,72% { opacity:.2; } 78% { opacity:1; } 100% { opacity:1; } }

/* Edison gateway */
@keyframes pj-ed {
  0%,22% { opacity:0; transform:scale(.85); }
  28%    { opacity:1; transform:scale(1); }
  100%   { opacity:1; transform:scale(1); }
}
@keyframes pj-pulse {
  0%   { transform:scale(1);   opacity:0;  }
  10%  { transform:scale(1);   opacity:.4; }
  60%  { transform:scale(1.6); opacity:0;  }
  100% { transform:scale(1.6); opacity:0;  }
}

/* Shadow MCP reveal per laptop - fades out as Edison installs on that laptop */
@keyframes pj-shad1 { 0% { opacity:0; } 3% { opacity:1; } 8% { opacity:1; } 10% { opacity:0; } 100% { opacity:0; } }
@keyframes pj-shad2 { 0% { opacity:0; } 3% { opacity:1; } 11% { opacity:1; } 13% { opacity:0; } 100% { opacity:0; } }
@keyframes pj-shad3 { 0% { opacity:0; } 3% { opacity:1; } 14% { opacity:1; } 16% { opacity:0; } 100% { opacity:0; } }
@keyframes pj-sglow  { 0%,100% { stroke-opacity:.3; } 50% { stroke-opacity:.65; } }

/* Staggered Edison client install: pop-in with overshoot on each laptop */
@keyframes pj-inst1 {
  0%,8%  { opacity:0; transform:scale(0); }
  10%    { opacity:1; transform:scale(1.3); }
  12%    { opacity:1; transform:scale(1); }
  100%   { opacity:1; transform:scale(1); }
}
@keyframes pj-inst2 {
  0%,11% { opacity:0; transform:scale(0); }
  13%    { opacity:1; transform:scale(1.3); }
  15%    { opacity:1; transform:scale(1); }
  100%   { opacity:1; transform:scale(1); }
}
@keyframes pj-inst3 {
  0%,14% { opacity:0; transform:scale(0); }
  16%    { opacity:1; transform:scale(1.3); }
  18%    { opacity:1; transform:scale(1); }
  100%   { opacity:1; transform:scale(1); }
}

/* Brief accent glow ring on each laptop during install */
@keyframes pj-iglow1 {
  0%,8%  { opacity:0; }
  9%     { opacity:0.7; }
  12%    { opacity:0; }
  100%   { opacity:0; }
}
@keyframes pj-iglow2 {
  0%,11% { opacity:0; }
  12%    { opacity:0.7; }
  15%    { opacity:0; }
  100%   { opacity:0; }
}
@keyframes pj-iglow3 {
  0%,14% { opacity:0; }
  15%    { opacity:0.7; }
  18%    { opacity:0; }
  100%   { opacity:0; }
}

/* Scan line (after installs complete) */
@keyframes pj-scan {
  0%,17% { opacity:0; transform:translateY(0);     }
  18%    { opacity:.6; transform:translateY(0);     }
  21%    { opacity:.6; transform:translateY(210px); }
  22%    { opacity:0;  transform:translateY(210px); }
  100%   { opacity:0; }
}

/* Phase 1 direct packet: laptop 2 <-> Docs round-trip (unmonitored) */
@keyframes pj-pkt0 {
  0%,5%   { opacity:0; }
  6%      { transform:translate(158px,153px); opacity:0;  color:${O}; }
  7%      { transform:translate(158px,153px); opacity:.8; color:${O}; }
  14%     { transform:translate(540px,153px); opacity:1;  color:${O}; }
  15%     { transform:translate(540px,153px); opacity:.6; color:${O}; }
  16%     { transform:translate(540px,153px); opacity:.8; color:${O}; }
  21%     { transform:translate(158px,153px); opacity:1;  color:${O}; }
  22%     { transform:translate(158px,153px); opacity:0; }
  100%    { opacity:0; }
}

/* Phase 2 observe packet: laptop 1 -> Edison -> tool 1 */
@keyframes pj-pkt1 {
  0%,31%  { opacity:0; }
  33%     { transform:translate(158px,78px);  opacity:.8; color:${O}; }
  38%     { transform:translate(322px,153px); opacity:1;  color:${O}; }
  39%     { transform:translate(350px,153px); opacity:.3; color:var(--accent); }
  40%     { transform:translate(378px,153px); opacity:1;  color:var(--accent); }
  46%     { transform:translate(540px,78px);  opacity:1;  color:var(--accent); }
  48%     { transform:translate(540px,78px);  opacity:0; }
  100%    { opacity:0; }
}

/* Phase 3 enforce packet - BLOCKED: laptop 3 -> Edison -> denied */
@keyframes pj-pkt2 {
  0%,54%  { opacity:0; }
  56%     { transform:translate(158px,228px); opacity:.8; color:${O}; }
  62%     { transform:translate(310px,163px); opacity:1;  color:${O}; }
  63%     { transform:translate(320px,163px); opacity:.6; color:${DANGER}; }
  65%     { transform:translate(320px,163px); opacity:0;  color:${DANGER}; }
  100%    { opacity:0; }
}

/* Phase 3 enforce packet - ALLOWED: laptop 2 -> Edison -> tool 2 */
@keyframes pj-pkt3 {
  0%,63%  { opacity:0; }
  65%     { transform:translate(158px,153px); opacity:.8; color:${O}; }
  69%     { transform:translate(322px,153px); opacity:1;  color:${O}; }
  70%     { transform:translate(350px,153px); opacity:.3; color:var(--accent); }
  71%     { transform:translate(378px,153px); opacity:1;  color:var(--accent); }
  74%     { transform:translate(540px,153px); opacity:1;  color:var(--accent); }
  76%     { transform:translate(540px,153px); opacity:0; }
  100%    { opacity:0; }
}

/* Phase 4 unified packet: dept row -> Edison -> tool 3 */
@keyframes pj-pkt4 {
  0%,79%  { opacity:0; }
  81%     { transform:translate(190px,62px);  opacity:.8; color:${O}; }
  85%     { transform:translate(322px,153px); opacity:1;  color:${O}; }
  86%     { transform:translate(350px,153px); opacity:.3; color:var(--accent); }
  87%     { transform:translate(378px,153px); opacity:1;  color:var(--accent); }
  92%     { transform:translate(540px,228px); opacity:1;  color:var(--accent); }
  94%     { transform:translate(540px,228px); opacity:0; }
  100%    { opacity:0; }
}

/* Verdict badges (phase 3) */
@keyframes pj-vd { 0%,61% { opacity:0; transform:scale(0.5); } 64% { opacity:1; transform:scale(1); } 72% { opacity:1; transform:scale(1); } 78% { opacity:0; transform:scale(1); } 100% { opacity:0; } }
@keyframes pj-va { 0%,68% { opacity:0; transform:scale(0.5); } 71% { opacity:1; transform:scale(1); } 72% { opacity:1; transform:scale(1); } 78% { opacity:0; transform:scale(1); } 100% { opacity:0; } }

/* Progress */
@keyframes pj-prog { 0% { transform:scaleX(0); } 100% { transform:scaleX(1); } }

/* Reduced motion */
@media (prefers-reduced-motion:reduce) {
  .pj .pj-line, .pj .pj-pulse, .pj .pj-scan,
  .pj .pj-p1, .pj .pj-p2, .pj .pj-p3, .pj .pj-p4, .pj .pj-blind, .pj .pj-pre4,
  .pj .pj-l1, .pj .pj-l2, .pj .pj-l3, .pj .pj-l4,
  .pj .pj-s1, .pj .pj-s2, .pj .pj-s3, .pj .pj-s4,
  .pj .pj-edison,
  .pj .pj-inst1, .pj .pj-inst2, .pj .pj-inst3,
  .pj .pj-iglow1, .pj .pj-iglow2, .pj .pj-iglow3,
  .pj .pj-shad1, .pj .pj-shad2, .pj .pj-shad3, .pj .pj-sglow,
  .pj .pj-pkt0, .pj .pj-pkt1, .pj .pj-pkt2, .pj .pj-pkt3, .pj .pj-pkt4,
  .pj .pj-va, .pj .pj-vd { animation:none; }
  .pj .pj-p1, .pj .pj-p2, .pj .pj-p3, .pj .pj-p4 { opacity:1; }
  .pj .pj-blind { opacity:0; }
  .pj .pj-pre4 { opacity:0; }
  .pj .pj-l1, .pj .pj-l2, .pj .pj-l3 { opacity:0; }
  .pj .pj-l4 { opacity:1; }
  .pj .pj-s1, .pj .pj-s2, .pj .pj-s3, .pj .pj-s4 { opacity:1; }
  .pj .pj-edison { opacity:1; transform:scale(1); }
  .pj .pj-inst1, .pj .pj-inst2, .pj .pj-inst3 { opacity:1; transform:scale(1); }
  .pj .pj-iglow1, .pj .pj-iglow2, .pj .pj-iglow3 { opacity:0; }
  .pj .pj-shad1, .pj .pj-shad2, .pj .pj-shad3 { opacity:0; }
  .pj .pj-pkt0, .pj .pj-pkt1, .pj .pj-pkt2, .pj .pj-pkt3, .pj .pj-pkt4 { opacity:0; }
  .pj .pj-va, .pj .pj-vd { opacity:0; transform:scale(1); }
  .pj .pj-progress { animation:none; transform:scaleX(1); }
}
`

export default function ProductJourneyAnimation(): React.ReactNode {
  return (
    <div className="flex justify-center">
      <style>{CSS}</style>
      <svg
        className="pj"
        width={700}
        height={300}
        viewBox="0 0 700 300"
        xmlns="http://www.w3.org/2000/svg"
        role="presentation"
        aria-hidden="true"
      >
        {/* ══ TOP: Step indicator dots ══ */}
        <circle
          className="pj-s1"
          cx={323}
          cy={8}
          r={3.5}
          fill={accent}
          stroke={accent}
          strokeOpacity="0.4"
          strokeWidth="0.8"
        />
        <circle
          className="pj-s2"
          cx={339}
          cy={8}
          r={3.5}
          fill={accent}
          stroke={accent}
          strokeOpacity="0.4"
          strokeWidth="0.8"
        />
        <circle
          className="pj-s3"
          cx={355}
          cy={8}
          r={3.5}
          fill={accent}
          stroke={accent}
          strokeOpacity="0.4"
          strokeWidth="0.8"
        />
        <circle
          className="pj-s4"
          cx={371}
          cy={8}
          r={3.5}
          fill={accent}
          stroke={accent}
          strokeOpacity="0.4"
          strokeWidth="0.8"
        />
        <line
          x1={327}
          y1={8}
          x2={335}
          y2={8}
          stroke={accent}
          strokeOpacity="0.2"
          strokeWidth="0.8"
        />
        <line
          x1={343}
          y1={8}
          x2={351}
          y2={8}
          stroke={accent}
          strokeOpacity="0.2"
          strokeWidth="0.8"
        />
        <line
          x1={359}
          y1={8}
          x2={367}
          y2={8}
          stroke={accent}
          strokeOpacity="0.2"
          strokeWidth="0.8"
        />

        {/* ══ TOP: Phase labels (swap each phase) ══ */}
        <g className="pj-l1">
          <text
            x="347"
            y="28"
            textAnchor="middle"
            fill={accent}
            fontSize="11"
            fontWeight="bold"
            fontFamily="system-ui,sans-serif"
          >
            1. Onboard
          </text>
          <text
            x="347"
            y="40"
            textAnchor="middle"
            fill={muted}
            fontSize="7.5"
            fontFamily="system-ui,sans-serif"
          >
            Install Edison &middot; Discover shadow agents
          </text>
        </g>
        <g className="pj-l2">
          <text
            x="347"
            y="28"
            textAnchor="middle"
            fill={accent}
            fontSize="11"
            fontWeight="bold"
            fontFamily="system-ui,sans-serif"
          >
            2. Observe
          </text>
          <text
            x="347"
            y="40"
            textAnchor="middle"
            fill={muted}
            fontSize="7.5"
            fontFamily="system-ui,sans-serif"
          >
            Monitor all agentic actions &middot; RBAC controls
          </text>
        </g>
        <g className="pj-l3">
          <text
            x="347"
            y="28"
            textAnchor="middle"
            fill={accent}
            fontSize="11"
            fontWeight="bold"
            fontFamily="system-ui,sans-serif"
          >
            3. Enforce
          </text>
          <text
            x="347"
            y="40"
            textAnchor="middle"
            fill={muted}
            fontSize="7.5"
            fontFamily="system-ui,sans-serif"
          >
            Block policy violations &middot; Prevent exfiltration
          </text>
        </g>
        <g className="pj-l4">
          <text
            x="347"
            y="28"
            textAnchor="middle"
            fill={accent}
            fontSize="11"
            fontWeight="bold"
            fontFamily="system-ui,sans-serif"
          >
            4. Unify
          </text>
          <text
            x="347"
            y="40"
            textAnchor="middle"
            fill={muted}
            fontSize="7.5"
            fontFamily="system-ui,sans-serif"
          >
            Scale AI across the entire organization
          </text>
        </g>

        {/* ══ LEFT: Employee Laptops (Phase 1-3, fades in Phase 4) ══ */}
        <g className="pj-pre4">
          <g className="pj-p1">
            {/* Laptop 1 - Claude Code */}
            <rect
              x={12}
              y={50}
              width={140}
              height={55}
              rx={6}
              fill={fg}
              fillOpacity="0.03"
              stroke={muted}
              strokeOpacity="0.35"
              strokeWidth="1.5"
            />
            <rect
              x={8}
              y={107}
              width={148}
              height={6}
              rx={3}
              fill={fg}
              fillOpacity="0.04"
              stroke={muted}
              strokeOpacity="0.35"
              strokeWidth="1"
            />
            <AgentIcon agent={CLAUDE} x={20} y={58} size={22} />
            <McpIcon x={52} y={60} size={16} color={muted} opacity="0.45" />
            <McpIcon x={74} y={60} size={16} color={muted} opacity="0.45" />
            <McpIcon x={96} y={60} size={16} color={muted} opacity="0.45" />

            {/* Laptop 2 - Cursor */}
            <rect
              x={12}
              y={125}
              width={140}
              height={55}
              rx={6}
              fill={fg}
              fillOpacity="0.03"
              stroke={muted}
              strokeOpacity="0.35"
              strokeWidth="1.5"
            />
            <rect
              x={8}
              y={182}
              width={148}
              height={6}
              rx={3}
              fill={fg}
              fillOpacity="0.04"
              stroke={muted}
              strokeOpacity="0.35"
              strokeWidth="1"
            />
            <AgentIcon agent={CURSOR} x={20} y={133} size={22} />
            <McpIcon x={52} y={135} size={16} color={muted} opacity="0.45" />
            <McpIcon x={74} y={135} size={16} color={muted} opacity="0.45" />

            {/* Laptop 3 - Codex */}
            <rect
              x={12}
              y={200}
              width={140}
              height={55}
              rx={6}
              fill={fg}
              fillOpacity="0.03"
              stroke={muted}
              strokeOpacity="0.35"
              strokeWidth="1.5"
            />
            <rect
              x={8}
              y={257}
              width={148}
              height={6}
              rx={3}
              fill={fg}
              fillOpacity="0.04"
              stroke={muted}
              strokeOpacity="0.35"
              strokeWidth="1"
            />
            <AgentIcon agent={CODEX} x={20} y={208} size={22} />
            <McpIcon x={52} y={210} size={16} color={muted} opacity="0.45" />
            <McpIcon x={74} y={210} size={16} color={muted} opacity="0.45" />

            {/* Label */}
            <text
              x="82"
              y="278"
              textAnchor="middle"
              fill={fg}
              fontSize="8"
              fontWeight="bold"
              fontFamily="system-ui,sans-serif"
            >
              Employee Laptops
            </text>
          </g>

          {/* Edison client wrapping local MCPs (staggered install) */}
          <g className="pj-iglow1">
            <rect
              x={10}
              y={48}
              width={144}
              height={59}
              rx={8}
              fill="none"
              stroke={accent}
              strokeOpacity="0.6"
              strokeWidth="2"
            />
          </g>
          <g className="pj-inst1">
            <rect
              x={48}
              y={56}
              width={72}
              height={24}
              rx={4}
              fill={accent}
              fillOpacity="0.03"
              stroke={accent}
              strokeOpacity="0.5"
              strokeWidth="1.5"
            />
            <EdisonLogo x={36} y={49} w={16} h={15.5} />
            <svg x={122} y={57} width={14} height={14} viewBox="0 0 256 256">
              <path d={SHIELD_CHECK_PATH} fill={accent} fillOpacity="0.7" />
            </svg>
          </g>
          <g className="pj-iglow2">
            <rect
              x={10}
              y={123}
              width={144}
              height={59}
              rx={8}
              fill="none"
              stroke={accent}
              strokeOpacity="0.6"
              strokeWidth="2"
            />
          </g>
          <g className="pj-inst2">
            <rect
              x={48}
              y={131}
              width={72}
              height={24}
              rx={4}
              fill={accent}
              fillOpacity="0.03"
              stroke={accent}
              strokeOpacity="0.5"
              strokeWidth="1.5"
            />
            <EdisonLogo x={36} y={124} w={16} h={15.5} />
            <svg x={122} y={132} width={14} height={14} viewBox="0 0 256 256">
              <path d={SHIELD_CHECK_PATH} fill={accent} fillOpacity="0.7" />
            </svg>
          </g>
          <g className="pj-iglow3">
            <rect
              x={10}
              y={198}
              width={144}
              height={59}
              rx={8}
              fill="none"
              stroke={accent}
              strokeOpacity="0.6"
              strokeWidth="2"
            />
          </g>
          <g className="pj-inst3">
            <rect
              x={48}
              y={206}
              width={72}
              height={24}
              rx={4}
              fill={accent}
              fillOpacity="0.03"
              stroke={accent}
              strokeOpacity="0.5"
              strokeWidth="1.5"
            />
            <EdisonLogo x={36} y={199} w={16} h={15.5} />
            <svg x={122} y={207} width={14} height={14} viewBox="0 0 256 256">
              <path d={SHIELD_CHECK_PATH} fill={accent} fillOpacity="0.7" />
            </svg>
          </g>

          {/* Shadow MCP reveal - per laptop, fades as Edison installs */}
          <g className="pj-shad1">
            {[52, 74, 96].map((mx) => (
              <rect
                key={`s1-${mx}`}
                className="pj-sglow"
                x={mx - 2}
                y={56}
                width={20}
                height={20}
                rx={3}
                fill={O}
                fillOpacity="0.08"
                stroke={O}
                strokeOpacity="0.5"
                strokeWidth="1"
              />
            ))}
            <text
              x={52}
              y={88}
              fill={O}
              fontSize="6.5"
              fontWeight="bold"
              fontFamily="ui-monospace,monospace"
              fillOpacity="0.8"
            >
              shadow MCPs
            </text>
          </g>
          <g className="pj-shad2">
            {[52, 74].map((mx) => (
              <rect
                key={`s2-${mx}`}
                className="pj-sglow"
                x={mx - 2}
                y={131}
                width={20}
                height={20}
                rx={3}
                fill={O}
                fillOpacity="0.08"
                stroke={O}
                strokeOpacity="0.5"
                strokeWidth="1"
              />
            ))}
            <text
              x={52}
              y={163}
              fill={O}
              fontSize="6.5"
              fontWeight="bold"
              fontFamily="ui-monospace,monospace"
              fillOpacity="0.8"
            >
              shadow MCPs
            </text>
          </g>
          <g className="pj-shad3">
            {[52, 74].map((mx) => (
              <rect
                key={`s3-${mx}`}
                className="pj-sglow"
                x={mx - 2}
                y={206}
                width={20}
                height={20}
                rx={3}
                fill={O}
                fillOpacity="0.08"
                stroke={O}
                strokeOpacity="0.5"
                strokeWidth="1"
              />
            ))}
            <text
              x={52}
              y={238}
              fill={O}
              fontSize="6.5"
              fontWeight="bold"
              fontFamily="ui-monospace,monospace"
              fillOpacity="0.8"
            >
              shadow MCPs
            </text>
          </g>

          {/* Scan line (phase 1 - after installs) */}
          <g className="pj-scan">
            <line
              x1={14}
              y1={50}
              x2={150}
              y2={50}
              stroke={accent}
              strokeOpacity="0.5"
              strokeWidth="1.5"
            />
            <rect x={14} y={50} width={136} height={3} rx={1} fill={accent} fillOpacity="0.06" />
          </g>
        </g>

        {/* ══ Admin (always visible from Phase 1+) ══ */}
        <g className="pj-p1">
          <svg x={337} y={52} width={24} height={24} viewBox="0 0 256 256">
            <path d={ADMIN_PATH} fill={fg} fillOpacity="0.7" />
          </svg>
          <text
            x="350"
            y="78"
            textAnchor="middle"
            fill={fg}
            fillOpacity="0.7"
            fontSize="8"
            fontWeight="bold"
            fontFamily="system-ui,sans-serif"
          >
            Admin
          </text>
        </g>

        {/* ══ PHASE 1: No visibility (fades when Edison arrives) ══ */}
        <g className="pj-blind">
          <svg x={338} y={82} width={22} height={22} viewBox="0 0 256 256">
            <path d={EYE_SLASH_PATH} fill={DANGER} fillOpacity="0.7" />
          </svg>
          <text
            x="350"
            y="112"
            textAnchor="middle"
            fill={DANGER}
            fillOpacity="0.6"
            fontSize="8"
            fontFamily="system-ui,sans-serif"
          >
            No visibility
          </text>
          <line
            x1="335"
            y1="70"
            x2="160"
            y2="78"
            stroke={DANGER}
            strokeOpacity="0.5"
            strokeWidth="1.5"
            strokeDasharray="4 3"
          />
          <line
            x1="335"
            y1="70"
            x2="160"
            y2="153"
            stroke={DANGER}
            strokeOpacity="0.5"
            strokeWidth="1.5"
            strokeDasharray="4 3"
          />
          <line
            x1="335"
            y1="70"
            x2="160"
            y2="228"
            stroke={DANGER}
            strokeOpacity="0.5"
            strokeWidth="1.5"
            strokeDasharray="4 3"
          />
          {[78, 153, 228].map((ly) => (
            <svg key={ly} x={162} y={ly - 10} width={20} height={20} viewBox="0 0 256 256">
              <path d={EYE_SLASH_PATH} fill={DANGER} fillOpacity="0.5" />
            </svg>
          ))}
        </g>

        {/* ══ PHASE 2+: Admin gains full visibility ══ */}
        <g className="pj-p2">
          <svg x={338} y={82} width={22} height={22} viewBox="0 0 256 256">
            <path d={EYE_PATH} fill={accent} fillOpacity="0.85" />
          </svg>
          <text
            x="350"
            y="112"
            textAnchor="middle"
            fill={accent}
            fillOpacity="0.85"
            fontSize="8"
            fontWeight="bold"
            fontFamily="system-ui,sans-serif"
          >
            Full visibility
          </text>
          {/* Lines + eye icons to laptops: hidden in Phase 4 with laptops */}
          <g className="pj-pre4">
            <line
              x1="335"
              y1="95"
              x2="160"
              y2="78"
              stroke={accent}
              strokeOpacity="0.4"
              strokeWidth="1.5"
              strokeDasharray="4 3"
            />
            <line
              x1="335"
              y1="95"
              x2="160"
              y2="153"
              stroke={accent}
              strokeOpacity="0.4"
              strokeWidth="1.5"
              strokeDasharray="4 3"
            />
            <line
              x1="335"
              y1="95"
              x2="160"
              y2="228"
              stroke={accent}
              strokeOpacity="0.4"
              strokeWidth="1.5"
              strokeDasharray="4 3"
            />
            {[78, 153, 228].map((ly) => (
              <svg key={ly} x={162} y={ly - 10} width={20} height={20} viewBox="0 0 256 256">
                <path d={EYE_PATH} fill={accent} fillOpacity="0.65" />
              </svg>
            ))}
          </g>
        </g>

        {/* ══ PHASE 1: Direct connections to tools (unmonitored) ══ */}
        <g className="pj-blind">
          <line
            className="pj-line"
            x1="158"
            y1="78"
            x2="540"
            y2="78"
            stroke={muted}
            strokeOpacity="0.5"
            strokeWidth="1.5"
            strokeDasharray="3 3"
          />
          <line
            className="pj-line"
            x1="158"
            y1="78"
            x2="540"
            y2="153"
            stroke={muted}
            strokeOpacity="0.5"
            strokeWidth="1.5"
            strokeDasharray="3 3"
          />
          <line
            className="pj-line"
            x1="158"
            y1="153"
            x2="540"
            y2="153"
            stroke={muted}
            strokeOpacity="0.5"
            strokeWidth="1.5"
            strokeDasharray="3 3"
          />
          <line
            className="pj-line"
            x1="158"
            y1="153"
            x2="540"
            y2="228"
            stroke={muted}
            strokeOpacity="0.5"
            strokeWidth="1.5"
            strokeDasharray="3 3"
          />
          <line
            className="pj-line"
            x1="158"
            y1="228"
            x2="540"
            y2="153"
            stroke={muted}
            strokeOpacity="0.5"
            strokeWidth="1.5"
            strokeDasharray="3 3"
          />
          <line
            className="pj-line"
            x1="158"
            y1="228"
            x2="540"
            y2="228"
            stroke={muted}
            strokeOpacity="0.5"
            strokeWidth="1.5"
            strokeDasharray="3 3"
          />
        </g>

        {/* ══ CENTER: Edison Gateway (Phase 2+) ══ */}
        <g className="pj-edison">
          <circle
            className="pj-pulse"
            cx={350}
            cy={153}
            r={28}
            fill="none"
            stroke={accent}
            strokeOpacity="0.5"
            strokeWidth="1.5"
          />
          <EdisonLogo x={323} y={127} w={54} h={52.5} />
          <text
            x="350"
            y="195"
            textAnchor="middle"
            fill={fg}
            fontSize="9"
            fontWeight="bold"
            fontFamily="system-ui,sans-serif"
          >
            Edison Gateway
          </text>
        </g>

        {/* Shield badge (Phase 3+) */}
        <g className="pj-p3">
          <svg x={385} y={123} width={16} height={16} viewBox="0 0 256 256">
            <path d={SHIELD_CHECK_PATH} fill={accent} fillOpacity="0.7" />
          </svg>
          {/* Policy engine icon below gateway */}
          <svg x={339} y={198} width={22} height={22} viewBox="0 0 256 256">
            <path d={SCALES_PATH} fill={accent} fillOpacity="0.8" />
          </svg>
          <text
            x="350"
            y="228"
            textAnchor="middle"
            fill={accent}
            fillOpacity="0.8"
            fontSize="7.5"
            fontWeight="bold"
            fontFamily="system-ui,sans-serif"
          >
            Policy Engine
          </text>
        </g>

        {/* ══ CONNECTION LINES (Phase 2+) ══ */}
        <g className="pj-p2">
          {/* Laptop → Edison lines: hidden in Phase 4 with laptops */}
          <g className="pj-pre4">
            <line
              className="pj-line"
              x1="158"
              y1="78"
              x2="322"
              y2="153"
              stroke={muted}
              strokeOpacity="0.4"
              strokeWidth="1.5"
              strokeDasharray="3 3"
            />
            <line
              className="pj-line"
              x1="158"
              y1="153"
              x2="322"
              y2="153"
              stroke={muted}
              strokeOpacity="0.4"
              strokeWidth="1.5"
              strokeDasharray="3 3"
            />
            <line
              className="pj-line"
              x1="158"
              y1="228"
              x2="322"
              y2="153"
              stroke={muted}
              strokeOpacity="0.4"
              strokeWidth="1.5"
              strokeDasharray="3 3"
            />
          </g>
          {/* Edison → Tools lines: persist through Phase 4 */}
          <line
            className="pj-line"
            x1="378"
            y1="153"
            x2="540"
            y2="78"
            stroke={accent}
            strokeOpacity="0.4"
            strokeWidth="1.5"
            strokeDasharray="3 3"
          />
          <line
            className="pj-line"
            x1="378"
            y1="153"
            x2="540"
            y2="153"
            stroke={accent}
            strokeOpacity="0.4"
            strokeWidth="1.5"
            strokeDasharray="3 3"
          />
          <line
            className="pj-line"
            x1="378"
            y1="153"
            x2="540"
            y2="228"
            stroke={accent}
            strokeOpacity="0.4"
            strokeWidth="1.5"
            strokeDasharray="3 3"
          />
        </g>

        {/* ══ RIGHT: Enterprise Tools (Phase 1+) ══ */}
        <g className="pj-p1">
          <rect
            x={540}
            y={56}
            width={56}
            height={44}
            rx={6}
            fill={fg}
            fillOpacity="0.03"
            stroke={muted}
            strokeOpacity="0.35"
            strokeWidth="1"
          />
          <McpIcon x={556} y={66} size={24} color={muted} opacity="0.6" />
          <text
            x={568}
            y={112}
            textAnchor="middle"
            fill={muted}
            fontSize="7.5"
            fontFamily="system-ui,sans-serif"
          >
            Email
          </text>

          <rect
            x={540}
            y={131}
            width={56}
            height={44}
            rx={6}
            fill={fg}
            fillOpacity="0.03"
            stroke={muted}
            strokeOpacity="0.35"
            strokeWidth="1"
          />
          <McpIcon x={556} y={141} size={24} color={muted} opacity="0.6" />
          <text
            x={568}
            y={187}
            textAnchor="middle"
            fill={muted}
            fontSize="7.5"
            fontFamily="system-ui,sans-serif"
          >
            Docs
          </text>

          <rect
            x={540}
            y={206}
            width={56}
            height={44}
            rx={6}
            fill={fg}
            fillOpacity="0.03"
            stroke={muted}
            strokeOpacity="0.35"
            strokeWidth="1"
          />
          <McpIcon x={556} y={216} size={24} color={muted} opacity="0.6" />
          <text
            x={568}
            y={262}
            textAnchor="middle"
            fill={muted}
            fontSize="7.5"
            fontFamily="system-ui,sans-serif"
          >
            Data
          </text>

          <text
            x="568"
            y="278"
            textAnchor="middle"
            fill={fg}
            fontSize="8"
            fontWeight="bold"
            fontFamily="system-ui,sans-serif"
          >
            Enterprise Tools
          </text>
        </g>

        {/* ══ VERDICT BADGES (Phase 3+) ══ */}
        <g className="pj-vd" style={{ transformOrigin: '320px 168px' }}>
          <circle
            cx={320}
            cy={168}
            r={8}
            fill={DANGER}
            fillOpacity="0.12"
            stroke={DANGER}
            strokeOpacity="0.5"
            strokeWidth="1"
          />
          <line
            x1={316.5}
            y1={164.5}
            x2={323.5}
            y2={171.5}
            stroke={DANGER}
            strokeWidth="1.6"
            strokeLinecap="round"
          />
          <line
            x1={323.5}
            y1={164.5}
            x2={316.5}
            y2={171.5}
            stroke={DANGER}
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </g>
        <g className="pj-va" style={{ transformOrigin: '320px 138px' }}>
          <circle
            cx={320}
            cy={138}
            r={8}
            fill={accent}
            fillOpacity="0.12"
            stroke={accent}
            strokeOpacity="0.5"
            strokeWidth="1"
          />
          <polyline
            points="315.5,138 318,140.5 324.5,134"
            fill="none"
            stroke={accent}
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>

        {/* ══ PHASE 4: Department rows (ScalePilot-style org-wide) ══ */}
        <g className="pj-p4">
          {/* 5 department rows replace the 3 laptops */}
          {DEPTS.map((dept) => {
            const y = dept.y
            return (
              <g key={dept.label}>
                {/* Row pill */}
                <rect
                  x={8}
                  y={y}
                  width={180}
                  height={28}
                  rx={6}
                  fill={fg}
                  fillOpacity="0.03"
                  stroke={accent}
                  strokeOpacity="0.35"
                  strokeWidth="1"
                />
                {/* Dept label */}
                <text
                  x={16}
                  y={y + 18}
                  fill={fg}
                  fontSize="8"
                  fontWeight="bold"
                  fontFamily="system-ui,sans-serif"
                >
                  {dept.label}
                </text>
                {/* Agent icon */}
                <AgentIcon agent={dept.agent} x={82} y={y + 4} size={20} />
                {/* Headcount pips */}
                {Array.from({ length: dept.pips }).map((_, i) => {
                  const px = 106 + i * 15
                  const py = y + 8
                  return (
                    <g key={i}>
                      <rect
                        x={px}
                        y={py}
                        width={12}
                        height={12}
                        rx={3}
                        fill={accent}
                        fillOpacity="0.12"
                        stroke={accent}
                        strokeOpacity="0.45"
                        strokeWidth="0.8"
                      />
                      <circle cx={px + 6} cy={py + 4} r="2.2" fill={accent} fillOpacity="0.7" />
                      <path
                        d={`M ${px + 2} ${py + 10} Q ${px + 6} ${py + 7} ${px + 10} ${py + 10}`}
                        fill="none"
                        stroke={accent}
                        strokeOpacity="0.7"
                        strokeWidth="1"
                      />
                    </g>
                  )
                })}
              </g>
            )
          })}

          {/* Connection lines: all 5 dept rows → Edison */}
          {DEPTS.map((dept) => (
            <line
              key={dept.label}
              className="pj-line"
              x1="190"
              y1={dept.y + 14}
              x2="322"
              y2="153"
              stroke={accent}
              strokeOpacity="0.6"
              strokeWidth="1.5"
              strokeDasharray="3 3"
            />
          ))}

          {/* Label */}
          <text
            x="85"
            y="252"
            textAnchor="middle"
            fill={accent}
            fillOpacity="0.85"
            fontSize="8"
            fontWeight="bold"
            fontFamily="system-ui,sans-serif"
          >
            Every team, every tool
          </text>
        </g>

        {/* ══ PACKETS ══ */}
        <g className="pj-pkt pj-pkt0">
          <McpPacket />
        </g>
        <g className="pj-pkt pj-pkt1">
          <McpPacket />
        </g>
        <g className="pj-pkt pj-pkt2">
          <McpPacket />
        </g>
        <g className="pj-pkt pj-pkt3">
          <McpPacket />
        </g>
        <g className="pj-pkt pj-pkt4">
          <McpPacket />
        </g>

        {/* ══ PROGRESS BAR ══ */}
        <ProgressBar y={292} width={660} className="pj-progress" />
      </svg>
    </div>
  )
}
