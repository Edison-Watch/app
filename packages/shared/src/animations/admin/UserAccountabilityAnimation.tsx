/**
 * User Accountability animation for documentation.
 *
 * Shows two modes of Edison policy enforcement:
 *
 * Phase 1 – "Auto-deny": An agent action matches an admin-defined
 *           policy rule and is automatically blocked by Edison.
 * Phase 2 – "Human-in-the-loop": An agent action requires human
 *           judgment. Edison routes the approval request back to the
 *           user at their laptop. The user approves, the action
 *           proceeds, and the user is accountable.
 *
 * 10s loop. Pure SVG + CSS. Respects `prefers-reduced-motion`.
 */
import { AGENT_REGISTRY } from '../../agent-registry/index'
import {
  ADMIN_PATH,
  AgentIcon,
  DANGER,
  EdisonLogo,
  McpIcon,
  McpPacket,
  ORANGE as O,
  ProgressBar
} from '../_shared'

const CURSOR = AGENT_REGISTRY['cursor']
const CLAUDE = AGENT_REGISTRY['claude-code']
const CODEX = AGENT_REGISTRY['codex']
const COPILOT = AGENT_REGISTRY['copilot']

const USER_PATH =
  'M230.92,212c-15.23-26.33-38.7-45.21-66.09-54.16a72,72,0,1,0-73.66,0C63.78,166.78,40.31,185.66,25.08,212a8,8,0,1,0,13.85,8c18.84-32.56,52.14-52,89.07-52s70.23,19.44,89.07,52a8,8,0,1,0,13.85-8ZM72,96a56,56,0,1,1,56,56A56.06,56.06,0,0,1,72,96Z'

const CLIPBOARD_PATH =
  'M200,32H163.74a47.92,47.92,0,0,0-71.48,0H56A16,16,0,0,0,40,48V216a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V48A16,16,0,0,0,200,32Zm-72,0a32,32,0,0,1,32,32H96A32,32,0,0,1,128,32Zm72,184H56V48H82.75A47.93,47.93,0,0,0,80,64v8a8,8,0,0,0,8,8h80a8,8,0,0,0,8-8V64a47.93,47.93,0,0,0-2.75-16H200ZM96,136a8,8,0,0,1,8-8h48a8,8,0,0,1,0,16H104A8,8,0,0,1,96,136Zm0,32a8,8,0,0,1,8-8h48a8,8,0,0,1,0,16H104A8,8,0,0,1,96,168Z'

const POLICY_D =
  'M208,40H48A16,16,0,0,0,32,56v56c0,52.72,25.52,84.67,46.93,102.19,23.06,18.86,46,25.26,47,25.53a8,8,0,0,0,4.2,0c1-.27,23.91-6.67,47-25.53C198.48,196.67,224,164.72,224,112V56A16,16,0,0,0,208,40Zm0,72c0,37.07-13.66,67.16-40.6,89.42A129.3,129.3,0,0,1,128,223.62a128.25,128.25,0,0,1-38.92-21.81C61.82,179.51,48,149.3,48,112l0-56,160,0ZM96,104a8,8,0,0,1,8-8h64a8,8,0,0,1,0,16H104A8,8,0,0,1,96,104Zm8,40h64a8,8,0,0,0,0-16H104a8,8,0,0,0,0,16Z'

/*
 * Coordinate reference
 *
 *   Canvas ────── 600 × 310
 *   User icon ─── centre (58, 53)
 *   Laptop ────── x 10–126, y 80–158,  centre (68, 119)
 *   Admin ─────── centre (302, 16)
 *   Edison ────── x 224–356, y 54–224,  centre (290, 139)
 *   MCP Server ── x 446–530, y 100–166, centre (488, 133)
 *   Flow arrows   y = 130
 */

