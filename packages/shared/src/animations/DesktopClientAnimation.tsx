/**
 * Desktop Client config-watching & MCP quarantine animation.
 *
 * Phase 1 - "Blind": A large employee laptop runs AI agents (Claude,
 *           Cursor, Codex) with MCP configs. A rogue "shadow-tool" MCP
 *           appears. The admin has NO visibility into the config.
 * Transition: Edison Watch desktop app activates on the laptop.
 * Phase 2 - "Watch": Edison scans the configs, quarantines the rogue
 *           MCP, and the admin gains full visibility with a review panel.
 *
 * 12s loop. Pure SVG + CSS. Respects `prefers-reduced-motion`.
 */
import { AGENT_REGISTRY } from '../agent-registry/index'
import { MCP_ICON_PATHS } from '../svg/mcp-svg'
import {
  EDISON_E_PATH, EDISON_FRAME_PATH, EDISON_LOGO_VIEWBOX,
  EDISON_WATCH_FILL_PATH, EDISON_WATCH_STROKE_PATH,
} from '../svg/edison-logo-svg'

const CLAUDE = AGENT_REGISTRY['claude-code']
const CURSOR = AGENT_REGISTRY['cursor']
const CODEX = AGENT_REGISTRY['codex']

const O = '#da7756'
const DANGER = '#ef4444'

const EYE_SLASH_D = 'M53.92,34.62A8,8,0,1,0,42.08,45.38L61.32,66.55C25,88.84,9.38,123.2,8.69,124.76a8,8,0,0,0,0,6.5c.35.79,8.82,19.57,27.65,38.4C61.43,194.74,93.12,208,128,208a127.11,127.11,0,0,0,52.07-10.83l22,24.21a8,8,0,1,0,11.84-10.76Zm47.33,75.84,41.67,45.85a32,32,0,0,1-41.67-45.85ZM128,192c-30.78,0-57.67-11.19-79.93-33.25A133.16,133.16,0,0,1,25,128c4.69-8.79,19.66-33.39,47.35-49.38l18,19.75a48,48,0,0,0,63.66,70l14.73,16.2A112,112,0,0,1,128,192Zm6-95.43a8,8,0,0,1,3-15.72,48.16,48.16,0,0,1,38.77,42.64,8,8,0,0,1-7.22,8.71,6.39,6.39,0,0,1-.75,0,8,8,0,0,1-8-7.26A32.09,32.09,0,0,0,134,96.57Zm113.28,34.69c-.42.94-10.55,23.37-33.36,43.8a8,8,0,1,1-10.67-11.92A132.77,132.77,0,0,0,231.05,128a133.15,133.15,0,0,0-23.12-30.77C185.67,75.19,158.78,64,128,64a118.37,118.37,0,0,0-19.36,1.57A8,8,0,1,1,106,49.79,134,134,0,0,1,128,48c34.88,0,66.57,13.26,91.66,38.35,18.83,18.83,27.3,37.62,27.65,38.41A8,8,0,0,1,247.31,131.26Z'
const EYE_D = 'M247.31,124.76c-.35-.79-8.82-19.58-27.65-38.41C194.57,61.26,162.88,48,128,48S61.43,61.26,36.34,86.35C17.51,105.18,9,124,8.69,124.76a8,8,0,0,0,0,6.5c.35.79,8.82,19.57,27.65,38.4C61.43,194.74,93.12,208,128,208s66.57-13.26,91.66-38.34c18.83-18.83,27.3-37.61,27.65-38.4A8,8,0,0,0,247.31,124.76ZM128,192c-30.78,0-57.67-11.19-79.93-33.25A133.47,133.47,0,0,1,25,128,133.33,133.33,0,0,1,48.07,97.25C70.33,75.19,97.22,64,128,64s57.67,11.19,79.93,33.25A133.46,133.46,0,0,1,231.05,128C223.84,141.46,192.43,192,128,192Zm0-112a48,48,0,1,0,48,48A48.05,48.05,0,0,0,128,80Zm0,80a32,32,0,1,1,32-32A32,32,0,0,1,128,160Z'
const ADMIN_D = 'M228.25,63.07l-4.66-2.69a23.6,23.6,0,0,0,0-8.76l4.66-2.69a8,8,0,0,0-8-13.86l-4.67,2.7A23.92,23.92,0,0,0,208,33.38V28a8,8,0,0,0-16,0v5.38a23.92,23.92,0,0,0-7.58,4.39l-4.67-2.7a8,8,0,1,0-8,13.86l4.66,2.69a23.6,23.6,0,0,0,0,8.76l-4.66,2.69a8,8,0,0,0,4,14.93,7.92,7.92,0,0,0,4-1.07l4.67-2.7A23.92,23.92,0,0,0,192,78.62V84a8,8,0,0,0,16,0V78.62a23.92,23.92,0,0,0,7.58-4.39l4.67,2.7a7.92,7.92,0,0,0,4,1.07,8,8,0,0,0,4-14.93ZM192,56a8,8,0,1,1,8,8A8,8,0,0,1,192,56Zm29.35,48.11a8,8,0,0,0-6.57,9.21A88.85,88.85,0,0,1,216,128a87.62,87.62,0,0,1-22.24,58.41,79.66,79.66,0,0,0-36.06-28.75,48,48,0,1,0-59.4,0,79.66,79.66,0,0,0-36.06,28.75A88,88,0,0,1,128,40a88.76,88.76,0,0,1,14.68,1.22,8,8,0,0,0,2.64-15.78,103.92,103.92,0,1,0,85.24,85.24A8,8,0,0,0,221.35,104.11ZM96,120a32,32,0,1,1,32,32A32,32,0,0,1,96,120ZM74.08,197.5a64,64,0,0,1,107.84,0,87.83,87.83,0,0,1-107.84,0Z'
const SHIELD_CHECK_D = 'M208,40H48A16,16,0,0,0,32,56v56c0,52.72,25.52,84.67,46.93,102.19,23.06,18.86,46,25.26,47,25.53a8,8,0,0,0,4.2,0c1-.27,23.91-6.67,47-25.53C198.48,196.67,224,164.72,224,112V56A16,16,0,0,0,208,40Zm0,72c0,37.07-13.66,67.16-40.6,89.42A129.3,129.3,0,0,1,128,223.62a128.25,128.25,0,0,1-38.92-21.81C61.82,179.51,48,149.3,48,112l0-56,160,0ZM82.34,141.66a8,8,0,0,1,11.32-11.32L112,148.69l50.34-50.35a8,8,0,0,1,11.32,11.32l-56,56a8,8,0,0,1-11.32,0Z'

