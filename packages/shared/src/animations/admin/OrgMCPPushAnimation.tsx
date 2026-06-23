/**
 * Org-approved MCP push animation - horizontal layout.
 *
 * Left: 3 employee laptops. Center: Edison Gateway. Right: Outlook MCP.
 *
 * Phase 1 - Admin toggles on the Outlook MCP in the gateway.
 * Phase 2 - Outlook icons magically appear on each laptop screen.
 * Phase 3 - Traffic flows left-to-right: laptops -> gateway (checkmark)
 *           -> Outlook server (checkmark), showing the proxy chain.
 *
 * 10s loop. Pure SVG + CSS. Respects `prefers-reduced-motion`.
 */

import {
  ADMIN_PATH,
  EdisonLogo,
  FlowLine,
  McpPacket,
  ProgressBar,
  VerdictBadge,
} from "../_shared";
import {
  OUTLOOK_SVG,
  OUTLOOK_SVG_VIEWBOX,
  ATLASSIAN_SVG,
  ATLASSIAN_SVG_VIEWBOX,
  SLACK_SVG,
  SLACK_SVG_VIEWBOX,
} from "../../svg/app-icons-svg";

const fg = "var(--text-primary)";
const muted = "var(--text-muted)";
const accent = "var(--accent)";

const CSS = `
.om-anim { color: ${fg}; }

/* dashed-line flow */
.om-anim .om-line { stroke-dashoffset: 0; animation: om-lf 2s linear infinite; }

/* packet fill */
.om-anim .om-pkt path, .om-anim .om-pkt circle { fill: currentColor; }

/* -- toggle switch -- */
.om-anim .om-toggle-knob { animation: om-knob 10s ease-in-out infinite; }
.om-anim .om-toggle-bg { animation: om-tbg 10s ease-in-out infinite; }

/* -- glow pulse on gateway panel -- */
.om-anim .om-panel-glow { animation: om-pglow 10s ease-in-out infinite; }

/* -- Ripple wave from gateway to laptops -- */
.om-anim .om-ripple1 { animation: om-ripple1 10s ease-out infinite; transform-origin: 150px 82px; }
.om-anim .om-ripple2 { animation: om-ripple2 10s ease-out infinite; transform-origin: 150px 82px; }

/* -- Outlook icons appearing on laptops (in sync after ripple) -- */
.om-anim .om-mcp1 { animation: om-mcp-sync 10s ease-in-out infinite; transform-origin: 60px 30px; }
.om-anim .om-mcp2 { animation: om-mcp-sync 10s ease-in-out infinite; transform-origin: 60px 100px; }
.om-anim .om-mcp3 { animation: om-mcp-sync 10s ease-in-out infinite; transform-origin: 60px 170px; }

/* -- Outlook server -- */
.om-anim .om-srv { animation: om-srv 10s ease-in-out infinite; transform-origin: 430px 82px; }

/* -- traffic lines (laptops -> gateway -> server) -- */
.om-anim .om-traf { animation: om-traf 10s ease-in-out infinite; }

/* -- traffic packets: laptops -> gateway (staggered) -- */
.om-anim .om-tp1 { color: ${accent}; animation: om-tp1 10s ease-in-out infinite; }
.om-anim .om-tp2 { color: ${accent}; animation: om-tp2 10s ease-in-out infinite; }
.om-anim .om-tp3 { color: ${accent}; animation: om-tp3 10s ease-in-out infinite; }

/* -- proxy packets: gateway -> server (2 allowed through) -- */
.om-anim .om-rpkt1 { color: ${accent}; animation: om-rpkt1 10s ease-in-out infinite; }
.om-anim .om-rpkt2 { color: ${accent}; animation: om-rpkt2 10s ease-in-out infinite; }

/* -- verdict badges (SIEM-style) -- */
.om-anim .om-v1 { animation: om-v1 10s ease-in-out infinite; }
.om-anim .om-v2 { animation: om-v2 10s ease-in-out infinite; }
.om-anim .om-v3 { animation: om-v3 10s ease-in-out infinite; }
.om-anim .om-v4 { animation: om-v4 10s ease-in-out infinite; }
.om-anim .om-v5 { animation: om-v5 10s ease-in-out infinite; }

/* -- bottom progress bar -- */
.om-anim .om-progress { transform-origin: 20px 218px; animation: om-prog 10s linear infinite; }

/* -- keyframes -- */

@keyframes om-lf { to { stroke-dashoffset: -12; } }

/* Toggle: off -> on */
@keyframes om-knob {
  0%,22%   { transform: translateX(0); }
  30%      { transform: translateX(14px); }
  92%      { transform: translateX(14px); }
  100%     { transform: translateX(0); }
}
@keyframes om-tbg {
  0%,22%   { fill: ${muted}; fill-opacity: 0.2; }
  30%      { fill: ${accent}; fill-opacity: 0.3; }
  92%      { fill: ${accent}; fill-opacity: 0.3; }
  100%     { fill: ${muted}; fill-opacity: 0.2; }
}

/* Panel glow on toggle */
@keyframes om-pglow {
  0%,24%   { stroke-opacity: 0.2; stroke: ${muted}; }
  32%      { stroke-opacity: 0.6; stroke: ${accent}; }
  40%      { stroke-opacity: 0.3; stroke: ${accent}; }
  92%      { stroke-opacity: 0.3; stroke: ${accent}; }
  100%     { stroke-opacity: 0.2; stroke: ${muted}; }
}

/* Ripple wave expanding from gateway toward laptops */
@keyframes om-ripple1 {
  0%,28%   { transform: scale(0); opacity: 0; }
  30%      { transform: scale(0); opacity: 0.5; }
  38%      { transform: scale(1.8); opacity: 0; }
  100%     { opacity: 0; }
}
@keyframes om-ripple2 {
  0%,31%   { transform: scale(0); opacity: 0; }
  33%      { transform: scale(0); opacity: 0.4; }
  41%      { transform: scale(1.8); opacity: 0; }
  100%     { opacity: 0; }
}

/* Outlook icons appear on all laptops simultaneously after ripple arrives */
@keyframes om-mcp-sync {
  0%,37%   { opacity: 0; transform: scale(0.5); }
  42%      { opacity: 1; transform: scale(1.1); }
  46%      { opacity: 1; transform: scale(1); }
  92%      { opacity: 1; transform: scale(1); }
  100%     { opacity: 0; transform: scale(1); }
}

/* Outlook MCP server pops in */
@keyframes om-srv {
  0%,44%   { opacity: 0; transform: scale(0.7); }
  50%      { opacity: 1; transform: scale(1.05); }
  54%      { opacity: 1; transform: scale(1); }
  92%      { opacity: 1; transform: scale(1); }
  100%     { opacity: 0; transform: scale(1); }
}

/* Traffic lines appear */
@keyframes om-traf {
  0%,50%   { opacity: 0; }
  56%      { opacity: 1; }
  92%      { opacity: 1; }
  100%     { opacity: 0; }
}

/* Traffic packets: laptops -> gateway (staggered) */
@keyframes om-tp1 {
  0%,56%   { transform: translate(78px, 37px); opacity: 0; }
  58%      { transform: translate(78px, 37px); opacity: 0.8; }
  66%      { transform: translate(150px, 82px); opacity: 1; }
  68%      { transform: translate(150px, 82px); opacity: 0; }
  100%     { opacity: 0; }
}
@keyframes om-tp2 {
  0%,58%   { transform: translate(78px, 107px); opacity: 0; }
  60%      { transform: translate(78px, 107px); opacity: 0.8; }
  68%      { transform: translate(150px, 82px); opacity: 1; }
  70%      { transform: translate(150px, 82px); opacity: 0; }
  100%     { opacity: 0; }
}
@keyframes om-tp3 {
  0%,60%   { transform: translate(78px, 177px); opacity: 0; }
  62%      { transform: translate(78px, 177px); opacity: 0.8; }
  70%      { transform: translate(150px, 82px); opacity: 1; }
  72%      { transform: translate(150px, 82px); opacity: 0; }
  100%     { opacity: 0; }
}

/* Verdict badges pop in when packets hit gateway / server */
@keyframes om-v1 {
  0%,64%   { opacity: 0; transform: scale(0.5); }
  67%      { opacity: 1; transform: scale(1); }
  92%      { opacity: 1; transform: scale(1); }
  97%,100% { opacity: 0; transform: scale(0.5); }
}
@keyframes om-v2 {
  0%,66%   { opacity: 0; transform: scale(0.5); }
  69%      { opacity: 1; transform: scale(1); }
  92%      { opacity: 1; transform: scale(1); }
  97%,100% { opacity: 0; transform: scale(0.5); }
}
@keyframes om-v3 {
  0%,68%   { opacity: 0; transform: scale(0.5); }
  71%      { opacity: 1; transform: scale(1); }
  92%      { opacity: 1; transform: scale(1); }
  97%,100% { opacity: 0; transform: scale(0.5); }
}

/* Proxy packets: gateway -> Outlook server (staggered along same line) */
@keyframes om-rpkt1 {
  0%,72%   { transform: translate(330px, 82px); opacity: 0; }
  74%      { transform: translate(330px, 82px); opacity: 0.8; }
  80%      { transform: translate(385px, 82px); opacity: 1; }
  82%      { transform: translate(385px, 82px); opacity: 0; }
  100%     { opacity: 0; }
}
@keyframes om-rpkt2 {
  0%,75%   { transform: translate(330px, 82px); opacity: 0; }
  77%      { transform: translate(330px, 82px); opacity: 0.8; }
  83%      { transform: translate(385px, 82px); opacity: 1; }
  85%      { transform: translate(385px, 82px); opacity: 0; }
  100%     { opacity: 0; }
}

@keyframes om-v4 {
  0%,78%   { opacity: 0; transform: scale(0.5); }
  81%      { opacity: 1; transform: scale(1); }
  92%      { opacity: 1; transform: scale(1); }
  97%,100% { opacity: 0; transform: scale(0.5); }
}
@keyframes om-v5 {
  0%,80%   { opacity: 0; transform: scale(0.5); }
  83%      { opacity: 1; transform: scale(1); }
  92%      { opacity: 1; transform: scale(1); }
  97%,100% { opacity: 0; transform: scale(0.5); }
}

@keyframes om-prog {
  0%   { transform: scaleX(0); }
  100% { transform: scaleX(1); }
}

@media (prefers-reduced-motion: reduce) {
  .om-anim .om-line, .om-anim .om-toggle-knob,
  .om-anim .om-toggle-bg, .om-anim .om-panel-glow,
  .om-anim .om-ripple1, .om-anim .om-ripple2,
  .om-anim .om-mcp1, .om-anim .om-mcp2, .om-anim .om-mcp3,
  .om-anim .om-srv, .om-anim .om-traf,
  .om-anim .om-tp1, .om-anim .om-tp2, .om-anim .om-tp3,
  .om-anim .om-rpkt1, .om-anim .om-rpkt2,
  .om-anim .om-v1, .om-anim .om-v2, .om-anim .om-v3,
  .om-anim .om-v4, .om-anim .om-v5 { animation: none; }
  .om-anim .om-ripple1, .om-anim .om-ripple2 { opacity: 0; }
  .om-anim .om-toggle-knob { transform: translateX(14px); }
  .om-anim .om-toggle-bg { fill: ${accent}; fill-opacity: 0.3; }
  .om-anim .om-panel-glow { stroke: ${accent}; stroke-opacity: 0.3; }
  .om-anim .om-mcp1, .om-anim .om-mcp2, .om-anim .om-mcp3 { opacity: 1; transform: scale(1); }
  .om-anim .om-srv { opacity: 1; transform: scale(1); }
  .om-anim .om-traf { opacity: 1; }
  .om-anim .om-tp1, .om-anim .om-tp2, .om-anim .om-tp3 { opacity: 0; }
  .om-anim .om-rpkt1, .om-anim .om-rpkt2 { opacity: 0; }
  .om-anim .om-v1, .om-anim .om-v2, .om-anim .om-v3, .om-anim .om-v4, .om-anim .om-v5 { opacity: 1; transform: scale(1); }
  .om-anim .om-progress { animation: none; transform: scaleX(1); }
}
`;

