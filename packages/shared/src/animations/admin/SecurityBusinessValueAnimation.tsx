/**
 * Security-into-Business-Value animation.
 *
 * Single AI agent (generic robot) sends traffic through Edison gateway.
 * Edison runs a radar-scan risk assessment, then routes the request to
 * one of four destinations - each represented by a distinct icon:
 *
 *   1. Approved (risk 0.1) → MCP connector (top-right) - tool call proceeds
 *   2. Ask user (risk 0.5) → Person icon (above agent) - user decides
 *   3. IT ticket (risk 0.7) → Admin icon (below Edison) - escalated
 *   4. Blocked  (risk 0.9) → Denied (bottom-center) - stopped at gateway
 *
 * 16s loop. Pure SVG + CSS. Respects `prefers-reduced-motion`.
 *
 * Requires CSS custom properties: --text-primary, --accent, --text-muted.
 */
import {
  ADMIN_PATH,
  DANGER,
  EdisonLogo,
  McpIcon,
  McpPacket,
  ORANGE as O,
  PERSON_PATH,
  ProgressBar,
  RobotIcon,
} from "../_shared";
import { SLACK_SVG, SLACK_SVG_VIEWBOX } from "../../svg/app-icons-svg";

const AMBER = "#f5a524";
const TICKET = "#5b8def";

const COLORS = ["var(--accent)", AMBER, TICKET, DANGER] as const;

/** Destination coordinates for outbound packets */
const DEST = [
  { x: 580, y: 80 }, // MCP server (top-right)
  { x: 134, y: 78 }, // Person/user (above laptop)
  { x: 360, y: 200 }, // Admin (below Edison)
  { x: 360, y: 210 }, // Blocked (below Edison, never arrives)
] as const;