const fg = 'var(--text-primary)'
const muted = 'var(--text-muted)'
const accent = 'var(--accent)'

const CSS = `.dca{color:${fg}}.dca .dca-line{stroke-dashoffset:0;animation:dca-lf 2s linear infinite}.dca .dca-pkt path,.dca .dca-pkt circle{fill:currentColor}.dca .dca-phase1{animation:dca-p1 12s ease-in-out infinite}.dca .dca-edison{animation:dca-ed 12s ease-in-out infinite;transform-origin:279px 151px}.dca .dca-phase2{animation:dca-p2 12s ease-in-out infinite}.dca .dca-rogue{animation:dca-rogue 12s ease-in-out infinite}.dca .dca-rglow{animation:dca-rglow 1.5s ease-in-out infinite}.dca .dca-pulse{transform-origin:279px 151px;animation:dca-pulse 1.33s cubic-bezier(.2,.8,.4,1) infinite}.dca .dca-v1{animation:dca-v1 12s ease-in-out infinite}.dca .dca-v2{animation:dca-v2 12s ease-in-out infinite}.dca .dca-v3{animation:dca-v3 12s ease-in-out infinite}.dca .dca-pkt1{color:${accent};animation:dca-pkt1 12s ease-in-out infinite}.dca .dca-scan{animation:dca-scan 12s ease-in-out infinite}.dca .dca-progress{transform-origin:20px 248px;animation:dca-prog 12s linear infinite}@keyframes dca-lf{to{stroke-dashoffset:-12}}@keyframes dca-p1{0%,46%{opacity:1}54%{opacity:0}100%{opacity:0}}@keyframes dca-ed{0%,48%{opacity:0;transform:scale(.85)}56%{opacity:1;transform:scale(1)}100%{opacity:1;transform:scale(1)}}@keyframes dca-p2{0%,48%{opacity:0}56%{opacity:1}100%{opacity:1}}@keyframes dca-rogue{0%,4%{opacity:0}10%{opacity:1}100%{opacity:1}}@keyframes dca-rglow{0%,100%{stroke-opacity:.3}50%{stroke-opacity:.65}}@keyframes dca-pulse{0%{transform:scale(1);opacity:0}10%{transform:scale(1);opacity:.4}60%{transform:scale(1.5);opacity:0}100%{transform:scale(1.5);opacity:0}}@keyframes dca-v1{0%,62%{opacity:0;transform:scale(0.5)}65%{opacity:1;transform:scale(1)}100%{opacity:1;transform:scale(1)}}@keyframes dca-v2{0%,68%{opacity:0;transform:scale(0.5)}71%{opacity:1;transform:scale(1)}100%{opacity:1;transform:scale(1)}}@keyframes dca-v3{0%,74%{opacity:0;transform:scale(0.5)}77%{opacity:1;transform:scale(1)}100%{opacity:1;transform:scale(1)}}@keyframes dca-pkt1{0%,76%{opacity:0}78%{transform:translate(330px,100px);opacity:.8;color:${accent}}86%{transform:translate(470px,75px);opacity:1;color:${accent}}88%{transform:translate(470px,75px);opacity:0}100%{opacity:0}}@keyframes dca-scan{0%,56%{opacity:0;transform:translateY(0)}58%{opacity:.7;transform:translateY(0)}70%{opacity:.7;transform:translateY(82px)}72%{opacity:0;transform:translateY(82px)}100%{opacity:0}}@keyframes dca-prog{0%{transform:scaleX(0)}100%{transform:scaleX(1)}}@media(prefers-reduced-motion:reduce){.dca .dca-line,.dca .dca-phase1,.dca .dca-phase2,.dca .dca-edison,.dca .dca-rogue,.dca .dca-rglow,.dca .dca-pulse,.dca .dca-v1,.dca .dca-v2,.dca .dca-v3,.dca .dca-pkt1,.dca .dca-scan{animation:none}.dca .dca-phase1{opacity:0}.dca .dca-phase2,.dca .dca-edison{opacity:1;transform:scale(1)}.dca .dca-rogue{opacity:1}.dca .dca-v1,.dca .dca-v2,.dca .dca-v3{opacity:1;transform:scale(1)}.dca .dca-pkt1{opacity:0}.dca .dca-progress{animation:none;transform:scaleX(1)}}`

