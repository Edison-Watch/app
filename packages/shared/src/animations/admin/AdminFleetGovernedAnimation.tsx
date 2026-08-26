/**
 * Admin Fleet "Governed" animation for documentation.
 *
 * Standalone slice of the second half of {@link AdminFleetAnimation}: every
 * employee laptop routes through a central SealGate gateway. The admin has
 * FULL visibility, each laptop carries a local SealGate wrapper, and the gateway
 * approves two requests and blocks one - staggered verdict badges make the
 * accept/deny decisions legible.
 *
 * Pure SVG + CSS. Respects `prefers-reduced-motion`.
 *
 * Reusable building blocks (routed lines, full-visibility overlay, local
 * SealGate wrappers, policy icon) are exported so the full
 * {@link AdminFleetAnimation} can re-use them for its Phase 2 frames.
 */
import { useId } from 'react'
import { AGENT_REGISTRY } from '../../agent-registry/index'
import {
  AdminFigure,
  DANGER,
  BrandGateway,
  SealGateLogo,
  EYE_PATH,
  FlowLine,
  McpPacket,
  ORANGE as O,
  ProgressBar,
  SHIELD_CHECK_PATH,
  VerdictBadge
} from '../_shared'
import { GITHUB_SVG, Laptop, McpServer, onedriveSvg, SLACK_SVG } from './AdminFleetBlindAnimation'

const CURSOR = AGENT_REGISTRY['cursor']
const CLAUDE = AGENT_REGISTRY['claude-code']
const CODEX = AGENT_REGISTRY['codex']

const POLICY_D =
  'M208,40H48A16,16,0,0,0,32,56v56c0,52.72,25.52,84.67,46.93,102.19,23.06,18.86,46,25.26,47,25.53a8,8,0,0,0,4.2,0c1-.27,23.91-6.67,47-25.53C198.48,196.67,224,164.72,224,112V56A16,16,0,0,0,208,40Zm0,72c0,37.07-13.66,67.16-40.6,89.42A129.3,129.3,0,0,1,128,223.62a128.25,128.25,0,0,1-38.92-21.81C61.82,179.51,48,149.3,48,112l0-56,160,0ZM96,104a8,8,0,0,1,8-8h64a8,8,0,0,1,0,16H104A8,8,0,0,1,96,104Zm8,40h64a8,8,0,0,0,0-16H104a8,8,0,0,0,0,16Z'

