/**
 * STDIO vs HTTP MCP security comparison animation.
 *
 * Split-screen. Each side: Laptop (robot) → MCP server → Admin.
 *   Left:  MCP executes inside laptop. Admin has eye-slash (no visibility).
 *   Right: MCP executes remotely behind gateway. Admin has eye (full visibility).
 *
 * The left-side virus-spread visual is provided by `StdioVirusContent`.
 *
 * 12s loop. Pure SVG + CSS. Respects `prefers-reduced-motion`.
 *
 * Requires CSS custom properties: --text-primary, --accent, --text-muted.
 */

import {
  ADMIN_PATH,
  EYE_PATH,
  EYE_SLASH_PATH,
  McpIcon,
  ProgressBar,
  RED as R,
  RobotIcon,
  SHIELD_CHECK_PATH
} from '../_shared'
import { StdioVirusContent } from './StdioVirusAnimation'

const G = '#3ddc84'

const CSS = `
.sh-anim { color: var(--text-primary); }
.sh-anim .sh-line { stroke-dashoffset: 0; animation: sh-lf 2s linear infinite; }

.sh-anim .sh-admin-l { animation: sh-admin-l 12s ease-in-out infinite; }

.sh-anim .sh-hreq    { animation: sh-hreq 12s ease-in-out infinite; }
.sh-anim .sh-hpkt    { animation: sh-hpkt 12s ease-in-out infinite; }
.sh-anim .sh-block   { animation: sh-block 12s ease-in-out infinite; }
.sh-anim .sh-fpulse  { transform-origin: 418px 72px; animation: sh-fpulse 1.5s ease-in-out infinite; }
.sh-anim .sh-admin-r { animation: sh-admin-r 12s ease-in-out infinite; }

@keyframes sh-lf { to { stroke-dashoffset: -12; } }

@keyframes sh-admin-l {
  0%,26% { opacity:0; } 32% { opacity:1; } 92% { opacity:1; } 97%,100% { opacity:0; }
}

@keyframes sh-hreq {
  0%,10% { opacity:0; } 16% { opacity:1; } 92% { opacity:1; } 97%,100% { opacity:0; }
}
@keyframes sh-hpkt {
  0%,18%  { transform:translate(368px,72px); opacity:0; }
  20%     { transform:translate(368px,72px); opacity:.8; }
  34%     { transform:translate(404px,72px); opacity:1; }
  38%     { transform:translate(398px,72px); opacity:.4; }
  40%,100%{ transform:translate(394px,72px); opacity:0; }
}
@keyframes sh-block {
  0%,32% { opacity:0; } 36% { opacity:1; } 72% { opacity:1; } 78%,100% { opacity:0; }
}
@keyframes sh-fpulse {
  0%,100% { transform:scale(1); opacity:.6; } 50% { transform:scale(1.08); opacity:1; }
}
@keyframes sh-admin-r {
  0%,34% { opacity:0; } 40% { opacity:1; } 92% { opacity:1; } 97%,100% { opacity:0; }
}

.sh-anim .sh-progress { transform-origin:20px 168px; animation:sh-prog 12s linear infinite; }
@keyframes sh-prog { 0% { transform: scaleX(0); } 100% { transform: scaleX(1); } }

@media (prefers-reduced-motion:reduce) {
  .sh-anim .sh-line,
  .sh-anim .sh-admin-l,
  .sh-anim .sh-hreq, .sh-anim .sh-hpkt, .sh-anim .sh-block,
  .sh-anim .sh-fpulse, .sh-anim .sh-admin-r, .sh-anim .sh-progress { animation:none; }
  .sh-anim .sh-admin-l,
  .sh-anim .sh-hreq, .sh-anim .sh-block, .sh-anim .sh-admin-r { opacity:1; }
  .sh-anim .sh-hpkt { opacity:0; }
  .sh-anim .sh-fpulse { transform:scale(1); opacity:.8; }
  .sh-anim .sh-progress { transform:scaleX(1); }
}
`

