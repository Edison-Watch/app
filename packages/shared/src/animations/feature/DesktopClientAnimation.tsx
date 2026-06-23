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
import { AGENT_REGISTRY } from "../../agent-registry/index";
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
  SHIELD_CHECK_PATH,
} from "../_shared";

const CLAUDE = AGENT_REGISTRY["claude-code"];
const CURSOR = AGENT_REGISTRY["cursor"];
const CODEX = AGENT_REGISTRY["codex"];

const fg = "var(--text-primary)";
const muted = "var(--text-muted)";
const accent = "var(--accent)";

const CSS = `.dca{color:${fg}}.dca .dca-line{stroke-dashoffset:0;animation:dca-lf 2s linear infinite}.dca .dca-pkt path,.dca .dca-pkt circle{fill:currentColor}.dca .dca-phase1{animation:dca-p1 12s ease-in-out infinite}.dca .dca-edison{animation:dca-ed 12s ease-in-out infinite;transform-origin:279px 151px}.dca .dca-phase2{animation:dca-p2 12s ease-in-out infinite}.dca .dca-rogue{animation:dca-rogue 12s ease-in-out infinite}.dca .dca-rglow{animation:dca-rglow 1.5s ease-in-out infinite}.dca .dca-pulse{transform-origin:279px 151px;animation:dca-pulse 1.33s cubic-bezier(.2,.8,.4,1) infinite}.dca .dca-v1{animation:dca-v1 12s ease-in-out infinite}.dca .dca-v2{animation:dca-v2 12s ease-in-out infinite}.dca .dca-v3{animation:dca-v3 12s ease-in-out infinite}.dca .dca-pkt1{color:${accent};animation:dca-pkt1 12s ease-in-out infinite}.dca .dca-scan{animation:dca-scan 12s ease-in-out infinite}.dca .dca-progress{transform-origin:20px 248px;animation:dca-prog 12s linear infinite}@keyframes dca-lf{to{stroke-dashoffset:-12}}@keyframes dca-p1{0%,46%{opacity:1}54%{opacity:0}100%{opacity:0}}@keyframes dca-ed{0%,48%{opacity:0;transform:scale(.85)}56%{opacity:1;transform:scale(1)}100%{opacity:1;transform:scale(1)}}@keyframes dca-p2{0%,48%{opacity:0}56%{opacity:1}100%{opacity:1}}@keyframes dca-rogue{0%,4%{opacity:0}10%{opacity:1}100%{opacity:1}}@keyframes dca-rglow{0%,100%{stroke-opacity:.3}50%{stroke-opacity:.65}}@keyframes dca-pulse{0%{transform:scale(1);opacity:0}10%{transform:scale(1);opacity:.4}60%{transform:scale(1.5);opacity:0}100%{transform:scale(1.5);opacity:0}}@keyframes dca-v1{0%,62%{opacity:0;transform:scale(0.5)}65%{opacity:1;transform:scale(1)}100%{opacity:1;transform:scale(1)}}@keyframes dca-v2{0%,68%{opacity:0;transform:scale(0.5)}71%{opacity:1;transform:scale(1)}100%{opacity:1;transform:scale(1)}}@keyframes dca-v3{0%,74%{opacity:0;transform:scale(0.5)}77%{opacity:1;transform:scale(1)}100%{opacity:1;transform:scale(1)}}@keyframes dca-pkt1{0%,76%{opacity:0}78%{transform:translate(330px,100px);opacity:.8;color:${accent}}86%{transform:translate(470px,75px);opacity:1;color:${accent}}88%{transform:translate(470px,75px);opacity:0}100%{opacity:0}}@keyframes dca-scan{0%,56%{opacity:0;transform:translateY(0)}58%{opacity:.7;transform:translateY(0)}70%{opacity:.7;transform:translateY(82px)}72%{opacity:0;transform:translateY(82px)}100%{opacity:0}}@keyframes dca-prog{0%{transform:scaleX(0)}100%{transform:scaleX(1)}}@media(prefers-reduced-motion:reduce){.dca .dca-line,.dca .dca-phase1,.dca .dca-phase2,.dca .dca-edison,.dca .dca-rogue,.dca .dca-rglow,.dca .dca-pulse,.dca .dca-v1,.dca .dca-v2,.dca .dca-v3,.dca .dca-pkt1,.dca .dca-scan{animation:none}.dca .dca-phase1{opacity:0}.dca .dca-phase2,.dca .dca-edison{opacity:1;transform:scale(1)}.dca .dca-rogue{opacity:1}.dca .dca-v1,.dca .dca-v2,.dca .dca-v3{opacity:1;transform:scale(1)}.dca .dca-pkt1{opacity:0}.dca .dca-progress{animation:none;transform:scaleX(1)}}`;

