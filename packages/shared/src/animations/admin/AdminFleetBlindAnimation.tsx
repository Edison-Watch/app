/**
 * Admin Fleet "Blind" animation for documentation.
 *
 * Standalone slice of the first half of {@link AdminFleetAnimation}: three
 * employee laptops with AI agents connect directly to MCP servers, and the
 * admin has NO visibility. A single packet round-trips between Laptop 2 and
 * the middle MCP server to convey live but invisible traffic.
 *
 * Pure SVG + CSS. Respects `prefers-reduced-motion`.
 *
 * Reusable building blocks (laptops, servers, no-visibility overlay, direct
 * connection lines, server icon assets) are exported so the full
 * {@link AdminFleetAnimation} can re-use them for its Phase 1 frames.
 */
import { useId } from "react";
import {
  AGENT_REGISTRY,
  type AgentIconEntry,
} from "../../agent-registry/index";
import {
  ADMIN_PATH,
  AgentIcon,
  DANGER,
  EYE_SLASH_PATH,
  McpIcon,
  McpPacket,
  ORANGE as O,
  ProgressBar,
} from "../_shared";

const CURSOR = AGENT_REGISTRY["cursor"];
const CLAUDE = AGENT_REGISTRY["claude-code"];
const CODEX = AGENT_REGISTRY["codex"];

export const SLACK_SVG =
  '<g clip-rule="evenodd" fill-rule="evenodd"><path d="m897.4 0c-135.3.1-244.8 109.9-244.7 245.2-.1 135.3 109.5 245.1 244.8 245.2h244.8v-245.1c.1-135.3-109.5-245.1-244.9-245.3.1 0 .1 0 0 0m0 654h-652.6c-135.3.1-244.9 109.9-244.8 245.2-.2 135.3 109.4 245.1 244.7 245.3h652.7c135.3-.1 244.9-109.9 244.8-245.2.1-135.4-109.5-245.2-244.8-245.3z" fill="#36c5f0"/><path d="m2447.6 899.2c.1-135.3-109.5-245.1-244.8-245.2-135.3.1-244.9 109.9-244.8 245.2v245.3h244.8c135.3-.1 244.9-109.9 244.8-245.3zm-652.7 0v-654c.1-135.2-109.4-245-244.7-245.2-135.3.1-244.9 109.9-244.8 245.2v654c-.2 135.3 109.4 245.1 244.7 245.3 135.3-.1 244.9-109.9 244.8-245.3z" fill="#2eb67d"/><path d="m1550.1 2452.5c135.3-.1 244.9-109.9 244.8-245.2.1-135.3-109.5-245.1-244.8-245.2h-244.8v245.2c-.1 135.2 109.5 245 244.8 245.2zm0-654.1h652.7c135.3-.1 244.9-109.9 244.8-245.2.2-135.3-109.4-245.1-244.7-245.3h-652.7c-135.3.1-244.9 109.9-244.8 245.2-.1 135.4 109.4 245.2 244.7 245.3z" fill="#ecb22e"/><path d="m0 1553.2c-.1 135.3 109.5 245.1 244.8 245.2 135.3-.1 244.9-109.9 244.8-245.2v-245.2h-244.8c-135.3.1-244.9 109.9-244.8 245.2zm652.7 0v654c-.2 135.3 109.4 245.1 244.7 245.3 135.3-.1 244.9-109.9 244.8-245.2v-653.9c.2-135.3-109.4-245.1-244.7-245.3-135.4 0-244.9 109.8-244.8 245.1 0 0 0 .1 0 0" fill="#e01e5a"/></g>';
