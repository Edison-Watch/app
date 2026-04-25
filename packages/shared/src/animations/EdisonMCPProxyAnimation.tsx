/**
 * Edison MCP proxy model animation.
 *
 * Phase 1: Laptop (Claude + 3 MCPs) connects directly to 3 MCP servers.
 * Transition: Edison Watch fades in as a gateway.
 * Phase 2: All connections now route through Edison (packets change
 *          from orange to accent as they pass through).
 *
 * 10s loop. Pure SVG + CSS. Respects `prefers-reduced-motion`.
 *
 * Requires CSS custom properties: --text-primary, --accent, --text-muted.
 */
import { AGENT_REGISTRY } from '../agent-registry/index'
import { MCP_ICON_PATHS, MCP_ICON_VIEWBOX } from '../svg/mcp-svg'
import {
  EDISON_E_PATH, EDISON_FRAME_PATH, EDISON_LOGO_VIEWBOX,
  EDISON_WATCH_FILL_PATH, EDISON_WATCH_STROKE_PATH,
} from '../svg/edison-logo-svg'

const O = '#da7756'

const CLAUDE_SPRITE = AGENT_REGISTRY['claude-code']
const CURSOR_SPRITE = AGENT_REGISTRY['cursor']
const VSCODE_SPRITE = AGENT_REGISTRY['vscode']

const CSS = `
.ew-anim { color: var(--text-primary); }

/* dashed-line flow */
.ew-anim .ew-line { stroke-dashoffset:0; animation: ew-lf 2s linear infinite; }

/* packet fill inherits currentColor */
.ew-anim .ew-pkt path, .ew-anim .ew-pkt circle { fill: currentColor; }

/* -- phase visibility (10s cycle) -- */
.ew-anim .ew-direct { animation: ew-dv 10s ease-in-out infinite; }
.ew-anim .ew-edison { animation: ew-ev 10s ease-in-out infinite; transform-origin: 257px 93px; }
.ew-anim .ew-routed { animation: ew-rv 10s ease-in-out infinite; }
.ew-anim .ew-local-wrap { animation: ew-rv 10s ease-in-out infinite; }

/* -- 3 packets (each has direct + routed phases) -- */
.ew-anim .ew-pkt-main { color:${O}; animation: ew-pkt-main 10s ease-in-out infinite; }

/* -- Edison pulse -- */
.ew-anim .ew-pulse { transform-origin:257px 93px; animation: ew-pulse 1.33s cubic-bezier(.2,.8,.4,1) infinite; }

/* ----- keyframes ----- */
@keyframes ew-lf { to { stroke-dashoffset: -12; } }

/* Phase visibility */
@keyframes ew-dv {
  0%,26%  { opacity:1; }
  34%     { opacity:0; }
  100%    { opacity:0; }
}
@keyframes ew-ev {
  0%,28%  { opacity:0; transform:scale(.85); }
  36%     { opacity:1; transform:scale(1); }
  100%    { opacity:1; transform:scale(1); }
}
@keyframes ew-rv {
  0%,28%  { opacity:0; }
  36%     { opacity:1; }
  100%    { opacity:1; }
}

/* Single packet: request-response, one server at a time */
@keyframes ew-pkt-main {
  /* -- Phase 1: direct request to middle server -- */
  0%,1%  { opacity:0; }
  2%     { transform:translate(176px,93px); opacity:0;  color:${O}; }
  3%     { transform:translate(176px,93px); opacity:.8; color:${O}; }
  12%    { transform:translate(426px,93px); opacity:1;  color:${O}; }
  13%    { transform:translate(426px,93px); opacity:.6; color:${O}; }
  /* -- Phase 1: direct response from middle server -- */
  14%    { transform:translate(426px,93px); opacity:.8; color:${O}; }
  23%    { transform:translate(176px,93px); opacity:1;  color:${O}; }
  24%    { transform:translate(176px,93px); opacity:0; }
  25%,37%{ opacity:0; }
  /* -- Phase 2: routed request through Edison to middle server -- */
  38%    { transform:translate(100px,93px); opacity:0;  color:${O}; }
  39%    { transform:translate(100px,93px); opacity:.8; color:${O}; }
  45%    { transform:translate(251px,93px); opacity:1;  color:${O}; }
  47%    { transform:translate(257px,93px); opacity:.3; color:var(--accent); }
  49%    { transform:translate(263px,93px); opacity:1;  color:var(--accent); }
  57%    { transform:translate(426px,93px); opacity:1;  color:var(--accent); }
  58%    { transform:translate(426px,93px); opacity:.6; color:var(--accent); }
  /* -- Phase 2: routed response back through Edison -- */
  59%    { transform:translate(426px,93px); opacity:.8; color:var(--accent); }
  67%    { transform:translate(263px,93px); opacity:1;  color:var(--accent); }
  69%    { transform:translate(257px,93px); opacity:.3; color:var(--accent); }
  71%    { transform:translate(251px,93px); opacity:1;  color:var(--accent); }
  78%    { transform:translate(100px,93px); opacity:1;  color:var(--accent); }
  79%    { transform:translate(100px,93px); opacity:0; }
  80%,100%{ opacity:0; }
}

@keyframes ew-pulse {
  0%  { transform:scale(1);   opacity:0; }
  10% { transform:scale(1);   opacity:.4; }
  60% { transform:scale(1.6); opacity:0; }
  100%{ transform:scale(1.6); opacity:0; }
}

/* progress bar */
.ew-anim .ew-progress { transform-origin:20px 188px; animation: ew-prog 10s linear infinite; }
@keyframes ew-prog {
  0%   { transform:scaleX(0); }
  100% { transform:scaleX(1); }
}

@media (prefers-reduced-motion:reduce) {
  .ew-anim .ew-line, .ew-anim .ew-pkt-main,
  .ew-anim .ew-pulse, .ew-anim .ew-direct, .ew-anim .ew-edison,
  .ew-anim .ew-routed { animation:none; }
  .ew-anim .ew-pkt-main { opacity:0; }
  .ew-anim .ew-progress { animation:none; transform:scaleX(1); }
  .ew-anim .ew-edison { opacity:1; transform:scale(1); }
  .ew-anim .ew-direct { opacity:0; }
  .ew-anim .ew-routed { opacity:1; }
  .ew-anim .ew-local-wrap { animation:none; opacity:1; }
}
`

