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
 *          The Phase 2 scene is the standalone {@link AdminFleetGovernedAnimation},
 *          whose building blocks (routed lines, full-visibility overlay,
 *          local Edison wrappers, policy icon) are re-imported here.
 *
 * 12s loop. Pure SVG + CSS. Respects `prefers-reduced-motion`.
 */
import { useId } from 'react'
import { AGENT_REGISTRY } from '../../agent-registry/index'
import {
  AdminFigure,
  DANGER,
  EdisonGateway,
  McpPacket,
  ORANGE as O,
  ProgressBar,
  VerdictBadge
} from '../_shared'
import {
  AdminNoVisibilityOverlay,
  FleetDirectLines,
  GITHUB_SVG,
  Laptop,
  McpServer,
  onedriveSvg,
  SLACK_SVG
} from './AdminFleetBlindAnimation'
import {
  AdminFullVisibilityOverlay,
  FleetLocalWrappers,
  FleetPolicyIcon,
  FleetRoutedLines
} from './AdminFleetGovernedAnimation'

const CURSOR = AGENT_REGISTRY['cursor']
const CLAUDE = AGENT_REGISTRY['claude-code']
const CODEX = AGENT_REGISTRY['codex']

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
.afc.anim-static .afc-line, .afc.anim-static .afc-pkt-p1, .afc.anim-static .afc-pkt1, .afc.anim-static .afc-pkt2, .afc.anim-static .afc-pkt3,
.afc.anim-static .afc-pulse, .afc.anim-static .afc-direct, .afc.anim-static .afc-edison,
.afc.anim-static .afc-routed, .afc.anim-static .afc-v1, .afc.anim-static .afc-v2, .afc.anim-static .afc-v3 { animation:none; }
.afc.anim-static .afc-pkt-p1, .afc.anim-static .afc-pkt1, .afc.anim-static .afc-pkt2, .afc.anim-static .afc-pkt3 { opacity:0; }
.afc.anim-static .afc-progress { animation:none; transform:scaleX(1); }
.afc.anim-static .afc-edison { opacity:1; transform:scale(1); }
.afc.anim-static .afc-direct { opacity:0; }
.afc.anim-static .afc-routed { opacity:1; }
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
        <AdminFigure cx={340} y={2} size={26} />

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
          <EdisonGateway
            cx={340}
            cy={130}
            r={30}
            logoW={54}
            pulseClassName="afc-pulse"
            label="Edison Watch"
          />
          <AdminFullVisibilityOverlay />
        </g>

        {/* ══ Phase 2: routed connection lines ══ */}
        <g className="afc-routed">
          <FleetRoutedLines lineClassName="afc-line" />
        </g>

        {/* ══ 3 Laptops (always visible) ══ */}
        <Laptop y={5} agents={[CLAUDE]} />
        <Laptop y={105} agents={[CODEX]} />
        <Laptop y={205} agents={[CURSOR]} />

        {/* ══ Local Edison wrapper + shield on each laptop (Phase 2) ══ */}
        <g className="afc-routed">
          <FleetLocalWrappers />
        </g>

        {/* ══ Policy verdicts near Edison (Phase 2, staggered) ══ */}
        <VerdictBadge className="afc-v1" cx={290} cy={108} r={9} variant="allow" />
        <VerdictBadge className="afc-v2" cx={290} cy={130} r={9} variant="allow" />
        <VerdictBadge className="afc-v3" cx={290} cy={152} r={9} variant="deny" />
        {/* Policy icon near Edison */}
        <g className="afc-routed">
          <FleetPolicyIcon />
        </g>

        {/* ══ 3 MCP servers (always visible) ══ */}
        <McpServer x={560} y={25} iconSvg={GITHUB_SVG} iconViewBox="0 0 1024 1024" />
        <McpServer x={560} y={105} iconSvg={SLACK_SVG} iconViewBox="0 0 2447.6 2452.5" />
        <McpServer x={560} y={185} iconSvg={odSvg} iconViewBox="0 0 1000 615" />

        {/* ══ Packets ══ */}
        <g className="afc-pkt afc-pkt-p1">
          <McpPacket />
        </g>
        <g className="afc-pkt afc-pkt1">
          <McpPacket />
        </g>
        <g className="afc-pkt afc-pkt2">
          <McpPacket />
        </g>
        <g className="afc-pkt afc-pkt3">
          <McpPacket />
        </g>

        {/* ══ Progress bar ══ */}
        <ProgressBar y={275} width={640} className="afc-progress" />
      </svg>
    </div>
  )
}
