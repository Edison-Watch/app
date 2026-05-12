/**
 * Admin Fleet Control animation for documentation.
 *
 * Phase 1 - "Blind": Three employee laptops with AI agents connect
 *          directly to MCP servers. The admin has NO visibility.
 *          The Phase 1 scene is the standalone {@link AdminFleetBlindAnimation},
 *          whose building blocks (laptops, servers, no-visibility overlay,
 *          direct connection lines) are re-imported here.
 * Transition: Edison Watch fades in as a central gateway.
 * Phase 2 - "Control": All connections route through Edison. The admin
 *          gains full visibility with local Edison wrappers on each
 *          laptop and policy enforcement (accept/deny) at the gateway.
 *
 * 12s loop. Pure SVG + CSS. Respects `prefers-reduced-motion`.
 */
import { useId } from 'react'
import { AGENT_REGISTRY } from '../../agent-registry/index'
import {
  ADMIN_PATH, DANGER, EdisonLogo, EYE_PATH,
  McpPacket, ORANGE as O, ProgressBar, SHIELD_CHECK_PATH,
} from '../_shared'
import {
  AdminNoVisibilityOverlay, FleetDirectLines, GITHUB_SVG, Laptop,
  McpServer, onedriveSvg, SLACK_SVG,
} from './AdminFleetBlindAnimation'

const CURSOR = AGENT_REGISTRY['cursor']
const CLAUDE = AGENT_REGISTRY['claude-code']
const CODEX = AGENT_REGISTRY['codex']

const POLICY_D =
  'M208,40H48A16,16,0,0,0,32,56v56c0,52.72,25.52,84.67,46.93,102.19,23.06,18.86,46,25.26,47,25.53a8,8,0,0,0,4.2,0c1-.27,23.91-6.67,47-25.53C198.48,196.67,224,164.72,224,112V56A16,16,0,0,0,208,40Zm0,72c0,37.07-13.66,67.16-40.6,89.42A129.3,129.3,0,0,1,128,223.62a128.25,128.25,0,0,1-38.92-21.81C61.82,179.51,48,149.3,48,112l0-56,160,0ZM96,104a8,8,0,0,1,8-8h64a8,8,0,0,1,0,16H104A8,8,0,0,1,96,104Zm8,40h64a8,8,0,0,0,0-16H104a8,8,0,0,0,0,16Z'