const CSS = `
.sbv { color: var(--text-primary); }

/* Phase headings */
.sbv .sbv-h1 { animation: sbv-h1 16s ease-in-out infinite; }
.sbv .sbv-h2 { animation: sbv-h2 16s ease-in-out infinite; }
.sbv .sbv-h3 { animation: sbv-h3 16s ease-in-out infinite; }
.sbv .sbv-h4 { animation: sbv-h4 16s ease-in-out infinite; }

.sbv .sbv-line { stroke-dashoffset:0; animation: sbv-lf 2s linear infinite; }
.sbv .sbv-pulse { transform-origin:360px 130px; animation: sbv-pulse 1.4s cubic-bezier(.2,.8,.4,1) infinite; }
.sbv .sbv-pkt path, .sbv .sbv-pkt circle { fill: currentColor; }

/* Inbound packets: robot → Edison */
.sbv .sbv-pk1 { color:${O}; animation: sbv-pk1 16s ease-in-out infinite; }
.sbv .sbv-pk2 { color:${O}; animation: sbv-pk2 16s ease-in-out infinite; }
.sbv .sbv-pk3 { color:${O}; animation: sbv-pk3 16s ease-in-out infinite; }
.sbv .sbv-pk4 { color:${O}; animation: sbv-pk4 16s ease-in-out infinite; }

/* Radar container per phase */
.sbv .sbv-radar1 { animation: sbv-radar1 16s ease-in-out infinite; }
.sbv .sbv-radar2 { animation: sbv-radar2 16s ease-in-out infinite; }
.sbv .sbv-radar3 { animation: sbv-radar3 16s ease-in-out infinite; }
.sbv .sbv-radar4 { animation: sbv-radar4 16s ease-in-out infinite; }

/* Sweep arm rotation */
.sbv .sbv-sweep1 { transform-origin:360px 50px; animation: sbv-sweep1 16s linear infinite; }
.sbv .sbv-sweep2 { transform-origin:360px 50px; animation: sbv-sweep2 16s linear infinite; }
.sbv .sbv-sweep3 { transform-origin:360px 50px; animation: sbv-sweep3 16s linear infinite; }
.sbv .sbv-sweep4 { transform-origin:360px 50px; animation: sbv-sweep4 16s linear infinite; }

/* Score revealed after sweep */
.sbv .sbv-score1 { animation: sbv-score1 16s ease-in-out infinite; }
.sbv .sbv-score2 { animation: sbv-score2 16s ease-in-out infinite; }
.sbv .sbv-score3 { animation: sbv-score3 16s ease-in-out infinite; }
.sbv .sbv-score4 { animation: sbv-score4 16s ease-in-out infinite; }

/* Outbound packets: Edison → destinations */
.sbv .sbv-out1 { color:var(--accent); animation: sbv-out1 16s ease-in-out infinite; }
.sbv .sbv-out2 { color:${AMBER}; animation: sbv-out2 16s ease-in-out infinite; }
.sbv .sbv-out3 { color:${TICKET}; animation: sbv-out3 16s ease-in-out infinite; }
.sbv .sbv-out4 { color:${DANGER}; animation: sbv-out4 16s ease-in-out infinite; }

/* Approval ticks on user and admin */
.sbv .sbv-approve2 { transform-origin: 160px 75px; animation: sbv-approve2 16s ease-in-out infinite; }
.sbv .sbv-approve3 { transform-origin: 420px 200px; animation: sbv-approve3 16s ease-in-out infinite; }

/* Secondary packets: intermediary → Slack after approval */
.sbv .sbv-fwd2 { color:var(--accent); animation: sbv-fwd2 16s ease-in-out infinite; }
.sbv .sbv-fwd3 { color:var(--accent); animation: sbv-fwd3 16s ease-in-out infinite; }

/* Destination highlight glow */
.sbv .sbv-dh1 { animation: sbv-dh1 16s ease-in-out infinite; }
.sbv .sbv-dh2 { animation: sbv-dh2 16s ease-in-out infinite; }
.sbv .sbv-dh3 { animation: sbv-dh3 16s ease-in-out infinite; }
/* Slack highlight for forwarded packets (phases 2 & 3) */
.sbv .sbv-dh1b { animation: sbv-dh1b 16s ease-in-out infinite; }
.sbv .sbv-dh1c { animation: sbv-dh1c 16s ease-in-out infinite; }

/* Phase 4: policy checklist container */
.sbv .sbv-checklist { animation: sbv-checklist 16s ease-in-out infinite; }
/* Individual checklist rows revealed sequentially */
.sbv .sbv-chk1 { animation: sbv-chk1 16s ease-in-out infinite; }
/* Big red X between Edison and Slack */
.sbv .sbv-block-x { animation: sbv-block-x 16s ease-in-out infinite; }
.sbv .sbv-chk2 { animation: sbv-chk2 16s ease-in-out infinite; }
.sbv .sbv-chk3 { animation: sbv-chk3 16s ease-in-out infinite; }

.sbv .sbv-progress { transform-origin:20px 248px; animation: sbv-prog 16s linear infinite; }

/* Phase headings: match phase timeline boundaries */
@keyframes sbv-h1 { 0%     { opacity:0; } 1%,17%  { opacity:1; } 18%,100% { opacity:0; } }
@keyframes sbv-h2 { 0%,18% { opacity:0; } 19%,49% { opacity:1; } 50%,100% { opacity:0; } }
@keyframes sbv-h3 { 0%,50% { opacity:0; } 51%,81% { opacity:1; } 82%,100% { opacity:0; } }
@keyframes sbv-h4 { 0%,82% { opacity:0; } 83%,99% { opacity:1; } 100%     { opacity:0; } }

@keyframes sbv-lf { to { stroke-dashoffset: -12; } }
@keyframes sbv-pulse { 0% { transform:scale(1); opacity:0; } 10% { transform:scale(1); opacity:.4; } 60% { transform:scale(1.6); opacity:0; } 100% { transform:scale(1.6); opacity:0; } }
@keyframes sbv-prog { 0% { transform:scaleX(0); } 100% { transform:scaleX(1); } }

/*
 * Timeline (16s = 100%):
 *   Phase 1:  0–18%   Direct approve → Slack
 *   Phase 2: 18–50%   Ask user → approve → back through Edison → Slack
 *   Phase 3: 50–82%   Ask IT admin → approve → back through Edison → Slack
 *   Phase 4: 82–100%  Blocked at gateway
 */

/* Inbound packets: laptop → Edison */
@keyframes sbv-pk1 {
  0%,1%   { opacity:0; }
  2%      { transform:translate(180px,130px); opacity:.8; }
  6%      { transform:translate(338px,130px); opacity:1; }
  7%      { opacity:0; }
  100%    { opacity:0; }
}
@keyframes sbv-pk2 {
  0%,19%  { opacity:0; }
  20%     { transform:translate(180px,130px); opacity:.8; }
  24%     { transform:translate(338px,130px); opacity:1; }
  25%     { opacity:0; }
  100%    { opacity:0; }
}
@keyframes sbv-pk3 {
  0%,51%  { opacity:0; }
  52%     { transform:translate(180px,130px); opacity:.8; }
  56%     { transform:translate(338px,130px); opacity:1; }
  57%     { opacity:0; }
  100%    { opacity:0; }
}
@keyframes sbv-pk4 {
  0%,82%  { opacity:0; }
  83%     { transform:translate(180px,130px); opacity:.8; }
  86%     { transform:translate(338px,130px); opacity:1; }
  87%     { opacity:0; }
  100%    { opacity:0; }
}

/* Radar visibility */
@keyframes sbv-radar1 { 0%,5%  { opacity:0; } 6%,14%  { opacity:1; } 16%,100% { opacity:0; } }
@keyframes sbv-radar2 { 0%,23% { opacity:0; } 24%,32% { opacity:1; } 34%,100% { opacity:0; } }
@keyframes sbv-radar3 { 0%,55% { opacity:0; } 56%,64% { opacity:1; } 66%,100% { opacity:0; } }
@keyframes sbv-radar4 { 0%,85% { opacity:0; } 86%,99% { opacity:1; } 100% { opacity:0; } }

/* Sweep: 1.5 rotations within radar window */
@keyframes sbv-sweep1 { 0%,5%  { transform:rotate(0deg); } 13% { transform:rotate(540deg); } 16%,100% { transform:rotate(540deg); } }
@keyframes sbv-sweep2 { 0%,23% { transform:rotate(0deg); } 31% { transform:rotate(540deg); } 34%,100% { transform:rotate(540deg); } }
@keyframes sbv-sweep3 { 0%,55% { transform:rotate(0deg); } 63% { transform:rotate(540deg); } 66%,100% { transform:rotate(540deg); } }
@keyframes sbv-sweep4 { 0%,85% { transform:rotate(0deg); } 89% { transform:rotate(540deg); } 100% { transform:rotate(540deg); } }

/* Verdict icon after sweep */
@keyframes sbv-score1 { 0%,12% { opacity:0; } 13%,15% { opacity:1; } 16%,100% { opacity:0; } }
@keyframes sbv-score2 { 0%,30% { opacity:0; } 31%,33% { opacity:1; } 34%,100% { opacity:0; } }
@keyframes sbv-score3 { 0%,62% { opacity:0; } 63%,65% { opacity:1; } 66%,100% { opacity:0; } }
@keyframes sbv-score4 { 0%,93% { opacity:0; } 94%,99% { opacity:1; } 100% { opacity:0; } }

/* Outbound packets: Edison → destination */
@keyframes sbv-out1 {
  0%,14%  { opacity:0; }
  15%     { transform:translate(382px,130px); opacity:.8; }
  17%     { transform:translate(${DEST[0].x}px,${DEST[0].y}px); opacity:1; }
  18%     { opacity:0; }
  100%    { opacity:0; }
}
@keyframes sbv-out2 {
  0%,33%  { opacity:0; }
  34%     { transform:translate(338px,130px); opacity:.8; }
  36%     { transform:translate(${DEST[1].x}px,${DEST[1].y}px); opacity:1; }
  37%     { opacity:0; }
  100%    { opacity:0; }
}
@keyframes sbv-out3 {
  0%,65%  { opacity:0; }
  66%     { transform:translate(360px,155px); opacity:.8; }
  68%     { transform:translate(${DEST[2].x}px,${DEST[2].y}px); opacity:1; }
  69%     { opacity:0; }
  100%    { opacity:0; }
}
@keyframes sbv-out4 {
  0%,93%  { opacity:0; }
  94%     { transform:translate(382px,130px); opacity:.6; }
  95%     { transform:translate(460px,112px); opacity:.3; }
  96%     { opacity:0; }
  100%    { opacity:0; }
}

/* Destination highlight */
@keyframes sbv-dh1 { 0%,16% { opacity:0; } 17%,18% { opacity:1; } 19%,100% { opacity:0; } }
@keyframes sbv-dh2 { 0%,35% { opacity:0; } 36%,38% { opacity:1; } 39%,100% { opacity:0; } }
@keyframes sbv-dh3 { 0%,67% { opacity:0; } 68%,70% { opacity:1; } 71%,100% { opacity:0; } }

/* Approval ticks: appear on intermediary after packet arrives */
@keyframes sbv-approve2 { 0%,38% { opacity:0; transform:scale(0.5); } 39%,43% { opacity:1; transform:scale(1); } 44%,100% { opacity:0; transform:scale(1); } }
@keyframes sbv-approve3 { 0%,70% { opacity:0; transform:scale(0.5); } 71%,75% { opacity:1; transform:scale(1); } 76%,100% { opacity:0; transform:scale(1); } }

/* Forwarded packets: intermediary → Edison → Slack after approval */
@keyframes sbv-fwd2 {
  0%,43%  { opacity:0; }
  44%     { transform:translate(${DEST[1].x}px,${DEST[1].y}px); opacity:.8; color:${AMBER}; }
  46%     { transform:translate(360px,130px); opacity:1; color:var(--accent); }
  47%     { transform:translate(382px,130px); opacity:1; color:var(--accent); }
  49%     { transform:translate(${DEST[0].x}px,${DEST[0].y}px); opacity:1; color:var(--accent); }
  50%     { opacity:0; }
  100%    { opacity:0; }
}
@keyframes sbv-fwd3 {
  0%,75%  { opacity:0; }
  76%     { transform:translate(${DEST[2].x}px,${DEST[2].y}px); opacity:.8; color:${TICKET}; }
  78%     { transform:translate(360px,130px); opacity:1; color:var(--accent); }
  79%     { transform:translate(382px,130px); opacity:1; color:var(--accent); }
  81%     { transform:translate(${DEST[0].x}px,${DEST[0].y}px); opacity:1; color:var(--accent); }
  82%     { opacity:0; }
  100%    { opacity:0; }
}

/* Slack highlight when forwarded packets arrive */
@keyframes sbv-dh1b { 0%,48% { opacity:0; } 49%,50% { opacity:1; } 51%,100% { opacity:0; } }
@keyframes sbv-dh1c { 0%,80% { opacity:0; } 81%,82% { opacity:1; } 83%,100% { opacity:0; } }

/* Ticket card appears when traffic arrives at IT admin */
.sbv .sbv-ticket { animation: sbv-ticket 16s ease-in-out infinite; }
@keyframes sbv-ticket { 0%,67% { opacity:0; transform:translateY(4px); } 68%,80% { opacity:1; transform:translateY(0); } 82%,100% { opacity:0; } }

/* Phase 4: policy checklist - appears next to radar after sweep, before verdict */
@keyframes sbv-checklist { 0%,88% { opacity:0; } 89%,99% { opacity:1; } 100% { opacity:0; } }
@keyframes sbv-chk1 { 0%,88% { opacity:0; } 89%,99% { opacity:1; } 100% { opacity:0; } }
@keyframes sbv-chk2 { 0%,90% { opacity:0; } 91%,99% { opacity:1; } 100% { opacity:0; } }
@keyframes sbv-chk3 { 0%,92% { opacity:0; } 93%,99% { opacity:1; } 100% { opacity:0; } }
@keyframes sbv-block-x { 0%,93% { opacity:0; transform:scale(0.5); } 94%,99% { opacity:1; transform:scale(1); } 100% { opacity:0; } }

@media (prefers-reduced-motion:reduce) {
  .sbv .sbv-h1, .sbv .sbv-h2, .sbv .sbv-h3, .sbv .sbv-h4,
  .sbv .sbv-line, .sbv .sbv-pulse, .sbv .sbv-progress,
  .sbv .sbv-pk1, .sbv .sbv-pk2, .sbv .sbv-pk3, .sbv .sbv-pk4,
  .sbv .sbv-radar1, .sbv .sbv-radar2, .sbv .sbv-radar3, .sbv .sbv-radar4,
  .sbv .sbv-sweep1, .sbv .sbv-sweep2, .sbv .sbv-sweep3, .sbv .sbv-sweep4,
  .sbv .sbv-score1, .sbv .sbv-score2, .sbv .sbv-score3, .sbv .sbv-score4,
  .sbv .sbv-out1, .sbv .sbv-out2, .sbv .sbv-out3, .sbv .sbv-out4,
  .sbv .sbv-approve2, .sbv .sbv-approve3,
  .sbv .sbv-fwd2, .sbv .sbv-fwd3,
  .sbv .sbv-dh1, .sbv .sbv-dh2, .sbv .sbv-dh3,
  .sbv .sbv-dh1b, .sbv .sbv-dh1c,
  .sbv .sbv-ticket,
  .sbv .sbv-checklist, .sbv .sbv-chk1, .sbv .sbv-chk2, .sbv .sbv-chk3,
  .sbv .sbv-block-x { animation:none; }
  .sbv .sbv-progress { transform:scaleX(1); }
  .sbv .sbv-pk1, .sbv .sbv-pk2, .sbv .sbv-pk3, .sbv .sbv-pk4 { opacity:0; }
  .sbv .sbv-out1, .sbv .sbv-out2, .sbv .sbv-out3, .sbv .sbv-out4 { opacity:0; }
  .sbv .sbv-fwd2, .sbv .sbv-fwd3 { opacity:0; }
  .sbv .sbv-approve2, .sbv .sbv-approve3 { opacity:0; }
  .sbv .sbv-radar1 { opacity:1; }
  .sbv .sbv-radar2, .sbv .sbv-radar3, .sbv .sbv-radar4 { opacity:0; }
  .sbv .sbv-sweep1 { transform:rotate(540deg); }
  .sbv .sbv-score1 { opacity:1; }
  .sbv .sbv-score2, .sbv .sbv-score3, .sbv .sbv-score4 { opacity:0; }
  .sbv .sbv-dh1 { opacity:1; }
  .sbv .sbv-dh2, .sbv .sbv-dh3, .sbv .sbv-dh1b, .sbv .sbv-dh1c { opacity:0; }
  .sbv .sbv-ticket { opacity:0; }
  .sbv .sbv-checklist { opacity:0; }
  .sbv .sbv-chk1, .sbv .sbv-chk2, .sbv .sbv-chk3 { opacity:0; }
  .sbv .sbv-block-x { opacity:0; }
  .sbv .sbv-h1 { opacity:1; }
  .sbv .sbv-h2, .sbv .sbv-h3, .sbv .sbv-h4 { opacity:0; }
}
`;