export const GITHUB_SVG =
  '<path fill-rule="evenodd" clip-rule="evenodd" d="M8 0C3.58 0 0 3.58 0 8C0 11.54 2.29 14.53 5.47 15.59C5.87 15.66 6.02 15.42 6.02 15.21C6.02 15.02 6.01 14.39 6.01 13.72C4 14.09 3.48 13.23 3.32 12.78C3.23 12.55 2.84 11.84 2.5 11.65C2.22 11.5 1.82 11.13 2.49 11.12C3.12 11.11 3.57 11.7 3.72 11.94C4.44 13.15 5.59 12.81 6.05 12.6C6.12 12.08 6.33 11.73 6.56 11.53C4.78 11.33 2.92 10.64 2.92 7.58C2.92 6.71 3.23 5.99 3.74 5.43C3.66 5.23 3.38 4.41 3.82 3.31C3.82 3.31 4.49 3.1 6.02 4.13C6.66 3.95 7.34 3.86 8.02 3.86C8.7 3.86 9.38 3.95 10.02 4.13C11.55 3.09 12.22 3.31 12.22 3.31C12.66 4.41 12.38 5.23 12.3 5.43C12.81 5.99 13.12 6.7 13.12 7.58C13.12 10.65 11.25 11.33 9.47 11.53C9.76 11.78 10.01 12.26 10.01 13.01C10.01 14.08 10 14.94 10 15.21C10 15.42 10.15 15.67 10.55 15.59C13.71 14.53 16 11.53 16 8C16 3.58 12.42 0 8 0Z" transform="scale(64)" fill="var(--text-primary)"/>';
export function onedriveSvg(p: string): string {
  return `<defs><radialGradient id="${p}-od_a" cx="-446.23" cy="850.24" r="6.99" gradientTransform="matrix(28.88 32.01 53.7 -48.4 -32750.77 55564.7)" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#4894fe"/><stop offset=".7" stop-color="#0934b3"/></radialGradient><radialGradient id="${p}-od_b" cx="-463.71" cy="855.09" r="6.99" gradientTransform="matrix(-126.94 135.46 101.24 94.78 -144561.83 -18444.24)" gradientUnits="userSpaceOnUse"><stop offset=".17" stop-color="#23c0fe"/><stop offset=".53" stop-color="#1c91ff"/></radialGradient><linearGradient id="${p}-od_g" x1="638.67" x2="638.67" y1="2.44" y2="421.76" gradientTransform="matrix(1 0 0 -1 0 617.01)" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#0086ff"/><stop offset=".49" stop-color="#0bf"/></linearGradient></defs><path d="M276.36 94.08C123.48 94.08 9.21 209.84.6 338.79c5.33 27.79 22.83 82.65 50.24 79.84 34.26-3.52 120.56 0 194.17-123.26 53.77-90.04 164.37-201.29 31.35-201.29Z" fill="url(#${p}-od_a)"/><path d="M240.99 142.19c-51.39 75.26-120.56 183.1-143.91 217.03-27.75 40.34-101.25 23.2-95.16-34.62a237.4 237.4 0 0 0-1.38 14.19C-9.51 489.22 119.43 614.14 279.88 614.14c176.84 0 598.58-203.81 555.9-408.02C790.8 86.1 664.36 0 521.07 0S285.94 76.36 241 142.19Z" fill="url(#${p}-od_b)"/><path d="M277.34 614.23s422.24.77 493.86.77c129.97 0 228.8-98.16 228.8-212.69s-100.8-212.1-228.8-212.1-201.7 88.57-257.06 185.25c-64.87 113.29-147.62 237.41-236.8 238.77Z" fill="url(#${p}-od_g)"/>`;
}

const CSS = `
.afb { color: var(--text-primary); }

.afb .afb-line { stroke-dashoffset:0; animation: afb-lf 2s linear infinite; }
.afb .afb-pkt path, .afb .afb-pkt circle { fill: currentColor; }
.afb .afb-pkt1 { color:${O}; animation: afb-pkt1 6s ease-in-out infinite; }

@keyframes afb-lf { to { stroke-dashoffset: -12; } }

/* L2 ↔ S2 round trip */
@keyframes afb-pkt1 {
  0%,4%   { opacity:0; }
  6%      { transform:translate(120px,133px); opacity:.8; color:${O}; }
  40%     { transform:translate(560px,127px); opacity:1;  color:${O}; }
  44%     { transform:translate(560px,127px); opacity:.7; color:${O}; }
  48%     { transform:translate(560px,127px); opacity:.9; color:${O}; }
  82%     { transform:translate(120px,133px); opacity:1;  color:${O}; }
  84%,100%{ opacity:0; }
}

.afb .afb-progress { transform-origin:20px 275px; animation: afb-prog 6s linear infinite; }
@keyframes afb-prog {
  0%   { transform:scaleX(0); }
  100% { transform:scaleX(1); }
}

@media (prefers-reduced-motion:reduce) {
  .afb .afb-line, .afb .afb-pkt1, .afb .afb-progress { animation:none; }
  .afb .afb-pkt1 { opacity:0; }
  .afb .afb-progress { transform:scaleX(1); }
}
`;

