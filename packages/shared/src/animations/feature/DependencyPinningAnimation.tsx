/**
 * MCP supply-chain protection animation.
 *
 * Visualises https://docs.edison.watch/en/docs/security/mcp-dependency-pinning
 * at the connector level: an AI agent reaches three MCP servers through the
 * Edison Gateway. An attacker compromises one of the servers (it turns red);
 * the moment the compromise is reported, Edison severs that connection - a
 * warning pops above the gateway, a deny badge drops on the route, and the
 * line goes dark - while the other two MCP servers stay connected.
 *
 * The gateway blocks compromised MCP servers (connectors), not individual
 * libraries. Single 11s loop, colour encodes trust: RED = attacker/compromised,
 * var(--accent) = Edison-mediated. Pure SVG + CSS. Respects
 * `prefers-reduced-motion`.
 * Requires CSS custom properties: --text-primary, --text-muted, --accent.
 */

import {
  ATTACKER_BODY_PATHS, ATTACKER_HIGHLIGHT_PATHS, ATTACKER_SVG_VIEWBOX,
} from '../../svg/attacker-svg'
import {
  EdisonLogo, McpIcon, ProgressBar, RED, RobotIcon, VerdictBadge,
} from '../_shared'

const CSS = `
.dp-anim { color: var(--text-primary); }

/* marching dashed connection lines */
.dp-anim .dp-line { stroke-dashoffset: 0; animation: dp-lf 1.4s linear infinite; }

/* packet halo + core */
.dp-anim .dp-pkt circle { fill: currentColor; }

/* -- phase-driven classes (11s cycle) -- */
.dp-anim .dp-cut-l     { transform-origin: 259px 93px; animation: dp-cut-l 11s ease-in-out infinite; }
.dp-anim .dp-cut-r     { transform-origin: 372px 93px; animation: dp-cut-r 11s ease-in-out infinite; }
.dp-anim .dp-srv-ok    { animation: dp-srv-ok 11s ease-in-out infinite; }
.dp-anim .dp-srv-bad   { animation: dp-srv-bad 11s ease-in-out infinite; }
.dp-anim .dp-atk-ring  { transform-origin: 468px 93px; animation: dp-atk-ring 11s ease-in-out infinite; }
.dp-anim .dp-atk-pulse { transform-origin: 468px 93px; animation: dp-atk-pulse 1.5s cubic-bezier(.2,.8,.4,1) infinite; }
.dp-anim .dp-atk       { animation: dp-atk 11s ease-in-out infinite; }
.dp-anim .dp-atk-show  { animation: dp-atk-show 11s ease-in-out infinite; }
.dp-anim .dp-detect-w  { animation: dp-detect-w 11s ease-in-out infinite; }
.dp-anim .dp-detect    { transform-origin: 232px 93px; animation: dp-detect 1.5s cubic-bezier(.2,.8,.4,1) infinite; }
.dp-anim .dp-deny      { animation: dp-deny 11s ease-in-out infinite; }
.dp-anim .dp-warn      { transform-origin: 232px 40px; animation: dp-warn 11s ease-in-out infinite; }

.dp-anim .dp-cap2 { animation: dp-cap2 11s ease-in-out infinite; }
.dp-anim .dp-cap3 { animation: dp-cap3 11s ease-in-out infinite; }
.dp-anim .dp-progress { transform-origin: 20px 188px; animation: dp-prog 11s linear infinite; }

/* ----- keyframes ----- */
@keyframes dp-lf { to { stroke-dashoffset: -12; } }

/* middle route is explicitly severed: the two stubs snap apart, leaving a gap */
@keyframes dp-cut-l {
  0%,47% { opacity: 1; transform: scaleX(1); }
  51% { opacity: 1; transform: scaleX(.6); }
  57%,100% { opacity: .3; transform: scaleX(.6); }
}
@keyframes dp-cut-r {
  0%,47% { opacity: 1; transform: scaleX(1); }
  51% { opacity: 1; transform: scaleX(.6); }
  57%,100% { opacity: .3; transform: scaleX(.6); }
}

/* middle server: brief healthy beat, then compromised */
@keyframes dp-srv-ok  { 0%,32% { opacity: 1; } 40% { opacity: 0; } 100% { opacity: 0; } }
@keyframes dp-srv-bad { 0%,32% { opacity: 0; } 40% { opacity: 1; } 100% { opacity: 1; } }

/* attacker pulse active during the attack */
@keyframes dp-atk-ring  { 0%,18% { opacity: 0; } 22% { opacity: 1; } 56% { opacity: 1; } 64%,100% { opacity: 0; } }
@keyframes dp-atk-pulse { 0% { transform: scale(1); opacity: 0; } 12% { opacity: .45; } 70% { transform: scale(1.7); opacity: 0; } 100% { opacity: 0; } }

/* attack bolt: attacker -> middle server */
@keyframes dp-atk {
  0%,22% { opacity: 0; transform: translate(450px,93px); }
  26% { opacity: 1; transform: translate(450px,93px); }
  34% { opacity: 1; transform: translate(430px,93px); }
  38%,100% { opacity: 0; transform: translate(430px,93px); }
}

/* attacker only appears as it strikes the server */
@keyframes dp-atk-show { 0%,18% { opacity: 0; } 24% { opacity: 1; } 96% { opacity: 1; } 100% { opacity: 0; } }

/* Edison detection pulse the moment it flags the compromise */
@keyframes dp-detect-w { 0%,42% { opacity: 0; } 46% { opacity: 1; } 96% { opacity: 1; } 100% { opacity: 0; } }
@keyframes dp-detect   { 0% { transform: scale(1); opacity: 0; } 12% { opacity: .5; } 70% { transform: scale(1.6); opacity: 0; } 100% { opacity: 0; } }

/* deny badge drops on the severed route */
@keyframes dp-deny { 0%,46% { opacity: 0; transform: scale(.5); } 52% { opacity: 1; transform: scale(1); } 96% { opacity: 1; transform: scale(1); } 100% { opacity: 0; } }

/* warning sign pops above the gateway the moment Edison flags the compromise */
@keyframes dp-warn {
  0%,38% { opacity: 0; transform: scale(0); }
  43% { opacity: 1; transform: scale(1.18); }
  47% { transform: scale(1); }
  54% { opacity: .5; } 60% { opacity: 1; } 66% { opacity: .5; } 72% { opacity: 1; }
  96% { opacity: 1; } 100% { opacity: 0; }
}

/* captions */
@keyframes dp-cap2 { 0%,20% { opacity: 0; } 24% { opacity: 1; } 42% { opacity: 1; } 46%,100% { opacity: 0; } }
@keyframes dp-cap3 { 0%,48% { opacity: 0; } 52% { opacity: 1; } 96% { opacity: 1; } 100% { opacity: 0; } }

@keyframes dp-prog { 0% { transform: scaleX(0); } 100% { transform: scaleX(1); } }

@media (prefers-reduced-motion: reduce) {
  .dp-anim .dp-line, .dp-anim .dp-cut-l, .dp-anim .dp-cut-r, .dp-anim .dp-srv-ok, .dp-anim .dp-srv-bad,
  .dp-anim .dp-atk-ring, .dp-anim .dp-atk-pulse, .dp-anim .dp-atk,
  .dp-anim .dp-atk-show, .dp-anim .dp-detect-w, .dp-anim .dp-detect, .dp-anim .dp-deny,
  .dp-anim .dp-warn, .dp-anim .dp-cap2, .dp-anim .dp-cap3 { animation: none; }
  .dp-anim .dp-atk-show { opacity: 1; }
  .dp-anim .dp-cut-l, .dp-anim .dp-cut-r { opacity: .3; transform: scaleX(.6); }
  .dp-anim .dp-srv-ok { opacity: 0; }
  .dp-anim .dp-srv-bad { opacity: 1; }
  .dp-anim .dp-atk-ring, .dp-anim .dp-atk, .dp-anim .dp-detect-w { opacity: 0; }
  .dp-anim .dp-deny { opacity: 1; transform: scale(1); }
  .dp-anim .dp-warn { opacity: 1; transform: scale(1); }
  .dp-anim .dp-cap2 { opacity: 0; }
  .dp-anim .dp-cap3 { opacity: 1; }
  .dp-anim .dp-progress { animation: none; transform: scaleX(1); }
}
`