export default function OrgMCPPushAnimation(): React.ReactNode {
  return (
    <div className="flex justify-center">
      <style>{CSS}</style>
      <svg
        className="om-anim"
        width={500}
        height={220}
        viewBox="0 0 500 220"
        xmlns="http://www.w3.org/2000/svg"
        role="presentation"
        aria-hidden="true"
      >
        {/* ===== EMPLOYEE LAPTOPS (left column) ===== */}
        {[
          { y: 15, label: "Employee A" },
          { y: 85, label: "Employee B" },
          { y: 155, label: "Employee C" },
        ].map(({ y, label }) => (
          <g key={label}>
            <rect
              x={8}
              y={y}
              width={70}
              height={45}
              rx={5}
              fill={fg}
              fillOpacity="0.03"
              stroke={muted}
              strokeOpacity="0.3"
              strokeWidth="1"
            />
            <rect
              x={5}
              y={y + 47}
              width={76}
              height={5}
              rx={2.5}
              fill={fg}
              fillOpacity="0.04"
              stroke={muted}
              strokeOpacity="0.3"
              strokeWidth="0.8"
            />
            <EdisonLogo x={30} y={y + 6} w={20} h={19} />
            <text
              x={43}
              y={y + 62}
              textAnchor="middle"
              fill={fg}
              fontSize="6"
              fontFamily="system-ui,sans-serif"
              fillOpacity="0.4"
            >
              {label}
            </text>
          </g>
        ))}

        {/* ===== Ripple wave from gateway toward laptops (left only) ===== */}
        <defs>
          <clipPath id="om-clip-left">
            <rect x={0} y={0} width={150} height={220} />
          </clipPath>
        </defs>
        <g clipPath="url(#om-clip-left)">
          <circle
            className="om-ripple1"
            cx={150}
            cy={82}
            r={80}
            fill="none"
            stroke={accent}
            strokeOpacity="0.5"
            strokeWidth="2"
          />
          <circle
            className="om-ripple2"
            cx={150}
            cy={82}
            r={80}
            fill="none"
            stroke={accent}
            strokeOpacity="0.35"
            strokeWidth="1.5"
          />
        </g>

        {/* ===== All 3 MCP icons appearing on each laptop (below Edison logo, centered) ===== */}
        {/* Employee A */}
        <g className="om-mcp1">
          <svg
            x={28}
            y={44}
            width={9}
            height={9}
            viewBox={OUTLOOK_SVG_VIEWBOX}
            dangerouslySetInnerHTML={{ __html: OUTLOOK_SVG }}
          />
          <svg
            x={39}
            y={44}
            width={9}
            height={9}
            viewBox={ATLASSIAN_SVG_VIEWBOX}
            dangerouslySetInnerHTML={{ __html: ATLASSIAN_SVG }}
          />
          <svg
            x={50}
            y={44}
            width={9}
            height={9}
            viewBox={SLACK_SVG_VIEWBOX}
            dangerouslySetInnerHTML={{ __html: SLACK_SVG }}
          />
        </g>
        {/* Employee B */}
        <g className="om-mcp2">
          <svg
            x={28}
            y={114}
            width={9}
            height={9}
            viewBox={OUTLOOK_SVG_VIEWBOX}
            dangerouslySetInnerHTML={{ __html: OUTLOOK_SVG }}
          />
          <svg
            x={39}
            y={114}
            width={9}
            height={9}
            viewBox={ATLASSIAN_SVG_VIEWBOX}
            dangerouslySetInnerHTML={{ __html: ATLASSIAN_SVG }}
          />
          <svg
            x={50}
            y={114}
            width={9}
            height={9}
            viewBox={SLACK_SVG_VIEWBOX}
            dangerouslySetInnerHTML={{ __html: SLACK_SVG }}
          />
        </g>
        {/* Employee C */}
        <g className="om-mcp3">
          <svg
            x={28}
            y={184}
            width={9}
            height={9}
            viewBox={OUTLOOK_SVG_VIEWBOX}
            dangerouslySetInnerHTML={{ __html: OUTLOOK_SVG }}
          />
          <svg
            x={39}
            y={184}
            width={9}
            height={9}
            viewBox={ATLASSIAN_SVG_VIEWBOX}
            dangerouslySetInnerHTML={{ __html: ATLASSIAN_SVG }}
          />
          <svg
            x={50}
            y={184}
            width={9}
            height={9}
            viewBox={SLACK_SVG_VIEWBOX}
            dangerouslySetInnerHTML={{ __html: SLACK_SVG }}
          />
        </g>

        {/* ===== EDISON GATEWAY PANEL (center) ===== */}
        <rect
          className="om-panel-glow"
          x={150}
          y={40}
          width={180}
          height={90}
          rx={7}
          fill={fg}
          fillOpacity="0.03"
          stroke={muted}
          strokeOpacity="0.2"
          strokeWidth="1.5"
        />

        <svg x={158} y={46} width={16} height={16} viewBox="0 0 256 256">
          <path d={ADMIN_PATH} fill={accent} fillOpacity="0.6" />
        </svg>
        <text
          x={178}
          y={58}
          fill={fg}
          fontSize="7.5"
          fontWeight="bold"
          fontFamily="system-ui,sans-serif"
          fillOpacity="0.6"
        >
          Edison Gateway
        </text>
        <EdisonLogo x={298} y={44} w={22} h={21} />

        {/* MCP server entry rows */}
        <rect
          x={158}
          y={66}
          width={164}
          height={18}
          rx={3}
          fill={fg}
          fillOpacity="0.02"
          stroke={muted}
          strokeOpacity="0.12"
          strokeWidth="0.6"
        />
        <svg
          x={161}
          y={68}
          width={13}
          height={13}
          viewBox={OUTLOOK_SVG_VIEWBOX}
          dangerouslySetInnerHTML={{ __html: OUTLOOK_SVG }}
        />
        <text
          x={178}
          y={78}
          fill={fg}
          fontSize="6"
          fontWeight="600"
          fontFamily="ui-monospace,monospace"
          fillOpacity="0.5"
        >
          outlook-mcp
        </text>

        <rect
          x={158}
          y={86}
          width={164}
          height={18}
          rx={3}
          fill={fg}
          fillOpacity="0.02"
          stroke={muted}
          strokeOpacity="0.12"
          strokeWidth="0.6"
        />
        <svg
          x={161}
          y={88}
          width={13}
          height={13}
          viewBox={ATLASSIAN_SVG_VIEWBOX}
          dangerouslySetInnerHTML={{ __html: ATLASSIAN_SVG }}
        />
        <text
          x={178}
          y={98}
          fill={fg}
          fontSize="6"
          fontWeight="600"
          fontFamily="ui-monospace,monospace"
          fillOpacity="0.5"
        >
          atlassian-mcp
        </text>

        <rect
          x={158}
          y={106}
          width={164}
          height={18}
          rx={3}
          fill={fg}
          fillOpacity="0.02"
          stroke={muted}
          strokeOpacity="0.12"
          strokeWidth="0.6"
        />
        <svg
          x={161}
          y={108}
          width={13}
          height={13}
          viewBox={SLACK_SVG_VIEWBOX}
          dangerouslySetInnerHTML={{ __html: SLACK_SVG }}
        />
        <text
          x={178}
          y={118}
          fill={fg}
          fontSize="6"
          fontWeight="600"
          fontFamily="ui-monospace,monospace"
          fillOpacity="0.5"
        >
          slack-mcp
        </text>

        {/* Toggle switches (one per row) */}
        <g>
          <rect
            className="om-toggle-bg"
            x={295}
            y={70}
            width={20}
            height={10}
            rx={5}
            fill={muted}
            fillOpacity="0.2"
          />
          <circle
            className="om-toggle-knob"
            cx={301}
            cy={75}
            r={3.5}
            fill="white"
            fillOpacity="0.9"
          />
        </g>

        {/* ===== MCP SERVERS (right) ===== */}
        <g className="om-srv">
          <rect
            x={385}
            y={48}
            width={105}
            height={70}
            rx={5}
            fill={fg}
            fillOpacity="0.03"
            stroke={accent}
            strokeOpacity="0.25"
            strokeWidth="1"
          />
          <text
            x={437}
            y={62}
            textAnchor="middle"
            fill={fg}
            fontSize="6"
            fontWeight="600"
            fontFamily="system-ui,sans-serif"
            fillOpacity="0.45"
          >
            MCP Servers
          </text>
          <svg
            x={393}
            y={67}
            width={14}
            height={14}
            viewBox={OUTLOOK_SVG_VIEWBOX}
            dangerouslySetInnerHTML={{ __html: OUTLOOK_SVG }}
          />
          <text
            x={411}
            y={77}
            fill={fg}
            fontSize="5.5"
            fontWeight="500"
            fontFamily="ui-monospace,monospace"
            fillOpacity="0.45"
          >
            outlook-mcp
          </text>
          <svg
            x={393}
            y={83}
            width={14}
            height={14}
            viewBox={ATLASSIAN_SVG_VIEWBOX}
            dangerouslySetInnerHTML={{ __html: ATLASSIAN_SVG }}
          />
          <text
            x={411}
            y={93}
            fill={fg}
            fontSize="5.5"
            fontWeight="500"
            fontFamily="ui-monospace,monospace"
            fillOpacity="0.45"
          >
            atlassian-mcp
          </text>
          <svg
            x={393}
            y={99}
            width={14}
            height={14}
            viewBox={SLACK_SVG_VIEWBOX}
            dangerouslySetInnerHTML={{ __html: SLACK_SVG }}
          />
          <text
            x={411}
            y={109}
            fill={fg}
            fontSize="5.5"
            fontWeight="500"
            fontFamily="ui-monospace,monospace"
            fillOpacity="0.45"
          >
            slack-mcp
          </text>
        </g>

        {/* ===== TRAFFIC LINES: laptops -> gateway -> server ===== */}
        <g className="om-traf">
          {/* Laptops to gateway */}
          <FlowLine
            className="om-line"
            x1={78}
            y1={37}
            x2={150}
            y2={82}
            stroke={accent}
            strokeOpacity={0.4}
          />
          <FlowLine
            className="om-line"
            x1={78}
            y1={107}
            x2={150}
            y2={82}
            stroke={accent}
            strokeOpacity={0.4}
          />
          <FlowLine
            className="om-line"
            x1={78}
            y1={177}
            x2={150}
            y2={82}
            stroke={accent}
            strokeOpacity={0.4}
          />
          {/* Gateway to server */}
          <FlowLine
            className="om-line"
            x1={330}
            y1={82}
            x2={385}
            y2={82}
            stroke={accent}
            strokeOpacity={0.4}
          />
        </g>

        {/* ===== TRAFFIC PACKETS: laptops -> gateway ===== */}
        <g className="om-pkt om-tp1">
          <McpPacket />
        </g>
        <g className="om-pkt om-tp2">
          <McpPacket />
        </g>
        <g className="om-pkt om-tp3">
          <McpPacket />
        </g>

        {/* ===== PROXY PACKETS: gateway -> server (2 allowed) ===== */}
        <g className="om-pkt om-rpkt1">
          <McpPacket />
        </g>
        <g className="om-pkt om-rpkt2">
          <McpPacket />
        </g>

        {/* ===== VERDICT BADGES at gateway (left edge, stacked) ===== */}
        <VerdictBadge
          className="om-v1"
          cx={142}
          cy={68}
          r={7}
          variant="allow"
        />
        <VerdictBadge className="om-v2" cx={142} cy={82} r={7} variant="deny" />
        <VerdictBadge
          className="om-v3"
          cx={142}
          cy={96}
          r={7}
          variant="allow"
        />

        {/* ===== VERDICT BADGES at Outlook server (left edge, stacked) ===== */}
        <VerdictBadge
          className="om-v4"
          cx={380}
          cy={75}
          r={7}
          variant="allow"
        />
        <VerdictBadge
          className="om-v5"
          cx={380}
          cy={89}
          r={7}
          variant="allow"
        />

        {/* Progress bar */}
        <ProgressBar y={218} width={460} className="om-progress" />
      </svg>
    </div>
  );
}