export default function StdioVsHttpAnimation(): React.ReactNode {
  return (
    <div className="flex justify-center">
      <style>{CSS}</style>
      <svg
        className="sh-anim"
        viewBox="0 0 530 172"
        style={{ width: '100%', maxWidth: 530, height: 'auto' }}
        xmlns="http://www.w3.org/2000/svg"
        role="presentation"
        aria-hidden="true"
      >
        <defs>
          <marker
            id="sh-arrM"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto"
          >
            <path d="M0 1 L9 5 L0 9 Z" fill="var(--text-muted)" fillOpacity={0.6} />
          </marker>
        </defs>

        {/* Divider */}
        <line
          x1="265"
          y1="4"
          x2="265"
          y2="160"
          stroke="var(--text-muted)"
          strokeOpacity="0.15"
          strokeWidth="1"
          strokeDasharray="4 4"
        />

        {/* Headers */}
        <text
          x="130"
          y="13"
          textAnchor="middle"
          fill={R}
          fontSize="9"
          fontWeight="bold"
          fontFamily="system-ui,sans-serif"
          opacity="0.85"
        >
          STDIO
        </text>
        <text
          x="398"
          y="13"
          textAnchor="middle"
          fill={G}
          fontSize="9"
          fontWeight="bold"
          fontFamily="system-ui,sans-serif"
          opacity="0.85"
        >
          HTTP
        </text>

        {/* ===== LEFT: STDIO ===== */}

        {/* Laptop + robot + MCP + malware spread (extracted) */}
        <StdioVirusContent />

        {/* Admin (STDIO)  -  no visibility */}
        <g className="sh-admin-l">
          <svg x="192" y="68" width="20" height="20" viewBox="0 0 256 256">
            <path d={ADMIN_PATH} fill={R} fillOpacity="0.45" />
          </svg>
          <svg x="218" y="68" width="20" height="20" viewBox="0 0 256 256">
            <path d={EYE_SLASH_PATH} fill={R} fillOpacity="0.5" />
          </svg>
          <line
            x1="188"
            y1="62"
            x2="188"
            y2="108"
            stroke={R}
            strokeOpacity="0.15"
            strokeWidth="0.8"
            strokeDasharray="3 2"
          />
          <text
            x="214"
            y="100"
            textAnchor="middle"
            fill={R}
            fontSize="5.5"
            fontFamily="system-ui,sans-serif"
            opacity="0.6"
          >
            No visibility
          </text>
          <text
            x="214"
            y="110"
            textAnchor="middle"
            fill={R}
            fontSize="5"
            fontFamily="system-ui,sans-serif"
            opacity="0.45"
          >
            No policy enforcement
          </text>
        </g>

        {/* ===== RIGHT: HTTP ===== */}

        {/* Laptop (smaller) */}
        <rect
          x="278"
          y="40"
          width="76"
          height="56"
          rx="5"
          fill="var(--text-primary)"
          fillOpacity="0.03"
          stroke="var(--text-muted)"
          strokeOpacity="0.35"
          strokeWidth="1.2"
        />
        <rect
          x="274"
          y="98"
          width="84"
          height="5"
          rx="2.5"
          fill="var(--text-primary)"
          fillOpacity="0.04"
          stroke="var(--text-muted)"
          strokeOpacity="0.35"
          strokeWidth="1"
        />

        {/* Robot */}
        <RobotIcon x={302} y={52} size={22} fill="var(--text-muted)" fillOpacity="0.55" />

        {/* Request arrow */}
        <g className="sh-hreq">
          <line
            className="sh-line"
            x1="354"
            y1="68"
            x2="404"
            y2="68"
            stroke="var(--text-muted)"
            strokeOpacity="0.4"
            strokeWidth="1.2"
            strokeDasharray="3 3"
            markerEnd="url(#sh-arrM)"
          />
        </g>

        {/* Gateway */}
        <g className="sh-fpulse">
          <circle
            cx="418"
            cy="72"
            r="16"
            fill={G}
            fillOpacity="0.04"
            stroke={G}
            strokeOpacity="0.3"
            strokeWidth="1.2"
          />
          <svg x="409" y="63" width="18" height="18" viewBox="0 0 256 256">
            <path d={SHIELD_CHECK_PATH} fill={G} fillOpacity="0.55" />
          </svg>
        </g>

        {/* MCP Server remote */}
        <rect
          x="448"
          y="58"
          width="60"
          height="22"
          rx="4"
          fill="var(--text-primary)"
          fillOpacity="0.03"
          stroke="var(--text-muted)"
          strokeOpacity="0.25"
          strokeWidth="1"
        />
        <McpIcon x={463} y={62} size={14} color="var(--text-muted)" opacity="0.5" />
        <text
          x="489"
          y="73"
          textAnchor="middle"
          fill="var(--text-primary)"
          fontSize="6"
          fontWeight="600"
          fontFamily="system-ui,sans-serif"
          opacity="0.6"
        >
          MCP
        </text>

        {/* Packet */}
        <g className="sh-hpkt">
          <rect
            x="-5"
            y="-3"
            width="10"
            height="6"
            rx="1.5"
            fill="var(--text-muted)"
            fillOpacity="0.3"
            stroke="var(--text-muted)"
            strokeOpacity="0.5"
            strokeWidth="0.6"
          />
        </g>

        {/* Gateway label */}
        <g className="sh-block">
          <text
            x="418"
            y="98"
            textAnchor="middle"
            fill={G}
            fontSize="6"
            fontWeight="600"
            fontFamily="system-ui,sans-serif"
            opacity="0.8"
          >
            MCP Gateway
          </text>
        </g>

        {/* Admin (HTTP)  -  full visibility */}
        <g className="sh-admin-r">
          <svg x="310" y="116" width="20" height="20" viewBox="0 0 256 256">
            <path d={ADMIN_PATH} fill={G} fillOpacity="0.55" />
          </svg>
          <svg x="336" y="116" width="20" height="20" viewBox="0 0 256 256">
            <path d={EYE_PATH} fill={G} fillOpacity="0.6" />
          </svg>
          <line
            x1="360"
            y1="126"
            x2="418"
            y2="90"
            stroke={G}
            strokeOpacity="0.25"
            strokeWidth="1"
            strokeDasharray="3 2"
          />
          <text
            x="400"
            y="126"
            textAnchor="middle"
            fill={G}
            fontSize="5.5"
            fontFamily="system-ui,sans-serif"
            opacity="0.7"
          >
            Full visibility
          </text>
        </g>

        {/* Bottom labels */}
        <text
          x="93"
          y="145"
          textAnchor="middle"
          fill={R}
          fontSize="6.5"
          fontWeight="600"
          fontFamily="system-ui,sans-serif"
          opacity="0.7"
        >
          Executes locally on machine
        </text>
        <text
          x="398"
          y="152"
          textAnchor="middle"
          fill={G}
          fontSize="6.5"
          fontWeight="600"
          fontFamily="system-ui,sans-serif"
          opacity="0.7"
        >
          Easily governable through MCP gateway
        </text>

        {/* Progress bar */}
        <ProgressBar y={168} width={490} className="sh-progress" />
      </svg>
    </div>
  )
}