function AgentIconSvg({ agent, x, y, size = 20 }: { agent: typeof CLAUDE; x: number; y: number; size?: number }) {
  const inner = size - 4
  return (
    <g>
      <rect x={x} y={y} width={size} height={size} rx={5} fill={agent.brandColor} />
      {agent.customSvg ? (
        <svg x={x + 2} y={y + 2} width={inner} height={inner} viewBox={agent.customViewBox || '0 0 24 24'} shapeRendering="crispEdges" dangerouslySetInnerHTML={{ __html: agent.customSvg }} />
      ) : agent.svgPath ? (
        <svg x={x + 2} y={y + 2} width={inner} height={inner} viewBox="0 0 24 24"><path d={agent.svgPath} fill={agent.svgFill || '#fff'} /></svg>
      ) : null}
    </g>
  )
}

function McpIcon({ x, y, size, color, opacity = '0.65' }: { x: number; y: number; size: number; color: string; opacity?: string }) {
  return (<svg x={x} y={y} width={size} height={size} viewBox="0 0 24 24">{MCP_ICON_PATHS.map((d, i) => <path key={i} d={d} fill={color} fillOpacity={opacity} />)}</svg>)
}

function EdisonLogo({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  return (
    <svg x={x} y={y} width={w} height={h} viewBox={EDISON_LOGO_VIEWBOX}>
      <path d={EDISON_E_PATH} fill={accent} fillOpacity="0.8" stroke={accent} strokeWidth="5" strokeMiterlimit="10" />
      <path d={EDISON_WATCH_FILL_PATH} fill={accent} fillOpacity="0.8" />
      <path d={EDISON_WATCH_STROKE_PATH} fill="none" stroke={accent} strokeOpacity="0.8" strokeWidth="4" strokeMiterlimit="10" />
      <path d={EDISON_FRAME_PATH} fill={accent} fillOpacity="0.8" />
    </svg>
  )
}

function Packet() {
  return (<><circle r="10" fillOpacity="0.12" /><g transform="translate(-6,-6) scale(0.5)">{MCP_ICON_PATHS.map((d, i) => <path key={i} d={d} />)}</g></>)
}

export default function DesktopClientAnimation() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center' }}>
      <style>{CSS}</style>
      <svg className="dca" width={620} height={250} viewBox="0 0 620 250" xmlns="http://www.w3.org/2000/svg" role="presentation" aria-hidden="true">

        {/* ===== LAPTOP (large, left side) ===== */}
        <rect x={12} y={8} width={310} height={158} rx={7}
          fill={fg} fillOpacity="0.03"
          stroke={muted} strokeOpacity="0.35" strokeWidth="1.5" />
        <rect x={8} y={168} width={318} height={8} rx={4}
          fill={fg} fillOpacity="0.04"
          stroke={muted} strokeOpacity="0.35" strokeWidth="1" />

        {/* AI Agent icons row */}
        <AgentIconSvg agent={CLAUDE} x={100} y={18} size={24} />
        <AgentIconSvg agent={CURSOR} x={132} y={18} size={24} />
        <AgentIconSvg agent={CODEX} x={164} y={18} size={24} />

        {/* Config file panel */}
        <rect x={28} y={54} width={246} height={96} rx={5}
          fill={fg} fillOpacity="0.02"
          stroke={muted} strokeOpacity="0.2" strokeWidth="1" />
        <text x={38} y={44} fill={muted} fontSize="7" fontFamily="system-ui,sans-serif" fillOpacity="0.5">MCP Configs</text>

        {/* Config entry 1: github-mcp */}
        <McpIcon x={36} y={62} size={16} color={muted} opacity="0.45" />
        <text x={56} y={74} fill={fg} fontSize="8" fontFamily="ui-monospace,monospace" fillOpacity="0.5">github-mcp</text>

        <line x1={36} y1={82} x2={268} y2={82} stroke={muted} strokeOpacity="0.12" strokeWidth="0.5" />

        {/* Config entry 2: slack-mcp */}
        <McpIcon x={36} y={86} size={16} color={muted} opacity="0.45" />
        <text x={56} y={98} fill={fg} fontSize="8" fontFamily="ui-monospace,monospace" fillOpacity="0.5">slack-mcp</text>

        <line x1={36} y1={106} x2={268} y2={106} stroke={muted} strokeOpacity="0.12" strokeWidth="0.5" />

        {/* Config entry 3: shadow-tool (rogue, fades in) */}
        <g className="dca-rogue">
          <rect className="dca-rglow" x={30} y={110} width={240} height={24} rx={3}
            fill={O} fillOpacity="0.04" stroke={O} strokeOpacity="0.3" strokeWidth="0.8" />
          <McpIcon x={36} y={112} size={16} color={O} opacity="0.7" />
          <text x={56} y={124} fill={O} fontSize="8" fontWeight="bold" fontFamily="ui-monospace,monospace" fillOpacity="0.8">shadow-tool</text>

          <g className="dca-phase1">
            <rect x={142} y={116} width={24} height={12} rx={2.5} fill={O} fillOpacity="0.15" />
            <text x={154} y={125} textAnchor="middle" fill={O} fontSize="6.5" fontWeight="bold" fontFamily="system-ui,sans-serif">NEW</text>
          </g>

          <g className="dca-v3" style={{ transformOrigin: '170px 122px' }}>
            <rect x={140} y={116} width={62} height={12} rx={2.5} fill={DANGER} fillOpacity="0.1" stroke={DANGER} strokeOpacity="0.3" strokeWidth="0.5" />
            <text x={171} y={125} textAnchor="middle" fill={DANGER} fontSize="6.5" fontWeight="bold" fontFamily="system-ui,sans-serif">QUARANTINED</text>
          </g>
        </g>

        {/* ===== PHASE 1: NO VISIBILITY ===== */}
        <g className="dca-phase1">
          <svg x={374} y={55} width={30} height={30} viewBox="0 0 256 256">
            <path d={EYE_SLASH_D} fill={DANGER} fillOpacity="0.55" />
          </svg>
          <text x={389} y={96} textAnchor="middle" fill={DANGER} fillOpacity="0.5" fontSize="7.5" fontFamily="system-ui,sans-serif">No visibility</text>

          <line className="dca-line" x1="325" y1="70" x2="455" y2="70"
            stroke={DANGER} strokeOpacity="0.25" strokeWidth="1.5" strokeDasharray="4 3" />
          <line className="dca-line" x1="325" y1="94" x2="455" y2="94"
            stroke={DANGER} strokeOpacity="0.25" strokeWidth="1.5" strokeDasharray="4 3" />
          <line className="dca-line" x1="325" y1="122" x2="455" y2="122"
            stroke={DANGER} strokeOpacity="0.25" strokeWidth="1.5" strokeDasharray="4 3" />

          {[70, 94].map((ey) => (
            <svg key={ey} x={284} y={ey - 9} width={16} height={16} viewBox="0 0 256 256">
              <path d={EYE_SLASH_D} fill={DANGER} fillOpacity="0.35" />
            </svg>
          ))}
        </g>

        {/* ===== PHASE 2: EDISON WATCH ACTIVE ===== */}

        <g className="dca-phase2">
          <rect x={24} y={50} width={254} height={104} rx={6}
            fill={accent} fillOpacity="0.02" stroke={accent} strokeOpacity="0.4" strokeWidth="1.5" />
          <EdisonLogo x={10} y={38} w={18} h={17.5} />
          <svg x={260} y={34} width={14} height={14} viewBox="0 0 256 256">
            <path d={SHIELD_CHECK_D} fill={accent} fillOpacity="0.6" />
          </svg>
        </g>

        <g className="dca-edison" style={{ transformOrigin: '279px 151px' }}>
          <circle className="dca-pulse" cx={279} cy={151} r={12}
            fill="none" stroke={accent} strokeOpacity="0.5" strokeWidth="1.5" />
          <EdisonLogo x={270} y={142} w={18} h={17.5} />
        </g>

        <g className="dca-scan">
          <line x1={30} y1={56} x2={272} y2={56}
            stroke={accent} strokeOpacity="0.5" strokeWidth="1.5" />
          <rect x={30} y={56} width={242} height={4} rx={1}
            fill={accent} fillOpacity="0.06" />
        </g>

        <g className="dca-phase2">
          <svg x={374} y={55} width={30} height={30} viewBox="0 0 256 256">
            <path d={EYE_D} fill={accent} fillOpacity="0.75" />
          </svg>
          <text x={389} y={96} textAnchor="middle" fill={accent} fillOpacity="0.8" fontSize="7.5" fontWeight="bold" fontFamily="system-ui,sans-serif">Full visibility</text>

          <line className="dca-line" x1="325" y1="70" x2="455" y2="70"
            stroke={accent} strokeOpacity="0.35" strokeWidth="1.5" strokeDasharray="3 3" />
          <line className="dca-line" x1="325" y1="94" x2="455" y2="94"
            stroke={accent} strokeOpacity="0.35" strokeWidth="1.5" strokeDasharray="3 3" />
          <line className="dca-line" x1="325" y1="122" x2="455" y2="122"
            stroke={accent} strokeOpacity="0.35" strokeWidth="1.5" strokeDasharray="3 3" />
        </g>

        {/* Verdict badges */}
        <g className="dca-v1" style={{ transformOrigin: '290px 70px' }}>
          <circle cx={290} cy={70} r={7} fill={accent} fillOpacity="0.12" stroke={accent} strokeOpacity="0.5" strokeWidth="1" />
          <polyline points="286,70 289,73 294,67" fill="none" stroke={accent} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </g>
        <g className="dca-v2" style={{ transformOrigin: '290px 94px' }}>
          <circle cx={290} cy={94} r={7} fill={accent} fillOpacity="0.12" stroke={accent} strokeOpacity="0.5" strokeWidth="1" />
          <polyline points="286,94 289,97 294,91" fill="none" stroke={accent} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </g>
        <g className="dca-v3" style={{ transformOrigin: '290px 122px' }}>
          <circle cx={290} cy={122} r={7} fill={DANGER} fillOpacity="0.12" stroke={DANGER} strokeOpacity="0.5" strokeWidth="1" />
          <line x1={287} y1={119} x2={293} y2={125} stroke={DANGER} strokeWidth="1.5" strokeLinecap="round" />
          <line x1={293} y1={119} x2={287} y2={125} stroke={DANGER} strokeWidth="1.5" strokeLinecap="round" />
        </g>

        {/* ===== ADMIN DASHBOARD (phase 2 only) ===== */}
        <g className="dca-phase2">
          <svg x={478} y={8} width={22} height={22} viewBox="0 0 256 256">
            <path d={ADMIN_D} fill={fg} fillOpacity="0.6" />
          </svg>
          <text x={489} y={38} textAnchor="middle" fill={fg} fontSize="8" fontWeight="bold" fontFamily="system-ui,sans-serif">Admin</text>
        </g>

        <g className="dca-phase2">
          <rect x={455} y={52} width={90} height={90} rx={5}
            fill={fg} fillOpacity="0.02"
            stroke={accent} strokeOpacity="0.2" strokeWidth="1" />
          <text x={500} y={48} textAnchor="middle" fill={accent} fontSize="6.5" fontFamily="system-ui,sans-serif" fillOpacity="0.6">Detected</text>

          <McpIcon x={462} y={58} size={14} color={accent} opacity="0.45" />
          <rect x={480} y={62} width={36} height={5} rx={1.5} fill={accent} fillOpacity="0.12" />
          <circle cx={524} cy={65} r={2.5} fill={accent} fillOpacity="0.5" />

          <McpIcon x={462} y={78} size={14} color={accent} opacity="0.45" />
          <rect x={480} y={82} width={32} height={5} rx={1.5} fill={accent} fillOpacity="0.12" />
          <circle cx={524} cy={85} r={2.5} fill={accent} fillOpacity="0.5" />

          <McpIcon x={462} y={98} size={14} color={DANGER} opacity="0.5" />
          <rect x={480} y={102} width={28} height={5} rx={1.5} fill={DANGER} fillOpacity="0.1" />
          <svg x={518} y={99} width={12} height={12} viewBox="0 0 256 256">
            <path d={SHIELD_CHECK_D} fill={DANGER} fillOpacity="0.5" />
          </svg>
          <rect x={462} y={116} width={80} height={16} rx={3} fill={accent} fillOpacity="0.06" stroke={accent} strokeOpacity="0.25" strokeWidth="0.8" />
          <text x={502} y={127} textAnchor="middle" fill={accent} fontSize="6.5" fontWeight="bold" fontFamily="system-ui,sans-serif" fillOpacity="0.7">Review &amp; Approve</text>
        </g>

        {/* Notification packet */}
        <g className="dca-pkt dca-pkt1"><Packet /></g>

        {/* Labels */}
        <text x="167" y="192" textAnchor="middle" fill={fg} fontSize="9" fontWeight="bold" fontFamily="system-ui,sans-serif">Employee Laptop</text>
        <g className="dca-phase2">
          <text x="167" y="204" textAnchor="middle" fill={accent} fontSize="7.5" fontFamily="system-ui,sans-serif">Running Edison Watch</text>
        </g>
        <g className="dca-phase2">
          <text x="500" y="158" textAnchor="middle" fill={fg} fontSize="8" fontWeight="bold" fontFamily="system-ui,sans-serif">Admin Dashboard</text>
        </g>

        {/* Progress bar */}
        <rect x="20" y="248" width="580" height="1.5" rx="0.75" fill={fg} fillOpacity="0.1" />
        <rect className="dca-progress" x="20" y="248" width="580" height="1.5" rx="0.75" fill={fg} fillOpacity="0.35" />
      </svg>
    </div>
  )
}