const CSS = `
.afg { color: var(--text-primary); }

.afg .afg-line { stroke-dashoffset:0; animation: afg-lf 2s linear infinite; }
.afg .afg-pkt path, .afg .afg-pkt circle { fill: currentColor; }
.afg .afg-pkt1 { color:${O}; animation: afg-pkt1 6s ease-in-out infinite; }
.afg .afg-pkt2 { color:${O}; animation: afg-pkt2 6s ease-in-out infinite; }
.afg .afg-pkt3 { color:${O}; animation: afg-pkt3 6s ease-in-out infinite; }
.afg .afg-pulse { transform-origin:340px 130px; animation: afg-pulse 1.33s cubic-bezier(.2,.8,.4,1) infinite; }

@keyframes afg-lf { to { stroke-dashoffset: -12; } }

/* ── pkt1: L1 → SealGate → GitHub (allowed) ── */
@keyframes afg-pkt1 {
  0%,4%   { opacity:0; }
  5%      { transform:translate(120px,33px);  opacity:.8; color:${O}; }
  15%     { transform:translate(310px,130px); opacity:1;  color:${O}; }
  17%     { transform:translate(340px,130px); opacity:.3; color:var(--accent); }
  19%     { transform:translate(370px,130px); opacity:1;  color:var(--accent); }
  30%     { transform:translate(560px,47px);  opacity:1;  color:var(--accent); }
  32%     { transform:translate(560px,47px);  opacity:0; }
  33%,100%{ opacity:0; }
}

/* ── pkt2: L2 → SealGate → Slack (allowed) ── */
@keyframes afg-pkt2 {
  0%,28%  { opacity:0; }
  29%     { transform:translate(120px,133px); opacity:.8; color:${O}; }
  39%     { transform:translate(310px,130px); opacity:1;  color:${O}; }
  41%     { transform:translate(340px,130px); opacity:.3; color:var(--accent); }
  43%     { transform:translate(370px,130px); opacity:1;  color:var(--accent); }
  54%     { transform:translate(560px,127px); opacity:1;  color:var(--accent); }
  56%     { transform:translate(560px,127px); opacity:0; }
  57%,100%{ opacity:0; }
}

/* ── pkt3: L3 → SealGate → BLOCKED ── */
@keyframes afg-pkt3 {
  0%,52%  { opacity:0; }
  53%     { transform:translate(120px,233px); opacity:.8; color:${O}; }
  63%     { transform:translate(305px,135px); opacity:1;  color:${O}; }
  65%     { transform:translate(305px,135px); opacity:.6; color:${DANGER}; }
  70%     { transform:translate(305px,135px); opacity:0;  color:${DANGER}; }
  71%,100%{ opacity:0; }
}

@keyframes afg-pulse {
  0%   { transform:scale(1);   opacity:0; }
  10%  { transform:scale(1);   opacity:.4; }
  60%  { transform:scale(1.6); opacity:0; }
  100% { transform:scale(1.6); opacity:0; }
}

/* policy verdict badges - synced to packet arrivals at the gateway */
.afg .afg-v1 { animation: afg-v1 6s ease-in-out infinite; }
.afg .afg-v2 { animation: afg-v2 6s ease-in-out infinite; }
.afg .afg-v3 { animation: afg-v3 6s ease-in-out infinite; }
@keyframes afg-v1 {
  0%,15% { opacity:0; transform:scale(0.5); }
  18%    { opacity:1; transform:scale(1); }
  100%   { opacity:1; transform:scale(1); }
}
@keyframes afg-v2 {
  0%,39% { opacity:0; transform:scale(0.5); }
  42%    { opacity:1; transform:scale(1); }
  100%   { opacity:1; transform:scale(1); }
}
@keyframes afg-v3 {
  0%,63% { opacity:0; transform:scale(0.5); }
  66%    { opacity:1; transform:scale(1); }
  100%   { opacity:1; transform:scale(1); }
}

.afg .afg-progress { transform-origin:20px 275px; animation: afg-prog 6s linear infinite; }
@keyframes afg-prog {
  0%   { transform:scaleX(0); }
  100% { transform:scaleX(1); }
}

@media (prefers-reduced-motion:reduce) {
  .afg .afg-line, .afg .afg-pkt1, .afg .afg-pkt2, .afg .afg-pkt3,
  .afg .afg-pulse, .afg .afg-v1, .afg .afg-v2, .afg .afg-v3, .afg .afg-progress { animation:none; }
  .afg .afg-pkt1, .afg .afg-pkt2, .afg .afg-pkt3 { opacity:0; }
  .afg .afg-v1, .afg .afg-v2, .afg .afg-v3 { opacity:1; transform:scale(1); }
  .afg .afg-progress { transform:scaleX(1); }
}
.afg.anim-static .afg-line, .afg.anim-static .afg-pkt1, .afg.anim-static .afg-pkt2, .afg.anim-static .afg-pkt3,
.afg.anim-static .afg-pulse, .afg.anim-static .afg-v1, .afg.anim-static .afg-v2, .afg.anim-static .afg-v3, .afg.anim-static .afg-progress { animation:none; }
.afg.anim-static .afg-pkt1, .afg.anim-static .afg-pkt2, .afg.anim-static .afg-pkt3 { opacity:0; }
.afg.anim-static .afg-v1, .afg.anim-static .afg-v2, .afg.anim-static .afg-v3 { opacity:1; transform:scale(1); }
.afg.anim-static .afg-progress { transform:scaleX(1); }
`

/** Accent eye + "Full visibility" label under the admin (Phase 2 counterpart
 *  of {@link AdminNoVisibilityOverlay}). */
export function AdminFullVisibilityOverlay(): React.ReactNode {
  return (
    <>
      <svg x={324} y={44} width={32} height={32} viewBox="0 0 256 256">
        <path d={EYE_PATH} fill="var(--accent)" fillOpacity="0.85" />
      </svg>
      <text
        x="340"
        y="88"
        textAnchor="middle"
        fill="var(--accent)"
        fillOpacity="0.85"
        fontWeight="bold"
        fontFamily="system-ui,sans-serif"
      >
        <tspan x="340" fontSize="8">
          Full visibility
        </tspan>
        <tspan x="340" dy="9" fontSize="7">
          Full runtime controls
        </tspan>
      </text>
    </>
  )
}

/** Routed connection lines: laptops → SealGate (muted) and SealGate → servers
 *  (accent). Phase 2 counterpart of {@link FleetDirectLines}. */