/** Travelling packet (halo + core), colour via currentColor. */
function Pkt(): React.ReactNode {
  return (
    <>
      <circle r="7" fillOpacity="0.16" />
      <circle r="2.8" fillOpacity="0.6" />
    </>
  )
}

/** One MCP server tile - healthy (neutral) or compromised (red + biohazard). */
function McpServer({ x, y, bad }: { x: number; y: number; bad?: boolean }): React.ReactNode {
  const w = 58
  const h = 46
  return (
    <g>
      {bad && <circle cx={x + w / 2} cy={y + h / 2} r="34" fill={RED} fillOpacity="0.07" />}
      <rect x={x} y={y} width={w} height={h} rx="6"
        fill={bad ? RED : 'var(--text-primary)'} fillOpacity={bad ? 0.06 : 0.03}
        stroke={bad ? RED : 'var(--text-muted)'} strokeOpacity={bad ? 0.5 : 0.35} strokeWidth="1" />
      <McpIcon x={x + 17} y={y + 7} size={24}
        color={bad ? RED : 'var(--text-primary)'} opacity={bad ? '0.8' : '0.65'} />
    </g>
  )
}

export default function DependencyPinningAnimation(): React.ReactNode {
  // Edison gateway right edge -> each server's left-middle connection point.
  const lines: Array<[number, number, string]> = [
    [372, 37, 'dp-line'],   // top server
    [372, 149, 'dp-line'],  // bottom server
  ]
  return (
    <div className="flex justify-center">
      <style>{CSS}</style>
      <svg
        className="dp-anim"
        width={500}
        height={196}
        viewBox="0 0 500 196"
        xmlns="http://www.w3.org/2000/svg"
        role="presentation"
        aria-hidden="true"
      >
        {/* agent -> Edison */}
        <line className="dp-line" x1="134" y1="93" x2="205" y2="93"
          stroke="var(--accent)" strokeOpacity="0.5" strokeWidth="1.5" strokeDasharray="3 3" />
        {/* Edison -> top + bottom servers */}
        {lines.map(([sx, sy, cls], i) => (
          <line key={i} className={cls} x1="259" y1="93" x2={sx} y2={sy}
            stroke="var(--accent)" strokeOpacity="0.5" strokeWidth="1.5" strokeDasharray="3 3" />
        ))}
        {/* Edison -> middle server: two stubs that snap apart when severed */}
        <line className="dp-line dp-cut-l" x1="259" y1="93" x2="316" y2="93"
          stroke="var(--accent)" strokeOpacity="0.5" strokeWidth="1.5" strokeDasharray="3 3" />
        <line className="dp-line dp-cut-r" x1="316" y1="93" x2="372" y2="93"
          stroke="var(--accent)" strokeOpacity="0.5" strokeWidth="1.5" strokeDasharray="3 3" />

        {/* AI agent */}
        <rect x="16" y="64" width="116" height="58" rx="7"
          fill="var(--text-primary)" fillOpacity="0.03"
          stroke="var(--text-muted)" strokeOpacity="0.35" strokeWidth="1.2" />
        <RobotIcon x={54} y={72} size={42} fill="var(--text-primary)" fillOpacity="0.6" />
        <text x="74" y="138" textAnchor="middle" fill="var(--text-primary)"
          fontSize="9" fontWeight="bold" fontFamily="system-ui,sans-serif">AI agent</text>

        {/* Edison gateway + detection pulse */}
        <g className="dp-detect-w">
          <circle className="dp-detect" cx="232" cy="93" r="27"
            fill="none" stroke="var(--accent)" strokeOpacity="0.5" strokeWidth="1.5" />
        </g>
        <EdisonLogo x={205} y={67} w={54} h={52.5} />
        <text x="232" y="138" textAnchor="middle" fill="var(--text-primary)"
          fontSize="9" fontWeight="bold" fontFamily="system-ui,sans-serif">Edison Gateway</text>

        {/* warning: pops above the gateway when Edison flags the compromise */}
        <g className="dp-warn">
          <path d="M232 19 L253 56 L211 56 Z"
            fill={RED} fillOpacity="0.16" stroke={RED} strokeOpacity="0.85"
            strokeWidth="2.5" strokeLinejoin="round" />
          <line x1="232" y1="33" x2="232" y2="45"
            stroke={RED} strokeWidth="3.2" strokeLinecap="round" />
          <circle cx="232" cy="51" r="1.9" fill={RED} />
        </g>

        {/* three MCP servers (top + bottom always healthy) */}
        <McpServer x={372} y={14} />
        <McpServer x={372} y={126} />
        {/* middle server: healthy -> compromised */}
        <g className="dp-srv-ok"><McpServer x={372} y={70} /></g>
        <g className="dp-srv-bad">
          <McpServer x={372} y={70} bad />
        </g>
        <text x="401" y="186" textAnchor="middle" fill="var(--text-primary)"
          fontSize="8.5" fontWeight="bold" fontFamily="system-ui,sans-serif" opacity="0.85">MCP servers</text>

        {/* attacker (right of the middle server) - only appears as it strikes */}
        <g className="dp-atk-show">
          <g className="dp-atk-ring">
            <circle className="dp-atk-pulse" cx="468" cy="93" r="24"
              fill="none" stroke={RED} strokeOpacity="0.5" strokeWidth="1.5" />
          </g>
          <svg x="446" y="71" width="44" height="44" viewBox={ATTACKER_SVG_VIEWBOX}>
            {ATTACKER_BODY_PATHS.map((d, i) => (
              <path key={`b${i}`} d={d} fill={RED} fillOpacity="0.5" />
            ))}
            {ATTACKER_HIGHLIGHT_PATHS.map((d, i) => (
              <path key={`h${i}`} d={d} fill="#fff" />
            ))}
          </svg>
          <text x="468" y="64" textAnchor="middle" fill={RED}
            fontSize="8.5" fontWeight="bold" fontFamily="system-ui,sans-serif" opacity="0.9">Attacker</text>
        </g>

        {/* attack bolt: attacker -> middle server */}
        <g className="dp-pkt dp-atk" style={{ color: RED }}><Pkt /></g>

        {/* Edison severs the compromised route */}
        <VerdictBadge cx={316} cy={93} r={9} variant="deny" className="dp-deny" />

        {/* captions */}
        <g className="dp-cap2">
          <text x="232" y="178" textAnchor="middle" fill={RED}
            fontSize="9" fontWeight="600" fontFamily="system-ui,sans-serif" opacity="0.9">
            An attacker compromises one MCP server
          </text>
        </g>
        <g className="dp-cap3">
          <text x="232" y="178" textAnchor="middle" fill="var(--accent)"
            fontSize="9" fontWeight="600" fontFamily="system-ui,sans-serif" opacity="0.9">
            Blocked the moment the compromise is reported
          </text>
        </g>

        <ProgressBar y={188} width={460} className="dp-progress" />
      </svg>
    </div>
  )
}