export default function DesktopClientAnimation() {
  return (
    <div style={{ display: "flex", justifyContent: "center" }}>
      <style>{CSS}</style>
      <svg
        className="dca"
        width={620}
        height={250}
        viewBox="0 0 620 250"
        xmlns="http://www.w3.org/2000/svg"
        role="presentation"
        aria-hidden="true"
      >
        {/* ===== LAPTOP (large, left side) ===== */}
        <rect
          x={12}
          y={8}
          width={310}
          height={158}
          rx={7}
          fill={fg}
          fillOpacity="0.03"
          stroke={muted}
          strokeOpacity="0.35"
          strokeWidth="1.5"
        />
        <rect
          x={8}
          y={168}
          width={318}
          height={8}
          rx={4}
          fill={fg}
          fillOpacity="0.04"
          stroke={muted}
          strokeOpacity="0.35"
          strokeWidth="1"
        />

        {/* AI Agent icons row */}
        <AgentIcon agent={CLAUDE} x={100} y={18} size={24} />
        <AgentIcon agent={CURSOR} x={132} y={18} size={24} />
        <AgentIcon agent={CODEX} x={164} y={18} size={24} />

        {/* Config file panel */}
        <rect
          x={28}
          y={54}
          width={246}
          height={96}
          rx={5}
          fill={fg}
          fillOpacity="0.02"
          stroke={muted}
          strokeOpacity="0.2"
          strokeWidth="1"
        />
        <text
          x={38}
          y={44}
          fill={muted}
          fontSize="7"
          fontFamily="system-ui,sans-serif"
          fillOpacity="0.5"
        >
          MCP Configs
        </text>

        {/* Config entry 1: github-mcp */}
        <McpIcon x={36} y={62} size={16} color={muted} opacity="0.45" />
        <text
          x={56}
          y={74}
          fill={fg}
          fontSize="8"
          fontFamily="ui-monospace,monospace"
          fillOpacity="0.5"
        >
          github-mcp
        </text>

        <line
          x1={36}
          y1={82}
          x2={268}
          y2={82}
          stroke={muted}
          strokeOpacity="0.12"
          strokeWidth="0.5"
        />

        {/* Config entry 2: slack-mcp */}
        <McpIcon x={36} y={86} size={16} color={muted} opacity="0.45" />
        <text
          x={56}
          y={98}
          fill={fg}
          fontSize="8"
          fontFamily="ui-monospace,monospace"
          fillOpacity="0.5"
        >
          slack-mcp
        </text>

        <line
          x1={36}
          y1={106}
          x2={268}
          y2={106}
          stroke={muted}
          strokeOpacity="0.12"
          strokeWidth="0.5"
        />

        {/* Config entry 3: shadow-tool (rogue, fades in) */}
        <g className="dca-rogue">
          <rect
            className="dca-rglow"
            x={30}
            y={110}
            width={240}
            height={24}
            rx={3}
            fill={O}
            fillOpacity="0.04"
            stroke={O}
            strokeOpacity="0.3"
            strokeWidth="0.8"
          />
          <McpIcon x={36} y={112} size={16} color={O} opacity="0.7" />
          <text
            x={56}
            y={124}
            fill={O}
            fontSize="8"
            fontWeight="bold"
            fontFamily="ui-monospace,monospace"
            fillOpacity="0.8"
          >
            shadow-tool
          </text>

          <g className="dca-phase1">
            <rect
              x={142}
              y={116}
              width={24}
              height={12}
              rx={2.5}
              fill={O}
              fillOpacity="0.15"
            />
            <text
              x={154}
              y={125}
              textAnchor="middle"
              fill={O}
              fontSize="6.5"
              fontWeight="bold"
              fontFamily="system-ui,sans-serif"
            >
              NEW
            </text>
          </g>

          <g className="dca-v3" style={{ transformOrigin: "170px 122px" }}>
            <rect
              x={140}
              y={116}
              width={62}
              height={12}
              rx={2.5}
              fill={DANGER}
              fillOpacity="0.1"
              stroke={DANGER}
              strokeOpacity="0.3"
              strokeWidth="0.5"
            />
            <text
              x={171}
              y={125}
              textAnchor="middle"
              fill={DANGER}
              fontSize="6.5"
              fontWeight="bold"
              fontFamily="system-ui,sans-serif"
            >
              QUARANTINED
            </text>
          </g>
        </g>

        {/* ===== PHASE 1: NO VISIBILITY ===== */}
        <g className="dca-phase1">
          <svg x={374} y={55} width={30} height={30} viewBox="0 0 256 256">
            <path d={EYE_SLASH_PATH} fill={DANGER} fillOpacity="0.55" />
          </svg>
          <text
            x={389}
            y={96}
            textAnchor="middle"
            fill={DANGER}
            fillOpacity="0.5"
            fontSize="7.5"
            fontFamily="system-ui,sans-serif"
          >
            No visibility
          </text>

          <line
            className="dca-line"
            x1="325"
            y1="70"
            x2="455"
            y2="70"
            stroke={DANGER}
            strokeOpacity="0.25"
            strokeWidth="1.5"
            strokeDasharray="4 3"
          />
          <line
            className="dca-line"
            x1="325"
            y1="94"
            x2="455"
            y2="94"
            stroke={DANGER}
            strokeOpacity="0.25"
            strokeWidth="1.5"
            strokeDasharray="4 3"
          />
          <line
            className="dca-line"
            x1="325"
            y1="122"
            x2="455"
            y2="122"
            stroke={DANGER}
            strokeOpacity="0.25"
            strokeWidth="1.5"
            strokeDasharray="4 3"
          />

          {[70, 94].map((ey) => (
            <svg
              key={ey}
              x={284}
              y={ey - 9}
              width={16}
              height={16}
              viewBox="0 0 256 256"
            >
              <path d={EYE_SLASH_PATH} fill={DANGER} fillOpacity="0.35" />
            </svg>
          ))}
        </g>

        {/* ===== PHASE 2: EDISON WATCH ACTIVE ===== */}

        <g className="dca-phase2">
          <rect
            x={24}
            y={50}
            width={254}
            height={104}
            rx={6}
            fill={accent}
            fillOpacity="0.02"
            stroke={accent}
            strokeOpacity="0.4"
            strokeWidth="1.5"
          />
          <EdisonLogo x={10} y={38} w={18} h={17.5} />
          <svg x={260} y={34} width={14} height={14} viewBox="0 0 256 256">
            <path d={SHIELD_CHECK_PATH} fill={accent} fillOpacity="0.6" />
          </svg>
        </g>

        <g className="dca-edison" style={{ transformOrigin: "279px 151px" }}>
          <circle
            className="dca-pulse"
            cx={279}
            cy={151}
            r={12}
            fill="none"
            stroke={accent}
            strokeOpacity="0.5"
            strokeWidth="1.5"
          />
          <EdisonLogo x={270} y={142} w={18} h={17.5} />
        </g>

        <g className="dca-scan">
          <line
            x1={30}
            y1={56}
            x2={272}
            y2={56}
            stroke={accent}
            strokeOpacity="0.5"
            strokeWidth="1.5"
          />
          <rect
            x={30}
            y={56}
            width={242}
            height={4}
            rx={1}
            fill={accent}
            fillOpacity="0.06"
          />
        </g>

        <g className="dca-phase2">
          <svg x={374} y={55} width={30} height={30} viewBox="0 0 256 256">
            <path d={EYE_PATH} fill={accent} fillOpacity="0.75" />
          </svg>
          <text
            x={389}
            y={96}
            textAnchor="middle"
            fill={accent}
            fillOpacity="0.8"
            fontSize="7.5"
            fontWeight="bold"
            fontFamily="system-ui,sans-serif"
          >
            Full visibility
          </text>

          <line
            className="dca-line"
            x1="325"
            y1="70"
            x2="455"
            y2="70"
            stroke={accent}
            strokeOpacity="0.35"
            strokeWidth="1.5"
            strokeDasharray="3 3"
          />
          <line
            className="dca-line"
            x1="325"
            y1="94"
            x2="455"
            y2="94"
            stroke={accent}
            strokeOpacity="0.35"
            strokeWidth="1.5"
            strokeDasharray="3 3"
          />
          <line
            className="dca-line"
            x1="325"
            y1="122"
            x2="455"
            y2="122"
            stroke={accent}
            strokeOpacity="0.35"
            strokeWidth="1.5"
            strokeDasharray="3 3"
          />
        </g>

        {/* Verdict badges */}
        <g className="dca-v1" style={{ transformOrigin: "290px 70px" }}>
          <circle
            cx={290}
            cy={70}
            r={7}
            fill={accent}
            fillOpacity="0.12"
            stroke={accent}
            strokeOpacity="0.5"
            strokeWidth="1"
          />
          <polyline
            points="286,70 289,73 294,67"
            fill="none"
            stroke={accent}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
        <g className="dca-v2" style={{ transformOrigin: "290px 94px" }}>
          <circle
            cx={290}
            cy={94}
            r={7}
            fill={accent}
            fillOpacity="0.12"
            stroke={accent}
            strokeOpacity="0.5"
            strokeWidth="1"
          />
          <polyline
            points="286,94 289,97 294,91"
            fill="none"
            stroke={accent}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
        <g className="dca-v3" style={{ transformOrigin: "290px 122px" }}>
          <circle
            cx={290}
            cy={122}
            r={7}
            fill={DANGER}
            fillOpacity="0.12"
            stroke={DANGER}
            strokeOpacity="0.5"
            strokeWidth="1"
          />
          <line
            x1={287}
            y1={119}
            x2={293}
            y2={125}
            stroke={DANGER}
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <line
            x1={293}
            y1={119}
            x2={287}
            y2={125}
            stroke={DANGER}
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </g>

        {/* ===== ADMIN DASHBOARD (phase 2 only) ===== */}
        <g className="dca-phase2">
          <svg x={478} y={8} width={22} height={22} viewBox="0 0 256 256">
            <path d={ADMIN_PATH} fill={fg} fillOpacity="0.6" />
          </svg>
          <text
            x={489}
            y={38}
            textAnchor="middle"
            fill={fg}
            fontSize="8"
            fontWeight="bold"
            fontFamily="system-ui,sans-serif"
          >
            Admin
          </text>
        </g>

        <g className="dca-phase2">
          <rect
            x={455}
            y={52}
            width={90}
            height={90}
            rx={5}
            fill={fg}
            fillOpacity="0.02"
            stroke={accent}
            strokeOpacity="0.2"
            strokeWidth="1"
          />
          <text
            x={500}
            y={48}
            textAnchor="middle"
            fill={accent}
            fontSize="6.5"
            fontFamily="system-ui,sans-serif"
            fillOpacity="0.6"
          >
            Detected
          </text>

          <McpIcon x={462} y={58} size={14} color={accent} opacity="0.45" />
          <rect
            x={480}
            y={62}
            width={36}
            height={5}
            rx={1.5}
            fill={accent}
            fillOpacity="0.12"
          />
          <circle cx={524} cy={65} r={2.5} fill={accent} fillOpacity="0.5" />

          <McpIcon x={462} y={78} size={14} color={accent} opacity="0.45" />
          <rect
            x={480}
            y={82}
            width={32}
            height={5}
            rx={1.5}
            fill={accent}
            fillOpacity="0.12"
          />
          <circle cx={524} cy={85} r={2.5} fill={accent} fillOpacity="0.5" />

          <McpIcon x={462} y={98} size={14} color={DANGER} opacity="0.5" />
          <rect
            x={480}
            y={102}
            width={28}
            height={5}
            rx={1.5}
            fill={DANGER}
            fillOpacity="0.1"
          />
          <svg x={518} y={99} width={12} height={12} viewBox="0 0 256 256">
            <path d={SHIELD_CHECK_PATH} fill={DANGER} fillOpacity="0.5" />
          </svg>
          <rect
            x={462}
            y={116}
            width={80}
            height={16}
            rx={3}
            fill={accent}
            fillOpacity="0.06"
            stroke={accent}
            strokeOpacity="0.25"
            strokeWidth="0.8"
          />
          <text
            x={502}
            y={127}
            textAnchor="middle"
            fill={accent}
            fontSize="6.5"
            fontWeight="bold"
            fontFamily="system-ui,sans-serif"
            fillOpacity="0.7"
          >
            Review &amp; Approve
          </text>
        </g>

        {/* Notification packet */}
        <g className="dca-pkt dca-pkt1">
          <McpPacket />
        </g>

        {/* Labels */}
        <text
          x="167"
          y="192"
          textAnchor="middle"
          fill={fg}
          fontSize="9"
          fontWeight="bold"
          fontFamily="system-ui,sans-serif"
        >
          Employee Laptop
        </text>
        <g className="dca-phase2">
          <text
            x="167"
            y="204"
            textAnchor="middle"
            fill={accent}
            fontSize="7.5"
            fontFamily="system-ui,sans-serif"
          >
            Running Edison Watch
          </text>
        </g>
        <g className="dca-phase2">
          <text
            x="500"
            y="158"
            textAnchor="middle"
            fill={fg}
            fontSize="8"
            fontWeight="bold"
            fontFamily="system-ui,sans-serif"
          >
            Admin Dashboard
          </text>
        </g>

        {/* Progress bar */}
        <ProgressBar y={248} width={580} className="dca-progress" />
      </svg>
    </div>
  );
}