export function FleetRoutedLines({ lineClassName }: { lineClassName?: string }): React.ReactNode {
  return (
    <>
      {/* Laptops → SealGate */}
      <FlowLine
        className={lineClassName}
        x1={120}
        y1={33}
        x2={310}
        y2={130}
        stroke="var(--text-muted)"
      />
      <FlowLine
        className={lineClassName}
        x1={120}
        y1={133}
        x2={310}
        y2={130}
        stroke="var(--text-muted)"
      />
      <FlowLine
        className={lineClassName}
        x1={120}
        y1={233}
        x2={310}
        y2={130}
        stroke="var(--text-muted)"
      />
      {/* SealGate → servers (accent) */}
      <FlowLine
        className={lineClassName}
        x1={370}
        y1={130}
        x2={560}
        y2={47}
        stroke="var(--accent)"
      />
      <FlowLine
        className={lineClassName}
        x1={370}
        y1={130}
        x2={560}
        y2={127}
        stroke="var(--accent)"
      />
      <FlowLine
        className={lineClassName}
        x1={370}
        y1={130}
        x2={560}
        y2={207}
        stroke="var(--accent)"
      />
    </>
  )
}

/** Local SealGate wrapper + shield badge on each laptop. */
export function FleetLocalWrappers(): React.ReactNode {
  return (
    <>
      {[5, 105, 205].map((ly) => (
        <g key={ly}>
          <rect
            x={22}
            y={ly + 31}
            width={76}
            height={24}
            rx={4}
            fill="var(--accent)"
            fillOpacity="0.03"
            stroke="var(--accent)"
            strokeOpacity="0.5"
            strokeWidth="1.5"
          />
          <SealGateLogo x={10} y={ly + 24} w={16} h={15.5} />
          <svg x={100} y={ly + 33} width={14} height={14} viewBox="0 0 256 256">
            <path d={SHIELD_CHECK_PATH} fill="var(--accent)" fillOpacity="0.7" />
          </svg>
        </g>
      ))}
    </>
  )
}

/** Policy shield glyph beneath the SealGate gateway. */
export function FleetPolicyIcon(): React.ReactNode {
  return (
    <svg x={355} y={155} width={18} height={18} viewBox="0 0 256 256">
      <path d={POLICY_D} fill="var(--text-primary)" fillOpacity="0.45" />
    </svg>
  )
}

export default function AdminFleetGovernedAnimation(): React.ReactNode {
  const id = useId()
  const odSvg = onedriveSvg(id)
  return (
    <div className="flex justify-center">
      <style>{CSS}</style>
      <svg
        className="afg"
        width={680}
        height={280}
        viewBox="0 0 680 280"
        xmlns="http://www.w3.org/2000/svg"
        role="presentation"
        aria-hidden="true"
      >
        {/* ══ Admin icon + full visibility ══ */}
        <AdminFigure cx={340} y={2} size={26} />
        <AdminFullVisibilityOverlay />

        {/* ══ SealGate gateway ══ */}
        <BrandGateway
          cx={340}
          cy={130}
          r={30}
          logoW={54}
          pulseClassName="afg-pulse"
          label="SealGate"
        />

        {/* ══ Routed connection lines ══ */}
        <FleetRoutedLines lineClassName="afg-line" />

        {/* ══ 3 Laptops ══ */}
        <Laptop y={5} agents={[CLAUDE]} />
        <Laptop y={105} agents={[CODEX]} />
        <Laptop y={205} agents={[CURSOR]} />

        {/* ══ Local SealGate wrapper + shield on each laptop ══ */}
        <FleetLocalWrappers />

        {/* ══ Policy verdicts near SealGate (staggered) ══ */}
        <VerdictBadge className="afg-v1" cx={290} cy={108} r={9} variant="allow" />
        <VerdictBadge className="afg-v2" cx={290} cy={130} r={9} variant="allow" />
        <VerdictBadge className="afg-v3" cx={290} cy={152} r={9} variant="deny" />
        <FleetPolicyIcon />

        {/* ══ 3 MCP servers ══ */}
        <McpServer x={560} y={25} iconSvg={GITHUB_SVG} iconViewBox="0 0 1024 1024" />
        <McpServer x={560} y={105} iconSvg={SLACK_SVG} iconViewBox="0 0 2447.6 2452.5" />
        <McpServer x={560} y={185} iconSvg={odSvg} iconViewBox="0 0 1000 615" />

        {/* ══ Packets ══ */}
        <g className="afg-pkt afg-pkt1">
          <McpPacket />
        </g>
        <g className="afg-pkt afg-pkt2">
          <McpPacket />
        </g>
        <g className="afg-pkt afg-pkt3">
          <McpPacket />
        </g>

        {/* ══ Progress bar ══ */}
        <ProgressBar y={275} width={640} className="afg-progress" />
      </svg>
    </div>
  )
}