const CSS = `
.afc { color: var(--text-primary); }

.afc .afc-line { stroke-dashoffset:0; animation: afc-lf 2s linear infinite; }
.afc .afc-pkt path, .afc .afc-pkt circle { fill: currentColor; }

/* ── phase visibility (12s cycle) ── */
.afc .afc-direct  { animation: afc-dv 12s ease-in-out infinite; }
.afc .afc-edison  { animation: afc-ev 12s ease-in-out infinite; transform-origin: 340px 130px; }
.afc .afc-routed  { animation: afc-rv 12s ease-in-out infinite; }
/* packets */
.afc .afc-pkt-p1 { color:${O}; animation: afc-pkt-p1 12s ease-in-out infinite; }
.afc .afc-pkt1   { color:${O}; animation: afc-pkt1 12s ease-in-out infinite; }
.afc .afc-pkt2   { color:${O}; animation: afc-pkt2 12s ease-in-out infinite; }
.afc .afc-pkt3   { color:${O}; animation: afc-pkt3 12s ease-in-out infinite; }
.afc .afc-pulse { transform-origin:340px 130px; animation: afc-pulse 1.33s cubic-bezier(.2,.8,.4,1) infinite; }

/* ───── keyframes ───── */
@keyframes afc-lf { to { stroke-dashoffset: -12; } }

/* Phase 1 visible, then hidden - holds until ~48% */
@keyframes afc-dv {
  0%,46%  { opacity:1; }
  54%     { opacity:0; }
  100%    { opacity:0; }
}
/* Edison fades in at ~50% */
@keyframes afc-ev {
  0%,48%  { opacity:0; transform:scale(.85); }
  56%     { opacity:1; transform:scale(1); }
  100%    { opacity:1; transform:scale(1); }
}
/* Phase 2 visible at ~56% */
@keyframes afc-rv {
  0%,48%  { opacity:0; }
  56%     { opacity:1; }
  100%    { opacity:1; }
}

/* policy verdict badges - synced to packet arrivals */
.afc .afc-v1 { animation: afc-v1 12s ease-in-out infinite; }
.afc .afc-v2 { animation: afc-v2 12s ease-in-out infinite; }
.afc .afc-v3 { animation: afc-v3 12s ease-in-out infinite; }
@keyframes afc-v1 {
  0%,62% { opacity:0; transform:scale(0.5); }
  65%    { opacity:1; transform:scale(1); }
  100%   { opacity:1; transform:scale(1); }
}
@keyframes afc-v2 {
  0%,69% { opacity:0; transform:scale(0.5); }
  72%    { opacity:1; transform:scale(1); }
  100%   { opacity:1; transform:scale(1); }
}
@keyframes afc-v3 {
  0%,76% { opacity:0; transform:scale(0.5); }
  79%    { opacity:1; transform:scale(1); }
  100%   { opacity:1; transform:scale(1); }
}

/* ── Phase 1 packet: direct round-trip L2 ↔ S2 ── */
@keyframes afc-pkt-p1 {
  0%,2%   { opacity:0; }
  3%      { transform:translate(120px,133px); opacity:0;  color:${O}; }
  4%      { transform:translate(120px,133px); opacity:.8; color:${O}; }
  18%     { transform:translate(560px,127px); opacity:1;  color:${O}; }
  19%     { transform:translate(560px,127px); opacity:.6; color:${O}; }
  21%     { transform:translate(560px,127px); opacity:.8; color:${O}; }
  35%     { transform:translate(120px,133px); opacity:1;  color:${O}; }
  36%     { transform:translate(120px,133px); opacity:0; }
  37%,100%{ opacity:0; }
}

/* ── Phase 2 pkt1: L1 → Edison → GitHub (allowed) ── */
@keyframes afc-pkt1 {
  0%,57%  { opacity:0; }
  58%     { transform:translate(120px,33px);  opacity:.8; color:${O}; }
  63%     { transform:translate(310px,130px); opacity:1;  color:${O}; }
  64%     { transform:translate(340px,130px); opacity:.3; color:var(--accent); }
  65%     { transform:translate(370px,130px); opacity:1;  color:var(--accent); }
  73%     { transform:translate(560px,47px);  opacity:1;  color:var(--accent); }
  74%     { transform:translate(560px,47px);  opacity:0; }
  75%,100%{ opacity:0; }
}

/* ── Phase 2 pkt2: L2 → Edison → Slack (allowed) ── */
@keyframes afc-pkt2 {
  0%,64%  { opacity:0; }
  65%     { transform:translate(120px,133px); opacity:.8; color:${O}; }
  70%     { transform:translate(310px,130px); opacity:1;  color:${O}; }
  71%     { transform:translate(340px,130px); opacity:.3; color:var(--accent); }
  72%     { transform:translate(370px,130px); opacity:1;  color:var(--accent); }
  80%     { transform:translate(560px,127px); opacity:1;  color:var(--accent); }
  81%     { transform:translate(560px,127px); opacity:0; }
  82%,100%{ opacity:0; }
}

/* ── Phase 2 pkt3: L3 → Edison → DENIED ── */
@keyframes afc-pkt3 {
  0%,71%  { opacity:0; }
  72%     { transform:translate(120px,233px); opacity:.8; color:${O}; }
  77%     { transform:translate(305px,135px); opacity:1;  color:${O}; }
  78%     { transform:translate(305px,135px); opacity:.6; color:${DANGER}; }
  80%     { transform:translate(305px,135px); opacity:0;  color:${DANGER}; }
  81%,100%{ opacity:0; }
}

@keyframes afc-pulse {
  0%   { transform:scale(1);   opacity:0; }
  10%  { transform:scale(1);   opacity:.4; }
  60%  { transform:scale(1.6); opacity:0; }
  100% { transform:scale(1.6); opacity:0; }
}

/* progress bar */
.afc .afc-progress { transform-origin:20px 275px; animation: afc-prog 12s linear infinite; }
@keyframes afc-prog {
  0%   { transform:scaleX(0); }
  100% { transform:scaleX(1); }
}

@media (prefers-reduced-motion:reduce) {
  .afc .afc-line, .afc .afc-pkt-p1, .afc .afc-pkt1, .afc .afc-pkt2, .afc .afc-pkt3,
  .afc .afc-pulse, .afc .afc-direct, .afc .afc-edison,
  .afc .afc-routed, .afc .afc-v1, .afc .afc-v2, .afc .afc-v3 { animation:none; }
  .afc .afc-pkt-p1, .afc .afc-pkt1, .afc .afc-pkt2, .afc .afc-pkt3 { opacity:0; }
  .afc .afc-progress { animation:none; transform:scaleX(1); }
  .afc .afc-edison { opacity:1; transform:scale(1); }
  .afc .afc-direct { opacity:0; }
  .afc .afc-routed { opacity:1; }
}
`