function McpIcon({ x, y, size, color, opacity = '0.65' }: {
  x: number; y: number; size: number; color: string; opacity?: string
}): React.ReactNode {
  return (
    <svg x={x} y={y} width={size} height={size} viewBox={MCP_ICON_VIEWBOX}>
      <path d={MCP_ICON_PATHS[0]} fill={color} fillOpacity={opacity} />
      <path d={MCP_ICON_PATHS[1]} fill={color} fillOpacity={opacity} />
    </svg>
  )
}

function McpServer({ x, y }: { x: number; y: number }): React.ReactNode {
  return (
    <g>
      <rect
        x={x} y={y} width="56" height="48" rx="6"
        fill="var(--text-primary)" fillOpacity="0.03"
        stroke="var(--text-muted)" strokeOpacity="0.35" strokeWidth="1"
      />
      <McpIcon x={x + 16} y={y + 6} size={24} color="var(--text-muted)" opacity="0.6" />
      <circle cx={x + 28} cy={y + 38} r="1.5" fill="var(--text-muted)" fillOpacity="0.35" />
      <line
        x1={x + 34} y1={y + 38} x2={x + 48} y2={y + 38}
        stroke="var(--text-muted)" strokeOpacity="0.15" strokeWidth="1" strokeDasharray="2 2"
      />
    </g>
  )
}