export function Laptop({
  y,
  agents,
}: {
  y: number;
  agents: AgentIconEntry[];
}): React.ReactNode {
  const iconSize = 20;
  const gap = 6;
  const totalWidth = agents.length * iconSize + (agents.length - 1) * gap;
  const startX = 6 + (108 - totalWidth) / 2;
  return (
    <g>
      <rect
        x={6}
        y={y}
        width={108}
        height={55}
        rx={6}
        fill="var(--text-primary)"
        fillOpacity="0.03"
        stroke="var(--text-muted)"
        strokeOpacity="0.35"
        strokeWidth="1.5"
      />
      <rect
        x={2}
        y={y + 57}
        width={116}
        height={6}
        rx={3}
        fill="var(--text-primary)"
        fillOpacity="0.04"
        stroke="var(--text-muted)"
        strokeOpacity="0.35"
        strokeWidth="1"
      />
      {agents.map((agent, i) => (
        <AgentIcon
          key={i}
          agent={agent}
          x={startX + i * (iconSize + gap)}
          y={y + 8}
          size={iconSize}
        />
      ))}
      {/* Local MCP configs */}
      {[0, 1, 2].map((i) => (
        <McpIcon
          key={i}
          x={28 + i * 24}
          y={y + 34}
          size={16}
          color="var(--text-muted)"
          opacity="0.45"
        />
      ))}
    </g>
  );
}

export function McpServer({
  x,
  y,
  iconSvg,
  iconViewBox,
}: {
  x: number;
  y: number;
  iconSvg?: string;
  iconViewBox?: string;
}): React.ReactNode {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={56}
        height={44}
        rx={6}
        fill="var(--text-primary)"
        fillOpacity="0.03"
        stroke="var(--text-muted)"
        strokeOpacity="0.35"
        strokeWidth="1"
      />
      {iconSvg ? (
        <svg
          x={x + 16}
          y={y + 10}
          width={24}
          height={24}
          viewBox={iconViewBox || "0 0 24 24"}
          dangerouslySetInnerHTML={{ __html: iconSvg }}
        />
      ) : (
        <McpIcon
          x={x + 16}
          y={y + 10}
          size={24}
          color="var(--text-muted)"
          opacity="0.6"
        />
      )}
    </g>
  );
}

export function AdminNoVisibilityOverlay(): React.ReactNode {
  return (
    <>
      {/* Large eye-slash under admin */}
      <svg x={322} y={46} width={36} height={36} viewBox="0 0 256 256">
        <path d={EYE_SLASH_PATH} fill={DANGER} fillOpacity="0.7" />
      </svg>
      <text
        x="340"
        y="94"
        textAnchor="middle"
        fill={DANGER}
        fillOpacity="0.6"
        fontSize="8"
        fontFamily="system-ui,sans-serif"
      >
        No visibility
      </text>
      {/* Vision arrows from admin to each laptop */}
      <line
        x1="322"
        y1="24"
        x2="145"
        y2="10"
        stroke={DANGER}
        strokeOpacity="0.6"
        strokeWidth="1.5"
        strokeDasharray="4 3"
      />
      <line
        x1="322"
        y1="24"
        x2="145"
        y2="110"
        stroke={DANGER}
        strokeOpacity="0.6"
        strokeWidth="1.5"
        strokeDasharray="4 3"
      />
      <line
        x1="322"
        y1="24"
        x2="145"
        y2="210"
        stroke={DANGER}
        strokeOpacity="0.6"
        strokeWidth="1.5"
        strokeDasharray="4 3"
      />
      {/* Eye-slash near top of each laptop */}
      {[10, 110, 210].map((ly) => (
        <svg
          key={ly}
          x={133}
          y={ly - 12}
          width={24}
          height={24}
          viewBox="0 0 256 256"
        >
          <path d={EYE_SLASH_PATH} fill={DANGER} fillOpacity="0.75" />
        </svg>
      ))}
    </>
  );
}

