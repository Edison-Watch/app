/**
 * STDIO vs HTTP MCP security comparison animation.
 *
 * Split-screen. Each side: Laptop (robot) → MCP server → Admin.
 *   Left:  MCP executes inside laptop. Admin has eye-slash (no visibility).
 *   Right: MCP executes remotely behind gateway. Admin has eye (full visibility).
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
  SHIELD_CHECK_PATH,
} from './_shared'

const G = '#3ddc84'

const ROBOT_PATH =
  'M200,48H136V16a8,8,0,0,0-16,0V48H56A32,32,0,0,0,24,80V192a32,32,0,0,0,32,32H200a32,32,0,0,0,32-32V80A32,32,0,0,0,200,48Zm16,144a16,16,0,0,1-16,16H56a16,16,0,0,1-16-16V80A16,16,0,0,1,56,64H200a16,16,0,0,1,16,16Zm-52-56H92a28,28,0,0,0,0,56h72a28,28,0,0,0,0-56Zm-24,16v24H116V152ZM80,164a12,12,0,0,1,12-12h8v24H92A12,12,0,0,1,80,164Zm84,12h-8V152h8a12,12,0,0,1,0,24ZM72,108a12,12,0,1,1,12,12A12,12,0,0,1,72,108Zm88,0a12,12,0,1,1,12,12A12,12,0,0,1,160,108Z'

const MALWARE_PATH =
  'M136,108a28,28,0,1,0-28,28A28,28,0,0,0,136,108Zm-28,12a12,12,0,1,1,12-12A12,12,0,0,1,108,120Zm68-8a16,16,0,1,1-16,16A16,16,0,0,1,176,112Zm-32,64a16,16,0,1,1-16-16A16,16,0,0,1,144,176Zm96-56H223.66a95.52,95.52,0,0,0-22.39-53.95l12.39-12.39a8,8,0,0,0-11.32-11.32L190,54.73A95.52,95.52,0,0,0,136,32.34V16a8,8,0,0,0-16,0V32.34A95.52,95.52,0,0,0,66.05,54.73L53.66,42.34A8,8,0,0,0,42.34,53.66L54.73,66.05a95.52,95.52,0,0,0-22.39,54H16a8,8,0,0,0,0,16H32.34A95.52,95.52,0,0,0,54.73,190L42.34,202.34a8,8,0,0,0,11.32,11.32l12.39-12.39a95.52,95.52,0,0,0,54,22.39V240a8,8,0,0,0,16,0V223.66A95.52,95.52,0,0,0,190,201.27l12.39,12.39a8,8,0,0,0,11.32-11.32L201.27,190A95.52,95.52,0,0,0,223.66,136H240a8,8,0,0,0,0-16ZM128,208a80,80,0,1,1,80-80A80.09,80.09,0,0,1,128,208Z'

const CSS = `
.sh-anim { color: var(--text-primary); }
.sh-anim .sh-line { stroke-dashoffset: 0; animation: sh-lf 2s linear infinite; }

.sh-anim .sh-spawn   { animation: sh-spawn 12s ease-in-out infinite; }
.sh-anim .sh-m0      { animation: sh-m0 12s ease-in-out infinite; }
.sh-anim .sh-m1      { animation: sh-m1 12s ease-in-out infinite; }
.sh-anim .sh-m2      { animation: sh-m2 12s ease-in-out infinite; }
.sh-anim .sh-m3      { animation: sh-m3 12s ease-in-out infinite; }
.sh-anim .sh-admin-l { animation: sh-admin-l 12s ease-in-out infinite; }

.sh-anim .sh-hreq    { animation: sh-hreq 12s ease-in-out infinite; }
.sh-anim .sh-hpkt    { animation: sh-hpkt 12s ease-in-out infinite; }
.sh-anim .sh-block   { animation: sh-block 12s ease-in-out infinite; }
.sh-anim .sh-fpulse  { transform-origin: 418px 72px; animation: sh-fpulse 1.5s ease-in-out infinite; }
.sh-anim .sh-admin-r { animation: sh-admin-r 12s ease-in-out infinite; }

@keyframes sh-lf { to { stroke-dashoffset: -12; } }

@keyframes sh-spawn {
  0%,8%  { opacity:0; } 14% { opacity:1; } 92% { opacity:1; } 97%,100% { opacity:0; }
}

/* Malware origin: starts inside MCP box center (93,37), grows. Stays visible once appeared. */
@keyframes sh-m0 {
  0%,15% { opacity:0; transform:translate(93px,37px) scale(0); }
  22%    { opacity:1; transform:translate(93px,37px) scale(1); }
  30%    { opacity:1; transform:translate(80px,70px) scale(1); }
  100%   { opacity:1; transform:translate(80px,70px) scale(1); }
}
/* Spreads to bottom-left of laptop */
@keyframes sh-m1 {
  0%,24% { opacity:0; transform:translate(93px,37px) scale(0); }
  28%    { opacity:0.4; transform:translate(93px,37px) scale(.5); }
  40%    { opacity:0.8; transform:translate(28px,90px) scale(1); }
  100%   { opacity:0.8; transform:translate(28px,90px) scale(1); }
}
/* Spreads to bottom-right of laptop */
@keyframes sh-m2 {
  0%,32% { opacity:0; transform:translate(93px,37px) scale(0); }
  36%    { opacity:0.4; transform:translate(93px,37px) scale(.5); }
  48%    { opacity:0.7; transform:translate(136px,86px) scale(1); }
  100%   { opacity:0.7; transform:translate(136px,86px) scale(1); }
}
/* Spreads to center-right area */
@keyframes sh-m3 {
  0%,40% { opacity:0; transform:translate(93px,37px) scale(0); }
  44%    { opacity:0.3; transform:translate(93px,37px) scale(.5); }
  56%    { opacity:0.6; transform:translate(142px,60px) scale(1); }
  100%   { opacity:0.6; transform:translate(142px,60px) scale(1); }
}

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
@keyframes sh-prog { 0% { transform:scaleX(0); } 100% { transform:scaleX(1); } }