function Packet(): React.ReactNode {
  return (
    <>
      <circle r="10" fillOpacity="0.12" />
      <g transform="translate(-6,-6) scale(0.5)">
        <path d={MCP_ICON_PATHS[0]} />
        <path d={MCP_ICON_PATHS[1]} />
      </g>
    </>
  )
}

export default function EdisonMCPProxyAnimation(): React.ReactNode {
  return (
    <div className="flex justify-center">
      <style>{CSS}</style>
      <svg
        className="ew-anim"
        width={500}
        height={190}
        viewBox="0 0 500 190"
        xmlns="http://www.w3.org/2000/svg"
        role="presentation"
        aria-hidden="true"
      >
        {/* Phase 1: direct connector lines (laptop -> servers) */}
        <g className="ew-direct">
          <line className="ew-line" x1="176" y1="93" x2="394" y2="38"
            stroke="var(--text-muted)" strokeOpacity="0.5" strokeWidth="1.5" strokeDasharray="3 3" />
          <line className="ew-line" x1="176" y1="93" x2="394" y2="93"
            stroke="var(--text-muted)" strokeOpacity="0.5" strokeWidth="1.5" strokeDasharray="3 3" />
          <line className="ew-line" x1="176" y1="93" x2="394" y2="148"
            stroke="var(--text-muted)" strokeOpacity="0.5" strokeWidth="1.5" strokeDasharray="3 3" />
        </g>

        {/* Edison gateway (fades in for phase 2) */}
        <g className="ew-edison">
          <circle className="ew-pulse" cx="257" cy="93" r="30"
            fill="none" stroke="var(--accent)" strokeOpacity="0.5" strokeWidth="1.5" />
          <svg x="230" y="67" width="54" height="52.5" viewBox={EDISON_LOGO_VIEWBOX}>
            <path d={EDISON_E_PATH}
              fill="var(--accent)" fillOpacity="0.8" stroke="var(--accent)" strokeWidth="5" strokeMiterlimit="10" />
            <path d={EDISON_WATCH_FILL_PATH}
              fill="var(--accent)" fillOpacity="0.8" />
            <path d={EDISON_WATCH_STROKE_PATH}
              stroke="var(--accent)" strokeOpacity="0.8" strokeWidth="4" strokeMiterlimit="10" />
            <path d={EDISON_FRAME_PATH}
              fill="var(--accent)" fillOpacity="0.8" />
          </svg>
        </g>

        {/* Phase 2: routed connector lines (laptop -> Edison -> servers) */}
        <g className="ew-routed">
          <line className="ew-line" x1="176" y1="93" x2="226" y2="93"
            stroke="var(--text-muted)" strokeOpacity="0.5" strokeWidth="1.5" strokeDasharray="3 3" />
          <line className="ew-line" x1="288" y1="93" x2="394" y2="38"
            stroke="var(--accent)" strokeOpacity="0.5" strokeWidth="1.5" strokeDasharray="3 3" />
          <line className="ew-line" x1="288" y1="93" x2="394" y2="93"
            stroke="var(--accent)" strokeOpacity="0.5" strokeWidth="1.5" strokeDasharray="3 3" />
          <line className="ew-line" x1="288" y1="93" x2="394" y2="148"
            stroke="var(--accent)" strokeOpacity="0.5" strokeWidth="1.5" strokeDasharray="3 3" />
        </g>

        {/* Laptop (always visible) */}
        <rect x="4" y="23" width="168" height="96" rx="7"
          fill="var(--text-primary)" fillOpacity="0.03"
          stroke="var(--text-muted)" strokeOpacity="0.35" strokeWidth="1.5" />
        <rect x="0" y="121" width="176" height="8" rx="4"
          fill="var(--text-primary)" fillOpacity="0.04"
          stroke="var(--text-muted)" strokeOpacity="0.35" strokeWidth="1" />

        {/* AI agent icons (row inside laptop) */}
        <rect x="41" y="35" width="30" height="30" rx="7" fill={CURSOR_SPRITE.brandColor} />
        <svg x="45" y="39" width="22" height="22" viewBox="0 0 24 24">
          <path d={CURSOR_SPRITE.svgPath} fill="#fff" />
        </svg>
        <rect x="73" y="35" width="30" height="30" rx="7" fill={CLAUDE_SPRITE.brandColor} />
        <svg x="77" y="39" width="22" height="22" viewBox="0 -20 90 90"
          shapeRendering="crispEdges"
          dangerouslySetInnerHTML={{ __html: CLAUDE_SPRITE.customSvg ?? '' }} />
        <rect x="105" y="35" width="30" height="30" rx="7" fill={VSCODE_SPRITE.brandColor} />
        <svg x="109" y="39" width="22" height="22" viewBox="0 0 24 24">
          <path d={VSCODE_SPRITE.svgPath} fill="#fff" />
        </svg>

        {/* 3 MCP icons (row below Claude inside laptop) */}
        {[38, 74, 110].map((mx) => (
          <g key={mx}>
            <rect x={mx} y="79" width="28" height="28" rx="6"
              fill="var(--text-primary)" fillOpacity="0.04"
              stroke="var(--text-muted)" strokeOpacity="0.3" strokeWidth="1" />
            <McpIcon x={mx + 2} y={81} size={24} color="var(--text-primary)" />
          </g>
        ))}

        {/* Local Edison wrapper around MCPs (fades in with Edison) */}
        <g className="ew-local-wrap">
          <rect
            x="30"
            y="73"
            width="118"
            height="40"
            rx="6"
            fill="var(--accent)"
            fillOpacity="0.03"
            stroke="var(--accent)"
            strokeOpacity="0.5"
            strokeWidth="1.5"
          />
          {/* Edison logo badge at top-left */}
          <svg x="14" y="62" width="20" height="19.5" viewBox={EDISON_LOGO_VIEWBOX}>
            <path d={EDISON_E_PATH}
              fill="var(--accent)" fillOpacity="0.8" stroke="var(--accent)" strokeWidth="5" strokeMiterlimit="10" />
            <path d={EDISON_WATCH_FILL_PATH}
              fill="var(--accent)" fillOpacity="0.8" />
            <path d={EDISON_WATCH_STROKE_PATH}
              stroke="var(--accent)" strokeOpacity="0.8" strokeWidth="4" strokeMiterlimit="10" />
            <path d={EDISON_FRAME_PATH}
              fill="var(--accent)" fillOpacity="0.8" />
          </svg>
        </g>

        {/* 3 MCP servers (always visible) */}
        <McpServer x={398} y={14} />
        <McpServer x={398} y={69} />
        <McpServer x={398} y={124} />

        {/* Labels */}
        <text x="88" y="145" textAnchor="middle"
          fill="var(--text-primary)" fontSize="9" fontWeight="bold" fontFamily="system-ui,sans-serif">
          Local
        </text>
        <g className="ew-edison">
          <text x="257" y="135" textAnchor="middle"
            fill="var(--text-primary)" fontSize="9" fontWeight="bold" fontFamily="system-ui,sans-serif">
            Edison Gateway
          </text>
        </g>
        <text x="426" y="184" textAnchor="middle"
          fill="var(--text-primary)" fontSize="9" fontWeight="bold" fontFamily="system-ui,sans-serif">
          MCP Servers
        </text>

        {/* 3 Packets (each animates direct -> hidden -> routed) */}
        <g className="ew-pkt ew-pkt-main"><Packet /></g>

        {/* Progress bar */}
        <rect x="20" y="188" width="460" height="1.5" rx="0.75"
          fill="var(--text-primary)" fillOpacity="0.1" />
        <rect className="ew-progress" x="20" y="188" width="460" height="1.5" rx="0.75"
          fill="var(--text-primary)" fillOpacity="0.35" />
      </svg>
    </div>
  )
}