export default function SecurityBusinessValueAnimation(): React.ReactNode {
  return (
    <div className="flex justify-center">
      <style>{CSS}</style>
      <svg
        className="sbv"
        width={720}
        height={275}
        viewBox="0 -15 720 275"
        xmlns="http://www.w3.org/2000/svg"
        role="presentation"
        aria-hidden="true"
      >
        {/* ══ Phase headings ══ */}
        <text
          className="sbv-h1"
          x="360"
          y="-2"
          textAnchor="middle"
          fill="var(--accent)"
          fontSize="10"
          fontWeight="bold"
          fontFamily="system-ui,sans-serif"
        >
          Routine request - approved automatically
        </text>
        <text
          className="sbv-h2"
          x="360"
          y="-2"
          textAnchor="middle"
          fill={AMBER}
          fontSize="10"
          fontWeight="bold"
          fontFamily="system-ui,sans-serif"
        >
          Needs consent - ask the user
        </text>
        <text
          className="sbv-h3"
          x="360"
          y="-2"
          textAnchor="middle"
          fill={TICKET}
          fontSize="10"
          fontWeight="bold"
          fontFamily="system-ui,sans-serif"
        >
          New scenario - escalate to IT
        </text>
        <text
          className="sbv-h4"
          x="360"
          y="-2"
          textAnchor="middle"
          fill={DANGER}
          fontSize="10"
          fontWeight="bold"
          fontFamily="system-ui,sans-serif"
        >
          Policy violation - blocked
        </text>

        {/* ══ Connector lines (always visible, faint) ══ */}
        {/* Laptop → Edison */}
        <line
          className="sbv-line"
          x1="176"
          y1="130"
          x2="338"
          y2="130"
          stroke="var(--text-muted)"
          strokeOpacity="0.35"
          strokeWidth="1.5"
          strokeDasharray="3 3"
        />
        {/* Edison → MCP server (top-right) */}
        <line
          className="sbv-line"
          x1="382"
          y1="130"
          x2="570"
          y2="80"
          stroke={COLORS[0]}
          strokeOpacity="0.15"
          strokeWidth="1"
          strokeDasharray="3 3"
        />
        {/* Edison → User (back up to person above laptop) */}
        <line
          className="sbv-line"
          x1="338"
          y1="130"
          x2="150"
          y2="80"
          stroke={COLORS[1]}
          strokeOpacity="0.15"
          strokeWidth="1"
          strokeDasharray="3 3"
        />
        {/* Edison → Admin (below Edison) */}
        <line
          className="sbv-line"
          x1="360"
          y1="155"
          x2="360"
          y2="185"
          stroke={COLORS[2]}
          strokeOpacity="0.15"
          strokeWidth="1"
          strokeDasharray="3 3"
        />
        {/* User → Edison (return path after approval) */}
        <line
          className="sbv-line"
          x1="155"
          y1="78"
          x2="338"
          y2="130"
          stroke="var(--accent)"
          strokeOpacity="0.1"
          strokeWidth="1"
          strokeDasharray="3 3"
        />
        {/* Admin → Edison (return path after approval) */}
        <line
          className="sbv-line"
          x1="364"
          y1="185"
          x2="364"
          y2="155"
          stroke="var(--accent)"
          strokeOpacity="0.1"
          strokeWidth="1"
          strokeDasharray="3 3"
        />

        {/* ═══════════════════════════════════════════════
            DESTINATIONS (all 4 always visible)
            ═══════════════════════════════════════════════ */}

        {/* ── 1. Slack MCP connector (top-right) - approved, tool call proceeds ── */}
        <g>
          <rect
            x={560}
            y={56}
            width={130}
            height={48}
            rx={8}
            fill="var(--accent)"
            fillOpacity="0.04"
            stroke="var(--accent)"
            strokeOpacity="0.2"
            strokeWidth="1"
          />
          <McpIcon
            x={568}
            y={62}
            size={14}
            color="var(--accent)"
            opacity="0.5"
          />
          <svg
            x={584}
            y={62}
            width={18}
            height={18}
            viewBox={SLACK_SVG_VIEWBOX}
            dangerouslySetInnerHTML={{ __html: SLACK_SVG }}
          />
          <text
            x={608}
            y={74}
            fill="var(--text-primary)"
            fontSize="8.5"
            fontWeight="600"
            fontFamily="system-ui,sans-serif"
          >
            Slack
          </text>
          <text
            x={568}
            y={94}
            fill="var(--text-muted)"
            fontSize="7"
            fontFamily="system-ui,sans-serif"
          >
            Approved · send DM
          </text>
          {/* Highlight glow */}
          <rect
            className="sbv-dh1"
            x={558}
            y={54}
            width={134}
            height={52}
            rx={9}
            fill="none"
            stroke="var(--accent)"
            strokeOpacity="0.7"
            strokeWidth="1.5"
          />
        </g>

        {/* ── 2. User / User (above laptop) ── */}
        <g>
          <svg x={121} y={62} width={26} height={26} viewBox="0 0 256 256">
            <path d={PERSON_PATH} fill={AMBER} fillOpacity="0.6" />
          </svg>
          <text
            x="134"
            y="60"
            textAnchor="middle"
            fill={AMBER}
            fillOpacity="0.85"
            fontSize="7.5"
            fontWeight="600"
            fontFamily="system-ui,sans-serif"
          >
            User
          </text>
          {/* Highlight glow */}
          <circle
            className="sbv-dh2"
            cx={134}
            cy={78}
            r={20}
            fill="none"
            stroke={AMBER}
            strokeOpacity="0.6"
            strokeWidth="1.5"
          />
        </g>

        {/* ── 3. IT Admin + Ticket card (below Edison) ── */}
        <g>
          <rect
            x={310}
            y={185}
            width={100}
            height={36}
            rx={8}
            fill={TICKET}
            fillOpacity="0.04"
            stroke={TICKET}
            strokeOpacity="0.2"
            strokeWidth="1"
          />
          {/* Admin icon */}
          <svg x={318} y={191} width={20} height={20} viewBox="0 0 256 256">
            <path d={ADMIN_PATH} fill={TICKET} fillOpacity="0.6" />
          </svg>
          <text
            x={342}
            y={204}
            fill="var(--text-primary)"
            fontSize="8.5"
            fontWeight="600"
            fontFamily="system-ui,sans-serif"
          >
            IT Admin
          </text>
          <text
            x={342}
            y={214}
            fill="var(--text-muted)"
            fontSize="7"
            fontFamily="system-ui,sans-serif"
          >
            Escalated
          </text>
          {/* Highlight glow */}
          <rect
            className="sbv-dh3"
            x={308}
            y={183}
            width={104}
            height={40}
            rx={9}
            fill="none"
            stroke={TICKET}
            strokeOpacity="0.7"
            strokeWidth="1.5"
          />
          {/* Ticket card - appears to the right when traffic arrives */}
          <g className="sbv-ticket">
            <rect
              x={420}
              y={189}
              width={78}
              height={28}
              rx={5}
              fill={TICKET}
              fillOpacity="0.06"
              stroke={TICKET}
              strokeOpacity="0.3"
              strokeWidth="0.8"
            />
            {/* Ticket icon */}
            <svg x={424} y={192} width={16} height={16} viewBox="0 0 256 256">
              <path
                d="M232,104a8,8,0,0,0,8-8V64a16,16,0,0,0-16-16H32A16,16,0,0,0,16,64V96a8,8,0,0,0,8,8,24,24,0,0,1,0,48,8,8,0,0,0-8,8v32a16,16,0,0,0,16,16H224a16,16,0,0,0,16-16V160a8,8,0,0,0-8-8,24,24,0,0,1,0-48ZM32,167.2a40,40,0,0,0,0-78.4V64H88V192H32Zm192,0V192H104V64H224V88.8a40,40,0,0,0,0,78.4Z"
                fill={TICKET}
                fillOpacity="0.7"
              />
            </svg>
            {/* Ticket number */}
            <text
              x={444}
              y={201}
              fill={TICKET}
              fontSize="7.5"
              fontWeight="bold"
              fontFamily="system-ui,sans-serif"
            >
              #4218
            </text>
            {/* Description */}
            <text
              x={444}
              y={212}
              fill={TICKET}
              fillOpacity="0.7"
              fontSize="6.5"
              fontFamily="system-ui,sans-serif"
            >
              HRIS access
            </text>
          </g>
        </g>

        {/* ═══════════════════════════════════════════════
            USER'S LAPTOP with AI agent inside
            ═══════════════════════════════════════════════ */}
        {/* Laptop screen */}
        <rect
          x={94}
          y={100}
          width={80}
          height={52}
          rx={5}
          fill="var(--text-primary)"
          fillOpacity="0.03"
          stroke="var(--text-muted)"
          strokeOpacity="0.35"
          strokeWidth="1.5"
        />
        {/* Laptop stand */}
        <rect
          x={90}
          y={154}
          width={88}
          height={5}
          rx={2.5}
          fill="var(--text-primary)"
          fillOpacity="0.04"
          stroke="var(--text-muted)"
          strokeOpacity="0.35"
          strokeWidth="1"
        />
        {/* Robot (AI agent) inside the laptop */}
        <RobotIcon x={114} y={106} size={36} fill={O} fillOpacity="0.6" />
        <text
          x="134"
          y="146"
          textAnchor="middle"
          fill="var(--text-muted)"
          fontSize="7"
          fontFamily="system-ui,sans-serif"
        >
          AI Agent
        </text>

        {/* ═══════════════════════════════════════════════
            EDISON GATEWAY (center)
            ═══════════════════════════════════════════════ */}
        <circle
          className="sbv-pulse"
          cx="360"
          cy="130"
          r="24"
          fill="none"
          stroke="var(--accent)"
          strokeOpacity="0.5"
          strokeWidth="1.5"
        />
        <EdisonLogo x={338} y={110} w={44} h={42} />
        <text
          x="360"
          y="166"
          textAnchor="middle"
          fill="var(--text-primary)"
          fontSize="8"
          fontWeight="bold"
          fontFamily="system-ui,sans-serif"
        >
          Edison
        </text>

        {/* ═══════════════════════════════════════════════
            RADAR SCANNER (above Edison, per phase)
            ═══════════════════════════════════════════════ */}
        {COLORS.map((color, i) => (
          <g key={i} className={`sbv-radar${i + 1}`}>
            <circle
              cx={360}
              cy={50}
              r={22}
              fill="none"
              stroke={color}
              strokeOpacity="0.1"
              strokeWidth="0.6"
            />
            <circle
              cx={360}
              cy={50}
              r={15}
              fill="none"
              stroke={color}
              strokeOpacity="0.16"
              strokeWidth="0.6"
            />
            <circle
              cx={360}
              cy={50}
              r={8}
              fill="none"
              stroke={color}
              strokeOpacity="0.22"
              strokeWidth="0.6"
            />
            <circle cx={360} cy={50} r={2} fill={color} fillOpacity="0.4" />
            <line
              x1={338}
              y1={50}
              x2={382}
              y2={50}
              stroke={color}
              strokeOpacity="0.08"
              strokeWidth="0.5"
            />
            <line
              x1={360}
              y1={28}
              x2={360}
              y2={72}
              stroke={color}
              strokeOpacity="0.08"
              strokeWidth="0.5"
            />
            {/* Sweep arm */}
            <g className={`sbv-sweep${i + 1}`}>
              <line
                x1={360}
                y1={50}
                x2={360}
                y2={29}
                stroke={color}
                strokeOpacity="0.75"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
              <path
                d="M360,50 L354,30 A22,22 0 0,1 360,28 Z"
                fill={color}
                fillOpacity="0.12"
              />
            </g>
            {/* Verdict icon revealed after sweep - positioned above the radar */}
            <g className={`sbv-score${i + 1}`}>
              <circle cx={360} cy={18} r={12} fill={color} fillOpacity="0.1" />
              {/* Checkmark for approved */}
              {i === 0 && (
                <polyline
                  points="354,18 358,22 366,14"
                  fill="none"
                  stroke={color}
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
              {/* Warning triangle for ask user */}
              {i === 1 && (
                <g>
                  <path
                    d="M360,9 L369,25 L351,25 Z"
                    fill="none"
                    stroke={color}
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                  <text
                    x={360}
                    y={23}
                    textAnchor="middle"
                    fill={color}
                    fontSize="9"
                    fontWeight="bold"
                    fontFamily="system-ui,sans-serif"
                  >
                    !
                  </text>
                </g>
              )}
              {/* Question mark for IT ticket */}
              {i === 2 && (
                <text
                  x={360}
                  y={23}
                  textAnchor="middle"
                  fill={color}
                  fontSize="14"
                  fontWeight="bold"
                  fontFamily="system-ui,sans-serif"
                >
                  ?
                </text>
              )}
              {/* Red X for blocked */}
              {i === 3 && (
                <g>
                  <line
                    x1={355}
                    y1={13}
                    x2={365}
                    y2={23}
                    stroke={color}
                    strokeWidth="2.2"
                    strokeLinecap="round"
                  />
                  <line
                    x1={365}
                    y1={13}
                    x2={355}
                    y2={23}
                    stroke={color}
                    strokeWidth="2.2"
                    strokeLinecap="round"
                  />
                </g>
              )}
            </g>
          </g>
        ))}

        {/* ═══════════════════════════════════════════════
            PHASE 4: POLICY CHECKLIST (right of radar)
            ═══════════════════════════════════════════════ */}
        <g className="sbv-checklist">
          <rect
            x={392}
            y={32}
            width={80}
            height={42}
            rx={5}
            fill="var(--text-primary)"
            fillOpacity="0.03"
            stroke={DANGER}
            strokeOpacity="0.2"
            strokeWidth="0.8"
          />
          {/* Row 1 - pass */}
          <g className="sbv-chk1">
            <polyline
              points="399,44 401,46 405,41"
              fill="none"
              stroke="var(--accent)"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <rect
              x={412}
              y={41}
              width={52}
              height={5}
              rx={2.5}
              fill="var(--accent)"
              fillOpacity="0.15"
            />
          </g>
          {/* Row 2 - pass */}
          <g className="sbv-chk2">
            <polyline
              points="399,55 401,57 405,52"
              fill="none"
              stroke="var(--accent)"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <rect
              x={412}
              y={52}
              width={40}
              height={5}
              rx={2.5}
              fill="var(--accent)"
              fillOpacity="0.15"
            />
          </g>
          {/* Row 3 - fail */}
          <g className="sbv-chk3">
            <line
              x1={399}
              y1={63}
              x2={405}
              y2={69}
              stroke={DANGER}
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <line
              x1={405}
              y1={63}
              x2={399}
              y2={69}
              stroke={DANGER}
              strokeWidth="1.5"
              strokeLinecap="round"
            />
            <rect
              x={412}
              y={63}
              width={46}
              height={5}
              rx={2.5}
              fill={DANGER}
              fillOpacity="0.2"
            />
          </g>
        </g>

        {/* ══ Phase 4: big red X blocking path to Slack ══ */}
        <g className="sbv-block-x" style={{ transformOrigin: "470px 110px" }}>
          <circle cx={470} cy={110} r={16} fill={DANGER} fillOpacity="0.1" />
          <line
            x1={461}
            y1={101}
            x2={479}
            y2={119}
            stroke={DANGER}
            strokeWidth="3"
            strokeLinecap="round"
          />
          <line
            x1={479}
            y1={101}
            x2={461}
            y2={119}
            stroke={DANGER}
            strokeWidth="3"
            strokeLinecap="round"
          />
        </g>

        {/* ═══════════════════════════════════════════════
            PACKETS
            ═══════════════════════════════════════════════ */}
        {/* Inbound: robot → Edison */}
        <g className="sbv-pkt sbv-pk1">
          <McpPacket />
        </g>
        <g className="sbv-pkt sbv-pk2">
          <McpPacket />
        </g>
        <g className="sbv-pkt sbv-pk3">
          <McpPacket />
        </g>
        <g className="sbv-pkt sbv-pk4">
          <McpPacket />
        </g>

        {/* Outbound: Edison → destinations */}
        <g className="sbv-pkt sbv-out1">
          <McpPacket />
        </g>
        <g className="sbv-pkt sbv-out2">
          <McpPacket />
        </g>
        <g className="sbv-pkt sbv-out3">
          <McpPacket />
        </g>
        <g className="sbv-pkt sbv-out4">
          <McpPacket />
        </g>

        {/* ══ Approval ticks (appear on intermediaries before forwarding) ══ */}
        {/* User approval tick */}
        <g className="sbv-approve2">
          <circle
            cx={160}
            cy={75}
            r={8}
            fill="var(--accent)"
            fillOpacity="0.15"
          />
          <polyline
            points="155,75 158,78 165,71"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
        {/* Admin approval tick */}
        <g className="sbv-approve3">
          <circle
            cx={420}
            cy={200}
            r={8}
            fill="var(--accent)"
            fillOpacity="0.15"
          />
          <polyline
            points="415,200 418,203 425,196"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>

        {/* ══ Forwarded packets: intermediary → Slack ══ */}
        <g className="sbv-pkt sbv-fwd2">
          <McpPacket />
        </g>
        <g className="sbv-pkt sbv-fwd3">
          <McpPacket />
        </g>

        {/* ══ Slack highlight when forwarded packets arrive ══ */}
        <rect
          className="sbv-dh1b"
          x={558}
          y={54}
          width={134}
          height={52}
          rx={9}
          fill="none"
          stroke="var(--accent)"
          strokeOpacity="0.7"
          strokeWidth="1.5"
        />
        <rect
          className="sbv-dh1c"
          x={558}
          y={54}
          width={134}
          height={52}
          rx={9}
          fill="none"
          stroke="var(--accent)"
          strokeOpacity="0.7"
          strokeWidth="1.5"
        />

        {/* ══ Progress bar ══ */}
        <ProgressBar y={248} width={680} className="sbv-progress" />
      </svg>
    </div>
  );
}