@media (prefers-reduced-motion:reduce) {
  .sh-anim .sh-line, .sh-anim .sh-spawn,
  .sh-anim .sh-m0, .sh-anim .sh-m1, .sh-anim .sh-m2, .sh-anim .sh-m3,
  .sh-anim .sh-admin-l,
  .sh-anim .sh-hreq, .sh-anim .sh-hpkt, .sh-anim .sh-block,
  .sh-anim .sh-fpulse, .sh-anim .sh-admin-r, .sh-anim .sh-progress { animation:none; }
  .sh-anim .sh-spawn, .sh-anim .sh-admin-l,
  .sh-anim .sh-hreq, .sh-anim .sh-block, .sh-anim .sh-admin-r { opacity:1; }
  .sh-anim .sh-m0 { opacity:1; transform:translate(80px,70px) scale(1); }
  .sh-anim .sh-m1 { opacity:.8; transform:translate(28px,90px) scale(1); }
  .sh-anim .sh-m2 { opacity:.7; transform:translate(136px,86px) scale(1); }
  .sh-anim .sh-m3 { opacity:.6; transform:translate(142px,60px) scale(1); }
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
          <marker id="sh-arrM" viewBox="0 0 10 10" refX="9" refY="5"
            markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0 1 L9 5 L0 9 Z" fill="var(--text-muted)" fillOpacity={0.6} />
          </marker>
        </defs>

        {/* Divider */}
        <line x1="265" y1="4" x2="265" y2="160"
          stroke="var(--text-muted)" strokeOpacity="0.15" strokeWidth="1" strokeDasharray="4 4" />

        {/* Headers */}
        <text x="130" y="13" textAnchor="middle"
          fill={R} fontSize="9" fontWeight="bold" fontFamily="system-ui,sans-serif" opacity="0.85">
          STDIO
        </text>
        <text x="398" y="13" textAnchor="middle"
          fill={G} fontSize="9" fontWeight="bold" fontFamily="system-ui,sans-serif" opacity="0.85">
          HTTP
        </text>

        {/* ===== LEFT: STDIO ===== */}

        {/* Laptop */}
        <rect x="8" y="22" width="170" height="100" rx="6"
          fill="var(--text-primary)" fillOpacity="0.03"
          stroke="var(--text-muted)" strokeOpacity="0.35" strokeWidth="1.5" />
        <rect x="4" y="124" width="178" height="6" rx="3"
          fill="var(--text-primary)" fillOpacity="0.04"
          stroke="var(--text-muted)" strokeOpacity="0.35" strokeWidth="1" />

        {/* Robot */}
        <svg x="14" y="28" width="24" height="24" viewBox="0 0 256 256">
          <path d={ROBOT_PATH} fill="var(--text-muted)" fillOpacity="0.55" />
        </svg>

        {/* Spawn arrow */}
        <g className="sh-spawn">
          <line className="sh-line" x1="40" y1="40" x2="58" y2="37"
            stroke="var(--text-muted)" strokeOpacity="0.5" strokeWidth="1"
            strokeDasharray="3 3" markerEnd="url(#sh-arrM)" />
        </g>

        {/* MCP process INSIDE laptop  -  always visible */}
        <g>
          <rect x="62" y="26" width="62" height="22" rx="4"
            fill={R} fillOpacity="0.05"
            stroke={R} strokeOpacity="0.4" strokeWidth="1.2" />
          <McpIcon x={78} y={30} size={14} color={R} opacity="0.7" />
          <text x="104" y="41" textAnchor="middle"
            fill={R} fontSize="6" fontWeight="bold" fontFamily="system-ui,sans-serif">
            MCP
          </text>
        </g>

        {/* Malware: origin inside MCP box, then spreads across laptop */}
        <g className="sh-m0">
          <svg x="-9" y="-9" width="18" height="18" viewBox="0 0 256 256">
            <path d={MALWARE_PATH} fill={R} fillOpacity="0.8" />
          </svg>
        </g>
        <g className="sh-m1">
          <svg x="-8" y="-8" width="16" height="16" viewBox="0 0 256 256">
            <path d={MALWARE_PATH} fill={R} fillOpacity="0.7" />
          </svg>
        </g>
        <g className="sh-m2">
          <svg x="-8" y="-8" width="16" height="16" viewBox="0 0 256 256">
            <path d={MALWARE_PATH} fill={R} fillOpacity="0.6" />
          </svg>
        </g>
        <g className="sh-m3">
          <svg x="-7" y="-7" width="14" height="14" viewBox="0 0 256 256">
            <path d={MALWARE_PATH} fill={R} fillOpacity="0.5" />
          </svg>
        </g>

        {/* Admin (STDIO)  -  no visibility */}
        <g className="sh-admin-l">
          <svg x="192" y="68" width="20" height="20" viewBox="0 0 256 256">
            <path d={ADMIN_PATH} fill={R} fillOpacity="0.45" />
          </svg>
          <svg x="218" y="68" width="20" height="20" viewBox="0 0 256 256">
            <path d={EYE_SLASH_PATH} fill={R} fillOpacity="0.5" />
          </svg>
          <line x1="188" y1="62" x2="188" y2="108"
            stroke={R} strokeOpacity="0.15" strokeWidth="0.8" strokeDasharray="3 2" />
          <text x="214" y="100" textAnchor="middle"
            fill={R} fontSize="5.5" fontFamily="system-ui,sans-serif" opacity="0.6">
            No visibility
          </text>
          <text x="214" y="110" textAnchor="middle"
            fill={R} fontSize="5" fontFamily="system-ui,sans-serif" opacity="0.45">
            No policy enforcement
          </text>
        </g>

        {/* ===== RIGHT: HTTP ===== */}

        {/* Laptop (smaller) */}
        <rect x="278" y="40" width="76" height="56" rx="5"
          fill="var(--text-primary)" fillOpacity="0.03"
          stroke="var(--text-muted)" strokeOpacity="0.35" strokeWidth="1.2" />
        <rect x="274" y="98" width="84" height="5" rx="2.5"
          fill="var(--text-primary)" fillOpacity="0.04"
          stroke="var(--text-muted)" strokeOpacity="0.35" strokeWidth="1" />

        {/* Robot */}
        <svg x="302" y="52" width="22" height="22" viewBox="0 0 256 256">
          <path d={ROBOT_PATH} fill="var(--text-muted)" fillOpacity="0.55" />
        </svg>

        {/* Request arrow */}
        <g className="sh-hreq">
          <line className="sh-line" x1="354" y1="68" x2="404" y2="68"
            stroke="var(--text-muted)" strokeOpacity="0.4" strokeWidth="1.2"
            strokeDasharray="3 3" markerEnd="url(#sh-arrM)" />
        </g>

        {/* Gateway */}
        <g className="sh-fpulse">
          <circle cx="418" cy="72" r="16"
            fill={G} fillOpacity="0.04" stroke={G} strokeOpacity="0.3" strokeWidth="1.2" />
          <svg x="409" y="63" width="18" height="18" viewBox="0 0 256 256">
            <path d={SHIELD_CHECK_PATH} fill={G} fillOpacity="0.55" />
          </svg>
        </g>

        {/* MCP Server remote */}
        <rect x="448" y="58" width="60" height="22" rx="4"
          fill="var(--text-primary)" fillOpacity="0.03"
          stroke="var(--text-muted)" strokeOpacity="0.25" strokeWidth="1" />
        <McpIcon x={463} y={62} size={14} color="var(--text-muted)" opacity="0.5" />
        <text x="489" y="73" textAnchor="middle"
          fill="var(--text-primary)" fontSize="6" fontWeight="600" fontFamily="system-ui,sans-serif" opacity="0.6">
          MCP
        </text>

        {/* Packet */}
        <g className="sh-hpkt">
          <rect x="-5" y="-3" width="10" height="6" rx="1.5"
            fill="var(--text-muted)" fillOpacity="0.3" stroke="var(--text-muted)" strokeOpacity="0.5" strokeWidth="0.6" />
        </g>

        {/* Gateway label */}
        <g className="sh-block">
          <text x="418" y="98" textAnchor="middle"
            fill={G} fontSize="6" fontWeight="600" fontFamily="system-ui,sans-serif" opacity="0.8">
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
          <line x1="360" y1="126" x2="418" y2="90"
            stroke={G} strokeOpacity="0.25" strokeWidth="1" strokeDasharray="3 2" />
          <text x="400" y="126" textAnchor="middle"
            fill={G} fontSize="5.5" fontFamily="system-ui,sans-serif" opacity="0.7">
            Full visibility
          </text>
        </g>

        {/* Bottom labels */}
        <text x="93" y="145" textAnchor="middle"
          fill={R} fontSize="6.5" fontWeight="600" fontFamily="system-ui,sans-serif" opacity="0.7">
          Executes locally on machine
        </text>
        <text x="398" y="152" textAnchor="middle"
          fill={G} fontSize="6.5" fontWeight="600" fontFamily="system-ui,sans-serif" opacity="0.7">
          Easily governable through MCP gateway
        </text>

        {/* Progress bar */}
        <ProgressBar y={168} width={490} className="sh-progress" />
      </svg>
    </div>
  )
}