const CSS = `
.ua { color: var(--text-primary); }

.ua .ua-line { stroke-dashoffset:0; animation: ua-lf 2s linear infinite; }
.ua .ua-pkt path, .ua .ua-pkt circle { fill: currentColor; }

/* ── phase visibility ── */
.ua .ua-p1     { animation: ua-p1  10s ease-in-out infinite; }
.ua .ua-p2     { animation: ua-p2  10s ease-in-out infinite; }

/* ── packets ── */
.ua .ua-pkt1   { color:${DANGER}; animation: ua-pkt1 10s ease-in-out infinite; }
.ua .ua-pkt2a  { color:${O}; animation: ua-pkt2a 10s ease-in-out infinite; }
.ua .ua-pkt2c  { color:${O}; animation: ua-pkt2c 10s ease-in-out infinite; }

/* ── policy panel highlights ── */
.ua .ua-rule-a { animation: ua-rule-a 10s ease-in-out infinite; }
.ua .ua-rule-c { animation: ua-rule-c 10s ease-in-out infinite; }

/* ── verdict badges ── */
.ua .ua-deny   { animation: ua-deny 10s ease-in-out infinite; }
.ua .ua-approve{ animation: ua-approve 10s ease-in-out infinite; }

/* ── misc fades ── */
.ua .ua-log1   { animation: ua-log1 10s ease-in-out infinite; }
.ua .ua-log2   { animation: ua-log2 10s ease-in-out infinite; }
.ua .ua-ask-arrow   { animation: ua-ask-arrow 10s ease-in-out infinite; }
.ua .ua-user-prompt { animation: ua-user-prompt 10s ease-in-out infinite; }
.ua .ua-mcp-glow    { animation: ua-mcp-glow 10s ease-in-out infinite; }

/* Edison pulse ring */
.ua .ua-pulse { transform-origin:290px 139px; animation: ua-pulse 1.5s cubic-bezier(.2,.8,.4,1) infinite; }

/* ═══════════ KEYFRAMES ═══════════ */
@keyframes ua-lf { to { stroke-dashoffset: -12; } }

@keyframes ua-p1 {
  0%,40%  { opacity:1; }
  46%     { opacity:0; }
  100%    { opacity:0; }
}
@keyframes ua-p2 {
  0%,48%  { opacity:0; }
  52%     { opacity:1; }
  90%     { opacity:1; }
  96%     { opacity:0; }
  100%    { opacity:0; }
}

/* ── Phase 1 packet: laptop → Edison ── */
@keyframes ua-pkt1 {
  0%,4%   { opacity:0; }
  5%      { transform:translate(132px,130px); opacity:0; }
  6%      { transform:translate(132px,130px); opacity:.8; }
  18%     { transform:translate(222px,130px); opacity:1; }
  20%     { transform:translate(224px,130px); opacity:.5; }
  22%     { transform:translate(224px,130px); opacity:0; }
  23%,100%{ opacity:0; }
}

@keyframes ua-rule-a {
  0%,14%  { fill-opacity:0; }
  18%     { fill-opacity:0.18; }
  32%     { fill-opacity:0.18; }
  38%     { fill-opacity:0; }
  100%    { fill-opacity:0; }
}

@keyframes ua-deny {
  0%,18%  { opacity:0; transform:scale(0.5); }
  22%     { opacity:1; transform:scale(1.15); }
  25%     { opacity:1; transform:scale(1); }
  38%     { opacity:1; transform:scale(1); }
  42%     { opacity:0; transform:scale(1); }
  100%    { opacity:0; }
}

@keyframes ua-log1 {
  0%,26%  { opacity:0; }
  30%     { opacity:1; }
  38%     { opacity:1; }
  42%     { opacity:0; }
  100%    { opacity:0; }
}

/* ── Phase 2 packet A: laptop → Edison ── */
@keyframes ua-pkt2a {
  0%,52%  { opacity:0; }
  53%     { transform:translate(132px,130px); opacity:0; }
  54%     { transform:translate(132px,130px); opacity:.8; }
  64%     { transform:translate(222px,130px); opacity:1; }
  65%     { transform:translate(224px,130px); opacity:.3; }
  66%     { transform:translate(224px,130px); opacity:0; }
  67%,100%{ opacity:0; }
}

@keyframes ua-rule-c {
  0%,62%  { fill-opacity:0; }
  65%     { fill-opacity:0.18; }
  86%     { fill-opacity:0.18; }
  90%     { fill-opacity:0; }
  100%    { fill-opacity:0; }
}

/* ── Phase 2: Edison → User ask arrow (fades in, no packet) ── */
@keyframes ua-ask-arrow {
  0%,63%  { opacity:0; }
  67%     { opacity:1; }
  84%     { opacity:1; }
  88%     { opacity:0; }
  100%    { opacity:0; }
}

@keyframes ua-user-prompt {
  0%,66%  { opacity:0; }
  70%     { opacity:1; }
  80%     { opacity:1; }
  84%     { opacity:0; }
  100%    { opacity:0; }
}

@keyframes ua-approve {
  0%,76%  { opacity:0; transform:scale(0.5); }
  79%     { opacity:1; transform:scale(1.15); }
  81%     { opacity:1; transform:scale(1); }
  88%     { opacity:1; transform:scale(1); }
  92%     { opacity:0; transform:scale(1); }
  100%    { opacity:0; }
}

/* ── Phase 2 packet C: Edison → MCP ── */
@keyframes ua-pkt2c {
  0%,79%  { opacity:0; }
  80%     { transform:translate(358px,130px); opacity:0; color:var(--accent); }
  81%     { transform:translate(358px,130px); opacity:.8; color:var(--accent); }
  87%     { transform:translate(444px,130px); opacity:1;  color:var(--accent); }
  88%     { transform:translate(444px,130px); opacity:0; }
  89%,100%{ opacity:0; }
}

@keyframes ua-mcp-glow {
  0%,85%  { fill-opacity:0; }
  88%     { fill-opacity:0.14; }
  90%     { fill-opacity:0.06; }
  92%     { fill-opacity:0; }
  100%    { fill-opacity:0; }
}

@keyframes ua-log2 {
  0%,82%  { opacity:0; }
  85%     { opacity:1; }
  90%     { opacity:1; }
  94%     { opacity:0; }
  100%    { opacity:0; }
}

@keyframes ua-pulse {
  0%   { transform:scale(1);   opacity:0; }
  10%  { transform:scale(1);   opacity:.35; }
  60%  { transform:scale(1.5); opacity:0; }
  100% { transform:scale(1.5); opacity:0; }
}

.ua .ua-progress { transform-origin:20px 302px; animation: ua-prog 10s linear infinite; }
@keyframes ua-prog {
  0%   { transform:scaleX(0); }
  100% { transform:scaleX(1); }
}

@media (prefers-reduced-motion:reduce) {
  .ua .ua-line, .ua .ua-pkt1, .ua .ua-pkt2a, .ua .ua-pkt2c,
  .ua .ua-pulse, .ua .ua-p1, .ua .ua-p2,
  .ua .ua-deny, .ua .ua-approve, .ua .ua-log1, .ua .ua-log2,
  .ua .ua-rule-a, .ua .ua-rule-c,
  .ua .ua-ask-arrow, .ua .ua-user-prompt, .ua .ua-mcp-glow { animation:none; }
  .ua .ua-pkt1, .ua .ua-pkt2a, .ua .ua-pkt2c { opacity:0; }
  .ua .ua-progress { animation:none; transform:scaleX(1); }
  .ua .ua-p1 { opacity:0; }
  .ua .ua-p2 { opacity:1; }
  .ua .ua-approve { opacity:1; transform:scale(1); }
  .ua .ua-ask-arrow { opacity:1; }
  .ua .ua-log2 { opacity:1; }
  .ua .ua-user-prompt { opacity:1; }
}
`