export function FleetDirectLines({
  lineClassName,
}: {
  lineClassName?: string;
}): React.ReactNode {
  return (
    <>
      <line
        className={lineClassName}
        x1="120"
        y1="33"
        x2="560"
        y2="47"
        stroke="var(--text-muted)"
        strokeOpacity="0.5"
        strokeWidth="1.5"
        strokeDasharray="3 3"
      />
      <line
        className={lineClassName}
        x1="120"
        y1="33"
        x2="560"
        y2="127"
        stroke="var(--text-muted)"
        strokeOpacity="0.5"
        strokeWidth="1.5"
        strokeDasharray="3 3"
      />
      <line
        className={lineClassName}
        x1="120"
        y1="133"
        x2="560"
        y2="127"
        stroke="var(--text-muted)"
        strokeOpacity="0.5"
        strokeWidth="1.5"
        strokeDasharray="3 3"
      />
      <line
        className={lineClassName}
        x1="120"
        y1="133"
        x2="560"
        y2="207"
        stroke="var(--text-muted)"
        strokeOpacity="0.5"
        strokeWidth="1.5"
        strokeDasharray="3 3"
      />
      <line
        className={lineClassName}
        x1="120"
        y1="233"
        x2="560"
        y2="127"
        stroke="var(--text-muted)"
        strokeOpacity="0.5"
        strokeWidth="1.5"
        strokeDasharray="3 3"
      />
      <line
        className={lineClassName}
        x1="120"
        y1="233"
        x2="560"
        y2="207"
        stroke="var(--text-muted)"
        strokeOpacity="0.5"
        strokeWidth="1.5"
        strokeDasharray="3 3"
      />
    </>
  );
}

export default function AdminFleetBlindAnimation(): React.ReactNode {
  const id = useId();
  const odSvg = onedriveSvg(id);
  return (
    <div className="flex justify-center">
      <style>{CSS}</style>
      <svg
        className="afb"
        width={680}
        height={280}
        viewBox="0 0 680 280"
        xmlns="http://www.w3.org/2000/svg"
        role="presentation"
        aria-hidden="true"
      >
        {/* ══ Admin icon ══ */}
        <g>
          <svg x={327} y={2} width={26} height={26} viewBox="0 0 256 256">
            <path d={ADMIN_PATH} fill="var(--text-primary)" fillOpacity="0.7" />
          </svg>
          <text
            x="340"
            y="40"
            textAnchor="middle"
            fill="var(--text-primary)"
            fontSize="8"
            fontWeight="bold"
            fontFamily="system-ui,sans-serif"
          >
            Admin
          </text>
        </g>

        {/* ══ Admin has no visibility ══ */}
        <AdminNoVisibilityOverlay />

        {/* ══ Direct connection lines (laptops → servers) ══ */}
        <FleetDirectLines lineClassName="afb-line" />

        {/* ══ 3 Laptops ══ */}
        <Laptop y={5} agents={[CLAUDE]} />
        <Laptop y={105} agents={[CODEX]} />
        <Laptop y={205} agents={[CURSOR]} />

        {/* ══ 3 MCP servers ══ */}
        <McpServer
          x={560}
          y={25}
          iconSvg={GITHUB_SVG}
          iconViewBox="0 0 1024 1024"
        />
        <McpServer
          x={560}
          y={105}
          iconSvg={SLACK_SVG}
          iconViewBox="0 0 2447.6 2452.5"
        />
        <McpServer x={560} y={185} iconSvg={odSvg} iconViewBox="0 0 1000 615" />

        {/* ══ Packet: L2 ↔ S2 round trip ══ */}
        <g className="afb-pkt afb-pkt1">
          <McpPacket />
        </g>

        {/* ══ Progress bar ══ */}
        <ProgressBar y={275} width={640} className="afb-progress" />
      </svg>
    </div>
  );
}