export default function AdminFleetAnimation(): React.ReactNode {
  const id = useId()
  const odSvg = onedriveSvg(id)
  return (
    <div className="flex justify-center">
      <style>{CSS}</style>
      <svg
        className="afc"
        width={680}
        height={280}
        viewBox="0 0 680 280"
        xmlns="http://www.w3.org/2000/svg"
        role="presentation"
        aria-hidden="true"
      >
        {/* ══ Admin icon (always visible) ══ */}
        <g>
          <svg x={327} y={2} width={26} height={26} viewBox="0 0 256 256">
            <path d={ADMIN_PATH} fill="var(--text-primary)" fillOpacity="0.7" />
          </svg>
          <text x="340" y="40" textAnchor="middle"
            fill="var(--text-primary)" fontSize="8" fontWeight="bold" fontFamily="system-ui,sans-serif">
            Admin
          </text>
        </g>

        {/* ══ Phase 1: admin has no visibility ══ */}
        <g className="afc-direct">
          <AdminNoVisibilityOverlay />
        </g>

        {/* ══ Phase 1: direct connection lines (laptops → servers) ══ */}
        <g className="afc-direct">
          <FleetDirectLines lineClassName="afc-line" />
        </g>

        {/* ══ Edison gateway (fades in for phase 2) ══ */}
        <g className="afc-edison">
          <circle className="afc-pulse" cx="340" cy="130" r="30"
            fill="none" stroke="var(--accent)" strokeOpacity="0.5" strokeWidth="1.5" />
          <EdisonLogo x={313} y={104} w={54} h={52.5} />
          {/* Large eye under admin - full visibility */}
          <svg x={322} y={46} width={36} height={36} viewBox="0 0 256 256">
            <path d={EYE_PATH} fill="var(--accent)" fillOpacity="0.85" />
          </svg>
          <text x="340" y="94" textAnchor="middle"
            fill="var(--accent)" fillOpacity="0.85" fontSize="8" fontWeight="bold" fontFamily="system-ui,sans-serif">
            Full visibility
          </text>
          <text x="340" y="175" textAnchor="middle"
            fill="var(--text-primary)" fontSize="9" fontWeight="bold" fontFamily="system-ui,sans-serif">
            Edison Watch
          </text>
        </g>

        {/* ══ Phase 2: routed connection lines ══ */}
        <g className="afc-routed">
          {/* Laptops → Edison */}
          <line className="afc-line" x1="120" y1="33" x2="310" y2="130"
            stroke="var(--text-muted)" strokeOpacity="0.5" strokeWidth="1.5" strokeDasharray="3 3" />
          <line className="afc-line" x1="120" y1="133" x2="310" y2="130"
            stroke="var(--text-muted)" strokeOpacity="0.5" strokeWidth="1.5" strokeDasharray="3 3" />
          <line className="afc-line" x1="120" y1="233" x2="310" y2="130"
            stroke="var(--text-muted)" strokeOpacity="0.5" strokeWidth="1.5" strokeDasharray="3 3" />
          {/* Edison → servers (accent) */}
          <line className="afc-line" x1="370" y1="130" x2="560" y2="47"
            stroke="var(--accent)" strokeOpacity="0.5" strokeWidth="1.5" strokeDasharray="3 3" />
          <line className="afc-line" x1="370" y1="130" x2="560" y2="127"
            stroke="var(--accent)" strokeOpacity="0.5" strokeWidth="1.5" strokeDasharray="3 3" />
          <line className="afc-line" x1="370" y1="130" x2="560" y2="207"
            stroke="var(--accent)" strokeOpacity="0.5" strokeWidth="1.5" strokeDasharray="3 3" />
        </g>

        {/* ══ 3 Laptops (always visible) ══ */}
        <Laptop y={5} agents={[CLAUDE]} />
        <Laptop y={105} agents={[CODEX]} />
        <Laptop y={205} agents={[CURSOR]} />

        {/* ══ Local Edison wrapper + shield on each laptop (Phase 2) ══ */}
        <g className="afc-routed">
          {[5, 105, 205].map((ly) => (
            <g key={ly}>
              <rect x={22} y={ly + 31} width={76} height={24} rx={4}
                fill="var(--accent)" fillOpacity="0.03"
                stroke="var(--accent)" strokeOpacity="0.5" strokeWidth="1.5" />
              <EdisonLogo x={10} y={ly + 24} w={16} h={15.5} />
              <svg x={100} y={ly + 33} width={14} height={14} viewBox="0 0 256 256">
                <path d={SHIELD_CHECK_PATH} fill="var(--accent)" fillOpacity="0.7" />
              </svg>
            </g>
          ))}
        </g>

        {/* ══ Policy verdicts near Edison (Phase 2, staggered) ══ */}
        {/* Laptop 1 → allowed */}
        <g className="afc-v1" style={{ transformOrigin: '290px 108px' }}>
          <circle cx="290" cy="108" r="9"
            fill="var(--accent)" fillOpacity="0.12" stroke="var(--accent)" strokeOpacity="0.5" strokeWidth="1" />
          <polyline points="285,108 288,111 295,104"
            fill="none" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </g>
        {/* Laptop 2 → allowed */}
        <g className="afc-v2" style={{ transformOrigin: '290px 130px' }}>
          <circle cx="290" cy="130" r="9"
            fill="var(--accent)" fillOpacity="0.12" stroke="var(--accent)" strokeOpacity="0.5" strokeWidth="1" />
          <polyline points="285,130 288,133 295,126"
            fill="none" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </g>
        {/* Laptop 3 → denied */}
        <g className="afc-v3" style={{ transformOrigin: '290px 152px' }}>
          <circle cx="290" cy="152" r="9"
            fill={DANGER} fillOpacity="0.12" stroke={DANGER} strokeOpacity="0.5" strokeWidth="1" />
          <line x1="286" y1="148" x2="294" y2="156" stroke={DANGER} strokeWidth="1.8" strokeLinecap="round" />
          <line x1="294" y1="148" x2="286" y2="156" stroke={DANGER} strokeWidth="1.8" strokeLinecap="round" />
        </g>
        {/* Policy icon near Edison */}
        <g className="afc-routed">
          <svg x={355} y={155} width={18} height={18} viewBox="0 0 256 256">
            <path d={POLICY_D} fill="var(--text-primary)" fillOpacity="0.45" />
          </svg>
        </g>

        {/* ══ 3 MCP servers (always visible) ══ */}
        <McpServer x={560} y={25} iconSvg={GITHUB_SVG} iconViewBox="0 0 1024 1024" />
        <McpServer x={560} y={105} iconSvg={SLACK_SVG} iconViewBox="0 0 2447.6 2452.5" />
        <McpServer x={560} y={185} iconSvg={odSvg} iconViewBox="0 0 1000 615" />

{/* ══ Packets ══ */}
        <g className="afc-pkt afc-pkt-p1"><McpPacket /></g>
        <g className="afc-pkt afc-pkt1"><McpPacket /></g>
        <g className="afc-pkt afc-pkt2"><McpPacket /></g>
        <g className="afc-pkt afc-pkt3"><McpPacket /></g>

        {/* ══ Progress bar ══ */}
        <ProgressBar y={275} width={640} className="afc-progress" />
      </svg>
    </div>
  )
}