export default function UserAccountabilityAnimation(): React.ReactNode {
  return (
    <div className="flex justify-center">
      <style>{CSS}</style>
      <svg
        className="ua"
        width={600}
        height={310}
        viewBox="0 0 600 310"
        xmlns="http://www.w3.org/2000/svg"
        role="presentation"
        aria-hidden="true"
      >
        {/* ══════════════════════════════════════════════════════════
         *  USER - left, above laptop.  Icon centre (58, 53).
         * ══════════════════════════════════════════════════════════ */}
        <g>
          <svg x={47} y={42} width={22} height={22} viewBox="0 0 256 256">
            <path d={USER_PATH} fill="var(--text-primary)" fillOpacity="0.6" />
          </svg>
          <text
            x="58"
            y="38"
            textAnchor="middle"
            fill="var(--text-primary)"
            fillOpacity="0.5"
            fontSize="7"
            fontFamily="system-ui,sans-serif"
          >
            User
          </text>
        </g>

        {/* ══════════════════════════════════════════════════════════
         *  LAPTOP + AGENTS - left, below user.
         *  Body: x 10–126, y 80–158.  Centre (68, 119).
         * ══════════════════════════════════════════════════════════ */}
        <g>
          <rect
            x={10}
            y={80}
            width={116}
            height={78}
            rx={8}
            fill="var(--text-primary)"
            fillOpacity="0.03"
            stroke="var(--text-muted)"
            strokeOpacity="0.35"
            strokeWidth="1.5"
          />
          <rect
            x={6}
            y={160}
            width={124}
            height={6}
            rx={3}
            fill="var(--text-primary)"
            fillOpacity="0.04"
            stroke="var(--text-muted)"
            strokeOpacity="0.25"
            strokeWidth="1"
          />

          {/* 2×2 agent icons */}
          <AgentIcon agent={CLAUDE} x={22} y={90} size={22} />
          <AgentIcon agent={CURSOR} x={54} y={90} size={22} />
          <AgentIcon agent={CODEX} x={22} y={120} size={22} />
          <AgentIcon agent={COPILOT} x={54} y={120} size={22} />

          {/* MCP icons */}
          <McpIcon x={84} y={92} size={16} color="var(--text-muted)" opacity="0.35" />
          <McpIcon x={84} y={112} size={16} color="var(--text-muted)" opacity="0.35" />
          <McpIcon x={84} y={132} size={16} color="var(--text-muted)" opacity="0.35" />

          <text
            x="68"
            y="180"
            textAnchor="middle"
            fill="var(--text-primary)"
            fillOpacity="0.45"
            fontSize="7"
            fontFamily="system-ui,sans-serif"
          >
            Agents
          </text>
        </g>

        {/* ══════════════════════════════════════════════════════════
         *  ADMIN - top centre, always visible.  Icon centre (302, 16).
         * ══════════════════════════════════════════════════════════ */}
        <g>
          <svg x={291} y={5} width={22} height={22} viewBox="0 0 256 256">
            <path d={ADMIN_PATH} fill="var(--text-primary)" fillOpacity="0.7" />
          </svg>
          <text
            x="302"
            y="38"
            textAnchor="middle"
            fill="var(--text-primary)"
            fontSize="7"
            fontWeight="bold"
            fontFamily="system-ui,sans-serif"
          >
            Admin
          </text>
          <line
            x1="302"
            y1="40"
            x2="302"
            y2="54"
            stroke="var(--text-muted)"
            strokeOpacity="0.4"
            strokeWidth="1"
            strokeDasharray="2 2"
          />
        </g>

        {/* ══════════════════════════════════════════════════════════
         *  EDISON GATEWAY - centre, with policy panel.
         *  Container: x 224–356, y 54–224.  Centre (290, 139).
         * ══════════════════════════════════════════════════════════ */}
        <g>
          <circle
            className="ua-pulse"
            cx="290"
            cy="139"
            r="44"
            fill="none"
            stroke="var(--accent)"
            strokeOpacity="0.5"
            strokeWidth="1.5"
          />

          <rect
            x={224}
            y={54}
            width={132}
            height={170}
            rx={12}
            fill="var(--text-primary)"
            fillOpacity="0.02"
            stroke="var(--accent)"
            strokeOpacity="0.35"
            strokeWidth="1.5"
          />

          <EdisonLogo x={263} y={60} w={54} h={32} />
          <text
            x="290"
            y="104"
            textAnchor="middle"
            fill="var(--text-primary)"
            fontSize="8"
            fontWeight="bold"
            fontFamily="system-ui,sans-serif"
          >
            Edison Watch
          </text>

          {/* ── Policy panel ──
           *  Panel: x 234–342, y 116–204 (108×88)
           */}
          <rect
            x={234}
            y={116}
            width={108}
            height={88}
            rx={5}
            fill="var(--text-primary)"
            fillOpacity="0.03"
            stroke="var(--text-muted)"
            strokeOpacity="0.25"
            strokeWidth="1"
          />

          <svg x={238} y={119} width={14} height={14} viewBox="0 0 256 256">
            <path d={POLICY_D} fill="var(--text-primary)" fillOpacity="0.4" />
          </svg>
          <text
            x="255"
            y="130"
            textAnchor="start"
            fill="var(--text-primary)"
            fillOpacity="0.45"
            fontSize="6.5"
            fontFamily="system-ui,sans-serif"
          >
            Policy
          </text>

          {/* Rule A: deny - row y 136-156 (20px) */}
          <g>
            <rect
              className="ua-rule-a"
              x={236}
              y={136}
              width={104}
              height={20}
              rx={3}
              fill={DANGER}
              fillOpacity="0"
            />
            <line
              x1="244"
              y1="143"
              x2="249"
              y2="148"
              stroke={DANGER}
              strokeOpacity="0.6"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
            <line
              x1="249"
              y1="143"
              x2="244"
              y2="148"
              stroke={DANGER}
              strokeOpacity="0.6"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
            <text
              x="255"
              y="149"
              fill="var(--text-primary)"
              fillOpacity="0.45"
              fontSize="6.5"
              fontFamily="system-ui,sans-serif"
            >
              deny: delete_*
            </text>
          </g>

          {/* Rule B: deny - row y 156-176 (20px) */}
          <g>
            <line
              x1="244"
              y1="163"
              x2="249"
              y2="168"
              stroke={DANGER}
              strokeOpacity="0.6"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
            <line
              x1="249"
              y1="163"
              x2="244"
              y2="168"
              stroke={DANGER}
              strokeOpacity="0.6"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
            <text
              x="255"
              y="169"
              fill="var(--text-primary)"
              fillOpacity="0.45"
              fontSize="6.5"
              fontFamily="system-ui,sans-serif"
            >
              deny: send_email
            </text>
          </g>

          {/* Rule C: ask human - row y 176-196 (20px) */}
          <g>
            <rect
              className="ua-rule-c"
              x={236}
              y={176}
              width={104}
              height={20}
              rx={3}
              fill="var(--accent)"
              fillOpacity="0"
            />
            <circle
              cx="246.5"
              cy="186"
              r="4.5"
              fill="var(--accent)"
              fillOpacity="0.15"
              stroke="var(--accent)"
              strokeOpacity="0.5"
              strokeWidth="0.8"
            />
            <text
              x="246.5"
              y="188.5"
              textAnchor="middle"
              fill="var(--accent)"
              fillOpacity="0.7"
              fontSize="5.5"
              fontWeight="bold"
              fontFamily="system-ui,sans-serif"
            >
              ?
            </text>
            <text
              x="255"
              y="189"
              fill="var(--text-primary)"
              fillOpacity="0.45"
              fontSize="6.5"
              fontFamily="system-ui,sans-serif"
            >
              ask: write_db
            </text>
          </g>
        </g>

        {/* ══════════════════════════════════════════════════════════
         *  MCP SERVER - right.
         *  Box: x 446–530, y 100–166.  Centre (488, 133).
         * ══════════════════════════════════════════════════════════ */}
        <g>
          <rect
            x={446}
            y={100}
            width={84}
            height={66}
            rx={8}
            fill="var(--text-primary)"
            fillOpacity="0.03"
            stroke="var(--text-muted)"
            strokeOpacity="0.35"
            strokeWidth="1.5"
          />
          <McpIcon x={474} y={108} size={28} color="var(--text-muted)" opacity="0.55" />
          <text
            x="488"
            y="156"
            textAnchor="middle"
            fill="var(--text-primary)"
            fillOpacity="0.5"
            fontSize="7"
            fontFamily="system-ui,sans-serif"
          >
            MCP Server
          </text>
          <rect
            className="ua-mcp-glow"
            x={442}
            y={96}
            width={92}
            height={74}
            rx={10}
            fill="var(--accent)"
            fillOpacity="0"
          />
        </g>

        {/* ══════════════════════════════════════════════════════════
         *  PHASE 1: Auto-deny
         * ══════════════════════════════════════════════════════════ */}
        <g className="ua-p1">
          <line
            className="ua-line"
            x1="130"
            y1="130"
            x2="224"
            y2="130"
            stroke="var(--text-muted)"
            strokeOpacity="0.5"
            strokeWidth="1.5"
            strokeDasharray="3 3"
          />

          <g className="ua-deny" style={{ transformOrigin: '252px 82px' }}>
            <circle
              cx="252"
              cy="82"
              r="12"
              fill={DANGER}
              fillOpacity="0.15"
              stroke={DANGER}
              strokeOpacity="0.6"
              strokeWidth="1.2"
            />
            <line
              x1="247"
              y1="77"
              x2="257"
              y2="87"
              stroke={DANGER}
              strokeWidth="2.2"
              strokeLinecap="round"
            />
            <line
              x1="257"
              y1="77"
              x2="247"
              y2="87"
              stroke={DANGER}
              strokeWidth="2.2"
              strokeLinecap="round"
            />
          </g>

          <g className="ua-log1">
            <text
              x="290"
              y="242"
              textAnchor="middle"
              fill={DANGER}
              fillOpacity="0.7"
              fontSize="8"
              fontWeight="bold"
              fontFamily="system-ui,sans-serif"
            >
              Blocked by policy
            </text>
          </g>

          <g className="ua-log1">
            <svg x={334} y={22} width={13} height={13} viewBox="0 0 256 256">
              <path d={CLIPBOARD_PATH} fill="var(--text-primary)" fillOpacity="0.4" />
            </svg>
            <text
              x="350"
              y="32"
              fill="var(--text-primary)"
              fillOpacity="0.5"
              fontSize="6"
              fontFamily="system-ui,sans-serif"
            >
              Logged
            </text>
          </g>
        </g>

        {/* ══════════════════════════════════════════════════════════
         *  PHASE 2: Human-in-the-loop
         * ══════════════════════════════════════════════════════════ */}
        <g className="ua-p2">
          <line
            className="ua-line"
            x1="130"
            y1="130"
            x2="224"
            y2="130"
            stroke="var(--text-muted)"
            strokeOpacity="0.5"
            strokeWidth="1.5"
            strokeDasharray="3 3"
          />

          <line
            className="ua-line ua-ask-arrow"
            x1="224"
            y1="108"
            x2="76"
            y2="58"
            stroke="var(--accent)"
            strokeOpacity="0.35"
            strokeWidth="1.5"
            strokeDasharray="3 3"
          />

          <line
            className="ua-line"
            x1="356"
            y1="130"
            x2="446"
            y2="130"
            stroke="var(--accent)"
            strokeOpacity="0.4"
            strokeWidth="1.5"
            strokeDasharray="3 3"
          />

          <g className="ua-user-prompt">
            <rect
              x={80}
              y={30}
              width={64}
              height={28}
              rx={6}
              fill="var(--accent)"
              fillOpacity="0.05"
              stroke="var(--accent)"
              strokeOpacity="0.45"
              strokeWidth="1"
            />
            <text
              x="112"
              y="48"
              textAnchor="middle"
              fill="var(--accent)"
              fillOpacity="0.75"
              fontSize="7"
              fontWeight="bold"
              fontFamily="system-ui,sans-serif"
            >
              Approve?
            </text>
          </g>

          <g className="ua-approve" style={{ transformOrigin: '130px 38px' }}>
            <circle
              cx="130"
              cy="38"
              r="9"
              fill="var(--accent)"
              fillOpacity="0.15"
              stroke="var(--accent)"
              strokeOpacity="0.6"
              strokeWidth="1"
            />
            <polyline
              points="125,38 128,41 135,34"
              fill="none"
              stroke="var(--accent)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>

          <g className="ua-approve" style={{ transformOrigin: '340px 78px' }}>
            <circle
              cx="340"
              cy="78"
              r="9"
              fill="var(--accent)"
              fillOpacity="0.12"
              stroke="var(--accent)"
              strokeOpacity="0.5"
              strokeWidth="1"
            />
            <polyline
              points="335,78 338,81 345,74"
              fill="none"
              stroke="var(--accent)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>

          <g className="ua-log2">
            <rect
              x={240}
              y={238}
              width={124}
              height={50}
              rx={5}
              fill="var(--text-primary)"
              fillOpacity="0.03"
              stroke="var(--text-muted)"
              strokeOpacity="0.2"
              strokeWidth="1"
            />
            <text
              x="250"
              y="254"
              fill="var(--text-primary)"
              fillOpacity="0.5"
              fontSize="6"
              fontFamily="system-ui,sans-serif"
            >
              ▸ Agent: write_db
            </text>
            <text
              x="250"
              y="268"
              fill="var(--accent)"
              fillOpacity="0.7"
              fontSize="6"
              fontWeight="bold"
              fontFamily="system-ui,sans-serif"
            >
              ▸ User approved ✓
            </text>
            <text
              x="250"
              y="282"
              fill="var(--text-primary)"
              fillOpacity="0.5"
              fontSize="6"
              fontFamily="system-ui,sans-serif"
            >
              ▸ User accountable
            </text>
          </g>

          <g className="ua-log2">
            <svg x={334} y={22} width={13} height={13} viewBox="0 0 256 256">
              <path d={CLIPBOARD_PATH} fill="var(--accent)" fillOpacity="0.5" />
            </svg>
            <text
              x="350"
              y="32"
              fill="var(--accent)"
              fillOpacity="0.6"
              fontSize="6"
              fontFamily="system-ui,sans-serif"
            >
              Full audit trail
            </text>
          </g>
        </g>

        {/* ══ PACKETS ══ */}
        <g className="ua-pkt ua-pkt1">
          <McpPacket />
        </g>
        <g className="ua-pkt ua-pkt2a">
          <McpPacket />
        </g>
        <g className="ua-pkt ua-pkt2c">
          <McpPacket />
        </g>

        {/* ══ PROGRESS BAR ══ */}
        <ProgressBar y={302} width={560} className="ua-progress" />
      </svg>
    </div>
  )
}
