/**
 * Flexible Deployment Animation - CISO-facing docs animation.
 *
 * Side-by-side comparison of Self-Hosted vs SaaS deployment models.
 *
 * Left (Self-Hosted): Edison lives inside customer infrastructure
 *   boundary. Internal MCP traffic stays in-boundary. Only 3rd-party
 *   MCP calls cross the boundary as controlled egress.
 * Right (SaaS): Agents in customer env → Edison Cloud → fans out to
 *   3rd-party MCP servers AND internal MCP servers (everything proxied
 *   through Edison's cloud infrastructure).
 *
 * 12s loop. Pure SVG + CSS. Respects `prefers-reduced-motion`.
 *
 * Requires CSS custom properties: --text-primary, --accent, --text-muted.
 */
import { AGENT_REGISTRY } from '../../agent-registry/index'
import {
  AgentIcon,
  DANGER,
  EdisonLogo,
  McpIcon,
  McpPacket,
  ORANGE as O,
  ProgressBar,
  SHIELD_CHECK_PATH
} from '../_shared'

const CURSOR = AGENT_REGISTRY['cursor']
const CLAUDE_CODE = AGENT_REGISTRY['claude-code']

const SLACK_SVG =
  '<g clip-rule="evenodd" fill-rule="evenodd"><path d="m897.4 0c-135.3.1-244.8 109.9-244.7 245.2-.1 135.3 109.5 245.1 244.8 245.2h244.8v-245.1c.1-135.3-109.5-245.1-244.9-245.3.1 0 .1 0 0 0m0 654h-652.6c-135.3.1-244.9 109.9-244.8 245.2-.2 135.3 109.4 245.1 244.7 245.3h652.7c135.3-.1 244.9-109.9 244.8-245.2.1-135.4-109.5-245.2-244.8-245.3z" fill="#36c5f0"/><path d="m2447.6 899.2c.1-135.3-109.5-245.1-244.8-245.2-135.3.1-244.9 109.9-244.8 245.2v245.3h244.8c135.3-.1 244.9-109.9 244.8-245.3zm-652.7 0v-654c.1-135.2-109.4-245-244.7-245.2-135.3.1-244.9 109.9-244.8 245.2v654c-.2 135.3 109.4 245.1 244.7 245.3 135.3-.1 244.9-109.9 244.8-245.3z" fill="#2eb67d"/><path d="m1550.1 2452.5c135.3-.1 244.9-109.9 244.8-245.2.1-135.3-109.5-245.1-244.8-245.2h-244.8v245.2c-.1 135.2 109.5 245 244.8 245.2zm0-654.1h652.7c135.3-.1 244.9-109.9 244.8-245.2.2-135.3-109.4-245.1-244.7-245.3h-652.7c-135.3.1-244.9 109.9-244.8 245.2-.1 135.4 109.4 245.2 244.7 245.3z" fill="#ecb22e"/><path d="m0 1553.2c-.1 135.3 109.5 245.1 244.8 245.2 135.3-.1 244.9-109.9 244.8-245.2v-245.2h-244.8c-135.3.1-244.9 109.9-244.8 245.2zm652.7 0v654c-.2 135.3 109.4 245.1 244.7 245.3 135.3-.1 244.9-109.9 244.8-245.2v-653.9c.2-135.3-109.4-245.1-244.7-245.3-135.4 0-244.9 109.8-244.8 245.1 0 0 0 .1 0 0" fill="#e01e5a"/></g>'
const GITHUB_SVG =
  '<path fill-rule="evenodd" clip-rule="evenodd" d="M8 0C3.58 0 0 3.58 0 8C0 11.54 2.29 14.53 5.47 15.59C5.87 15.66 6.02 15.42 6.02 15.21C6.02 15.02 6.01 14.39 6.01 13.72C4 14.09 3.48 13.23 3.32 12.78C3.23 12.55 2.84 11.84 2.5 11.65C2.22 11.5 1.82 11.13 2.49 11.12C3.12 11.11 3.57 11.7 3.72 11.94C4.44 13.15 5.59 12.81 6.05 12.6C6.12 12.08 6.33 11.73 6.56 11.53C4.78 11.33 2.92 10.64 2.92 7.58C2.92 6.71 3.23 5.99 3.74 5.43C3.66 5.23 3.38 4.41 3.82 3.31C3.82 3.31 4.49 3.1 6.02 4.13C6.66 3.95 7.34 3.86 8.02 3.86C8.7 3.86 9.38 3.95 10.02 4.13C11.55 3.09 12.22 3.31 12.22 3.31C12.66 4.41 12.38 5.23 12.3 5.43C12.81 5.99 13.12 6.7 13.12 7.58C13.12 10.65 11.25 11.33 9.47 11.53C9.76 11.78 10.01 12.26 10.01 13.01C10.01 14.08 10 14.94 10 15.21C10 15.42 10.15 15.67 10.55 15.59C13.71 14.53 16 11.53 16 8C16 3.58 12.42 0 8 0Z" transform="scale(64)" fill="var(--text-primary)"/>'
const JIRA_SVG =
  '<path d="M11.571 11.513H0a5.218 5.218 0 0 0 5.232 5.215h2.13v2.057A5.215 5.215 0 0 0 12.575 24V12.518a1.005 1.005 0 0 0-1.005-1.005zm5.723-5.756H5.736a5.215 5.215 0 0 0 5.215 5.214h2.129v2.058a5.218 5.218 0 0 0 5.215 5.214V6.762a1.001 1.001 0 0 0-1.001-1.005zM23.013 0H11.455a5.215 5.215 0 0 0 5.215 5.215h2.129v2.057A5.215 5.215 0 0 0 24 12.483V1.005A1.001 1.001 0 0 0 23.013 0z" fill="#2684FF"/>'

/* Server icon path (Phosphor, viewBox 0 0 256 256) */
const SERVER_PATH =
  'M208,40H48A16,16,0,0,0,32,56v48a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V56A16,16,0,0,0,208,40Zm0,64H48V56H208v48Zm0,32H48a16,16,0,0,0-16,16v48a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V152A16,16,0,0,0,208,136Zm0,64H48V152H208v48ZM184,72a12,12,0,1,1-12-12A12,12,0,0,1,184,72Zm0,96a12,12,0,1,1-12-12A12,12,0,0,1,184,168Z'

/* Globe icon path (Phosphor, viewBox 0 0 256 256) */
const GLOBE_PATH =
  'M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm-8-136v48h16V80ZM104,64h48v8H104Z'

/* Database icon path (Phosphor, viewBox 0 0 256 256) */
const DATABASE_PATH =
  'M128,24C74.17,24,32,48.6,32,80v96c0,31.4,42.17,56,96,56s96-24.6,96-56V80C224,48.6,181.83,24,128,24Zm80,152c0,18.75-33.83,40-80,40s-80-21.25-80-40V132.22C66.69,145.73,94.94,152,128,152s61.31-6.27,80-19.78Zm0-96c0,18.75-33.83,40-80,40S48,98.75,48,80s33.83-40,80-40S208,61.25,208,80Z'

/* ──────────────────────────────────────────────────────────────────────
 * Animation timing / cycle: 12s
 *   0–8%    Fade in, both sides idle
 *   8–45%   Self-hosted side activates (left, packets inside boundary)
 *  45–50%   Crossfade emphasis
 *  50–88%   SaaS side activates (right, packets through Edison Cloud)
 *  88–95%   Both sides fully active
 *  95–100%  Reset
 * ────────────────────────────────────────────────────────────────────── */

const CSS = `
.fd { color: var(--text-primary); }

.fd .fd-line { stroke-dashoffset:0; animation: fd-lf 2s linear infinite; }
.fd .fd-pkt path, .fd .fd-pkt circle { fill: currentColor; }

/* divider */
.fd .fd-divider { stroke: var(--text-muted); stroke-opacity: 0.2; }

/* Self-hosted side activation (left, first) */
.fd .fd-sh-glow   { animation: fd-sh-glow 12s ease-in-out infinite; }
.fd .fd-sh-lines  { animation: fd-sh-lines 12s ease-in-out infinite; }
.fd .fd-sh-label  { animation: fd-sh-label 12s ease-in-out infinite; }
.fd .fd-sh-boundary { animation: fd-sh-boundary 12s ease-in-out infinite; }

/* SaaS side activation (right, second) */
.fd .fd-saas-glow   { animation: fd-saas-glow 12s ease-in-out infinite; }
.fd .fd-saas-lines  { animation: fd-saas-lines 12s ease-in-out infinite; }

/* Edison pulse rings */
.fd .fd-pulse-sh   { transform-origin:170px 138px; animation: fd-pulse 1.4s cubic-bezier(.2,.8,.4,1) infinite; }
.fd .fd-pulse-saas { transform-origin:555px 165px; animation: fd-pulse 1.4s cubic-bezier(.2,.8,.4,1) infinite; }

/* packets */
.fd .fd-pkt-h1 { color:var(--accent); animation: fd-pkt-h1 12s ease-in-out infinite; }
.fd .fd-pkt-h2 { color:var(--accent); animation: fd-pkt-h2 12s ease-in-out infinite; }
.fd .fd-pkt-h3 { color:var(--accent); animation: fd-pkt-h3 12s ease-in-out infinite; }
.fd .fd-pkt-h4 { color:${O}; animation: fd-pkt-h4 12s ease-in-out infinite; }
.fd .fd-pkt-s1 { color:${O}; animation: fd-pkt-s1 12s ease-in-out infinite; }
.fd .fd-pkt-s2 { color:${O}; animation: fd-pkt-s2 12s ease-in-out infinite; }

/* verdict badges */
.fd .fd-v-h1 { animation: fd-v-h1 12s ease-in-out infinite; }
.fd .fd-v-deny { animation: fd-v-deny 12s ease-in-out infinite; }
.fd .fd-v-s1 { animation: fd-v-s1 12s ease-in-out infinite; }
.fd .fd-v-s2 { animation: fd-v-s2 12s ease-in-out infinite; }

/* ── keyframes ── */
@keyframes fd-lf { to { stroke-dashoffset: -12; } }

@keyframes fd-pulse {
  0%   { transform:scale(1);   opacity:0; }
  10%  { transform:scale(1);   opacity:.35; }
  60%  { transform:scale(1.5); opacity:0; }
  100% { transform:scale(1.5); opacity:0; }
}

/* Self-hosted side glows first */
@keyframes fd-sh-glow {
  0%,6%   { opacity:0.15; }
  12%     { opacity:1; }
  88%     { opacity:1; }
  95%     { opacity:0.15; }
  100%    { opacity:0.15; }
}
@keyframes fd-sh-lines {
  0%,6%   { opacity:0; }
  12%     { opacity:1; }
  88%     { opacity:1; }
  95%     { opacity:0; }
  100%    { opacity:0; }
}
@keyframes fd-sh-label {
  0%,8%   { opacity:0; }
  14%     { opacity:1; }
  88%     { opacity:1; }
  95%     { opacity:0; }
  100%    { opacity:0; }
}
@keyframes fd-sh-boundary {
  0%,6%   { stroke-opacity:0.15; }
  12%     { stroke-opacity:0.6; }
  88%     { stroke-opacity:0.6; }
  95%     { stroke-opacity:0.15; }
  100%    { stroke-opacity:0.15; }
}

/* SaaS side glows second */
@keyframes fd-saas-glow {
  0%,44%  { opacity:0.15; }
  52%     { opacity:1; }
  88%     { opacity:1; }
  95%     { opacity:0.15; }
  100%    { opacity:0.15; }
}
@keyframes fd-saas-lines {
  0%,44%  { opacity:0; }
  52%     { opacity:1; }
  88%     { opacity:1; }
  95%     { opacity:0; }
  100%    { opacity:0; }
}

/* Self-hosted packets (left, first): laptops → Edison → internal MCP / egress */
@keyframes fd-pkt-h1 {
  0%,13%  { opacity:0; }
  14%     { transform:translate(79px,108px);  opacity:.8; color:var(--accent); }
  20%     { transform:translate(145px,125px); opacity:1;  color:var(--accent); }
  22%     { transform:translate(170px,138px); opacity:.3; color:var(--accent); }
  24%     { transform:translate(170px,138px); opacity:1;  color:var(--accent); }
  30%     { transform:translate(235px,195px); opacity:1;  color:var(--accent); }
  31%     { opacity:0; }
  32%,100%{ opacity:0; }
}
@keyframes fd-pkt-h2 {
  0%,23%  { opacity:0; }
  24%     { transform:translate(159px,108px); opacity:.8; color:var(--accent); }
  30%     { transform:translate(160px,125px); opacity:1;  color:var(--accent); }
  32%     { transform:translate(170px,138px); opacity:.3; color:var(--accent); }
  34%     { transform:translate(170px,138px); opacity:1;  color:var(--accent); }
  42%     { transform:translate(115px,280px); opacity:1;  color:var(--accent); }
  43%     { opacity:0; }
  44%,100%{ opacity:0; }
}
@keyframes fd-pkt-h3 {
  0%,33%  { opacity:0; }
  34%     { transform:translate(79px,108px);  opacity:.8; color:var(--accent); }
  39%     { transform:translate(145px,125px); opacity:1;  color:var(--accent); }
  40%     { transform:translate(170px,138px); opacity:.3; color:var(--accent); }
  41%     { transform:translate(170px,138px); opacity:1;  color:var(--accent); }
  47%     { transform:translate(235px,195px); opacity:1;  color:var(--accent); }
  48%     { opacity:0; }
  49%,100%{ opacity:0; }
}
/* Denied packet: laptop → Edison, stopped at egress and flashes red */
@keyframes fd-pkt-h4 {
  0%,38%  { opacity:0; }
  39%     { transform:translate(159px,108px); opacity:.8; color:${O}; }
  43%     { transform:translate(160px,138px); opacity:1;  color:${O}; }
  44%     { transform:translate(155px,180px); opacity:.6; color:${DANGER}; }
  47%     { transform:translate(155px,180px); opacity:0;  color:${DANGER}; }
  48%,100%{ opacity:0; }
}

/* SaaS packets (right, second): laptops → Edison Cloud → 3rd-party MCP */
@keyframes fd-pkt-s1 {
  0%,53%  { opacity:0; }
  54%     { transform:translate(484px,93px);  opacity:.8; color:${O}; }
  60%     { transform:translate(535px,145px); opacity:1;  color:${O}; }
  61%     { transform:translate(555px,165px); opacity:.3; color:var(--accent); }
  62%     { transform:translate(565px,165px); opacity:1;  color:var(--accent); }
  70%     { transform:translate(500px,275px); opacity:1;  color:var(--accent); }
  71%     { opacity:0; }
  72%,100%{ opacity:0; }
}
@keyframes fd-pkt-s2 {
  0%,65%  { opacity:0; }
  66%     { transform:translate(582px,93px);  opacity:.8; color:${O}; }
  72%     { transform:translate(565px,150px); opacity:1;  color:${O}; }
  73%     { transform:translate(555px,165px); opacity:.3; color:var(--accent); }
  74%     { transform:translate(565px,165px); opacity:1;  color:var(--accent); }
  82%     { transform:translate(600px,275px); opacity:1;  color:var(--accent); }
  83%     { opacity:0; }
  84%,100%{ opacity:0; }
}

/* verdict badges */
@keyframes fd-v-h1 { 0%,29% { opacity:0; transform:scale(.5); } 31% { opacity:1; transform:scale(1); } 88% { opacity:1; } 95%,100% { opacity:0; transform:scale(.5); } }
@keyframes fd-v-deny { 0%,43% { opacity:0; transform:scale(.5); } 45% { opacity:1; transform:scale(1); } 88% { opacity:1; } 95%,100% { opacity:0; transform:scale(.5); } }
@keyframes fd-v-s1 { 0%,69% { opacity:0; transform:scale(.5); } 71% { opacity:1; transform:scale(1); } 88% { opacity:1; } 95%,100% { opacity:0; transform:scale(.5); } }
@keyframes fd-v-s2 { 0%,81% { opacity:0; transform:scale(.5); } 83% { opacity:1; transform:scale(1); } 88% { opacity:1; } 95%,100% { opacity:0; transform:scale(.5); } }

/* progress */
.fd .fd-progress { transform-origin:20px 345px; animation: fd-prog 12s linear infinite; }
@keyframes fd-prog {
  0%   { transform:scaleX(0); }
  100% { transform:scaleX(1); }
}

@media (prefers-reduced-motion:reduce) {
  .fd .fd-line, .fd .fd-pulse-sh, .fd .fd-pulse-saas,
  .fd .fd-sh-glow, .fd .fd-sh-lines, .fd .fd-sh-label, .fd .fd-sh-boundary,
  .fd .fd-saas-glow, .fd .fd-saas-lines,
  .fd .fd-pkt-h1, .fd .fd-pkt-h2, .fd .fd-pkt-h3, .fd .fd-pkt-h4,
  .fd .fd-pkt-s1, .fd .fd-pkt-s2,
  .fd .fd-v-h1, .fd .fd-v-deny, .fd .fd-v-s1, .fd .fd-v-s2 { animation:none; }
  .fd .fd-pkt-h1, .fd .fd-pkt-h2, .fd .fd-pkt-h3, .fd .fd-pkt-h4,
  .fd .fd-pkt-s1, .fd .fd-pkt-s2 { opacity:0; }
  .fd .fd-progress { animation:none; transform:scaleX(1); }
  .fd .fd-sh-glow, .fd .fd-saas-glow { opacity:1; }
  .fd .fd-sh-lines, .fd .fd-saas-lines { opacity:1; }
  .fd .fd-sh-label { opacity:1; }
  .fd .fd-sh-boundary { stroke-opacity:0.6; }
  .fd .fd-v-h1, .fd .fd-v-deny, .fd .fd-v-s1, .fd .fd-v-s2 { opacity:1; transform:scale(1); }
}
`

function ToolBox({
  x,
  y,
  iconSvg,
  iconViewBox
}: {
  x: number
  y: number
  iconSvg?: string
  iconViewBox?: string
}): React.ReactNode {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={48}
        height={38}
        rx={6}
        fill="var(--text-primary)"
        fillOpacity="0.03"
        stroke="var(--text-muted)"
        strokeOpacity="0.3"
        strokeWidth="1"
      />
      {iconSvg ? (
        <svg
          x={x + 4}
          y={y + 7}
          width={22}
          height={22}
          viewBox={iconViewBox || '0 0 24 24'}
          dangerouslySetInnerHTML={{ __html: iconSvg }}
        />
      ) : null}
      <McpIcon x={x + 28} y={y + 9} size={16} color="var(--text-muted)" opacity="0.45" />
    </g>
  )
}

export default function FlexibleDeploymentAnimation(): React.ReactNode {
  return (
    <div className="flex justify-center">
      <style>{CSS}</style>
      <svg
        className="fd"
        width={740}
        height={350}
        viewBox="0 0 740 350"
        xmlns="http://www.w3.org/2000/svg"
        role="presentation"
        aria-hidden="true"
      >
        {/* ══════════════════════════════════════════════════════════
         *  Section headers
         * ══════════════════════════════════════════════════════════ */}
        <text
          x="175"
          y="18"
          textAnchor="middle"
          fill="var(--text-primary)"
          fontSize="11"
          fontWeight="bold"
          fontFamily="system-ui,sans-serif"
        >
          Self-Hosted
        </text>
        <text
          x="555"
          y="18"
          textAnchor="middle"
          fill="var(--text-primary)"
          fontSize="11"
          fontWeight="bold"
          fontFamily="system-ui,sans-serif"
        >
          SaaS
        </text>

        {/* Vertical divider */}
        <line
          className="fd-divider"
          x1="370"
          y1="8"
          x2="370"
          y2="338"
          strokeWidth="1"
          strokeDasharray="4 4"
        />

        {/* ══════════════════════════════════════════════════════════
         *  LEFT SIDE: Self-Hosted
         * ══════════════════════════════════════════════════════════ */}

        {/* ── Your Infrastructure boundary ── */}
        <rect
          className="fd-sh-boundary"
          x={20}
          y={38}
          width={320}
          height={220}
          rx={10}
          fill="var(--accent)"
          fillOpacity="0.02"
          stroke="var(--accent)"
          strokeWidth="1.5"
          strokeDasharray="6 3"
        />
        <text
          x={30}
          y={53}
          fill="var(--accent)"
          fillOpacity="0.6"
          fontSize="7.5"
          fontFamily="system-ui,sans-serif"
          fontWeight="bold"
        >
          Your Infrastructure
        </text>

        {/* ── Employee laptops inside boundary ── */}
        <g className="fd-sh-glow">
          {/* Laptop 1 */}
          <rect
            x={50}
            y={62}
            width={58}
            height={42}
            rx={5}
            fill="var(--text-primary)"
            fillOpacity="0.03"
            stroke="var(--text-muted)"
            strokeOpacity="0.35"
            strokeWidth="1.5"
          />
          <rect
            x={46}
            y={106}
            width={66}
            height={5}
            rx={2.5}
            fill="var(--text-primary)"
            fillOpacity="0.04"
            stroke="var(--text-muted)"
            strokeOpacity="0.35"
            strokeWidth="1"
          />
          <AgentIcon agent={CLAUDE_CODE} x={61} y={68} size={18} />
          <McpIcon x={64} y={90} size={11} color="var(--text-muted)" opacity="0.4" />
          {/* Laptop 2 */}
          <rect
            x={130}
            y={62}
            width={58}
            height={42}
            rx={5}
            fill="var(--text-primary)"
            fillOpacity="0.03"
            stroke="var(--text-muted)"
            strokeOpacity="0.35"
            strokeWidth="1.5"
          />
          <rect
            x={126}
            y={106}
            width={66}
            height={5}
            rx={2.5}
            fill="var(--text-primary)"
            fillOpacity="0.04"
            stroke="var(--text-muted)"
            strokeOpacity="0.35"
            strokeWidth="1"
          />
          <AgentIcon agent={CURSOR} x={141} y={68} size={18} />
          <McpIcon x={144} y={90} size={11} color="var(--text-muted)" opacity="0.4" />
        </g>

        {/* ── Edison On-Prem inside boundary ── */}
        <g className="fd-sh-glow">
          <rect
            x={115}
            y={118}
            width={110}
            height={68}
            rx={8}
            fill="var(--accent)"
            fillOpacity="0.03"
            stroke="var(--accent)"
            strokeOpacity="0.35"
            strokeWidth="1.2"
          />
          <EdisonLogo x={145} y={120} w={44} h={43} />
          <circle
            className="fd-pulse-sh"
            cx="170"
            cy="138"
            r="18"
            fill="none"
            stroke="var(--accent)"
            strokeOpacity="0.4"
            strokeWidth="1.2"
          />
          <text
            x={170}
            y={178}
            fill="var(--accent)"
            fillOpacity="0.7"
            fontSize="7"
            textAnchor="middle"
            fontFamily="system-ui,sans-serif"
            fontWeight="bold"
          >
            Edison On-Prem
          </text>
        </g>

        {/* ── Internal MCP servers (inside boundary) ── */}
        <g className="fd-sh-glow">
          <rect
            x={195}
            y={185}
            width={115}
            height={55}
            rx={6}
            fill="var(--text-primary)"
            fillOpacity="0.02"
            stroke="var(--text-muted)"
            strokeOpacity="0.2"
            strokeWidth="1"
          />
          <text
            x={205}
            y={198}
            fill="var(--text-primary)"
            fillOpacity="0.5"
            fontSize="6.5"
            fontFamily="system-ui,sans-serif"
            fontWeight="bold"
          >
            Internal MCP
          </text>
          {/* DB + MCP icon */}
          <svg x={205} y={204} width={16} height={16} viewBox="0 0 256 256">
            <path d={DATABASE_PATH} fill="var(--text-muted)" fillOpacity="0.5" />
          </svg>
          <McpIcon x={223} y={205} size={13} color="var(--text-muted)" opacity="0.4" />
          {/* Server + MCP icon */}
          <svg x={250} y={204} width={16} height={16} viewBox="0 0 256 256">
            <path d={SERVER_PATH} fill="var(--text-muted)" fillOpacity="0.5" />
          </svg>
          <McpIcon x={268} y={205} size={13} color="var(--text-muted)" opacity="0.4" />
          {/* Wiki + MCP icon */}
          <svg x={290} y={204} width={16} height={16} viewBox="0 0 256 256">
            <path d={GLOBE_PATH} fill="var(--text-muted)" fillOpacity="0.5" />
          </svg>
        </g>

        {/* ── Connection lines inside boundary ── */}
        <g className="fd-sh-lines">
          {/* laptops → Edison */}
          <line
            className="fd-line"
            x1="79"
            y1="111"
            x2="145"
            y2="130"
            stroke="var(--text-muted)"
            strokeOpacity="0.4"
            strokeWidth="1.2"
            strokeDasharray="3 3"
          />
          <line
            className="fd-line"
            x1="159"
            y1="111"
            x2="160"
            y2="130"
            stroke="var(--text-muted)"
            strokeOpacity="0.4"
            strokeWidth="1.2"
            strokeDasharray="3 3"
          />
          {/* Edison → internal MCP */}
          <line
            className="fd-line"
            x1="195"
            y1="165"
            x2="235"
            y2="185"
            stroke="var(--accent)"
            strokeOpacity="0.4"
            strokeWidth="1.2"
            strokeDasharray="3 3"
          />
        </g>

        {/* ── Controlled egress line (crosses boundary) ── */}
        <g className="fd-sh-lines">
          <line
            className="fd-line"
            x1="150"
            y1="175"
            x2="115"
            y2="280"
            stroke="var(--accent)"
            strokeOpacity="0.35"
            strokeWidth="1.2"
            strokeDasharray="3 3"
          />
          {/* egress label */}
          <text
            x={85}
            y={235}
            fill="var(--accent)"
            fillOpacity="0.6"
            fontSize="6.5"
            fontFamily="system-ui,sans-serif"
            fontWeight="bold"
            transform="rotate(-68, 85, 235)"
          >
            controlled egress
          </text>
        </g>

        {/* Self-hosted verdict badge - right of Edison box */}
        <g className="fd-v-h1" style={{ transformOrigin: '233px 135px' }}>
          <circle
            cx="233"
            cy="135"
            r="7"
            fill="var(--accent)"
            fillOpacity="0.12"
            stroke="var(--accent)"
            strokeOpacity="0.5"
            strokeWidth="1"
          />
          <svg x={226.5} y={128.5} width={13} height={13} viewBox="0 0 256 256">
            <path d={SHIELD_CHECK_PATH} fill="var(--accent)" fillOpacity="0.8" />
          </svg>
        </g>

        {/* ── 3rd-party MCP servers (outside boundary, self-hosted side) ── */}
        <g className="fd-sh-glow">
          <ToolBox x={60} y={275} iconSvg={SLACK_SVG} iconViewBox="0 0 2447.6 2452.5" />
          <ToolBox x={130} y={275} iconSvg={GITHUB_SVG} iconViewBox="0 0 1024 1024" />
          <text
            x={200}
            y={300}
            fill="var(--text-muted)"
            fontSize="18"
            fillOpacity="0.35"
            fontFamily="system-ui,sans-serif"
          >
            ···
          </text>
        </g>

        {/* Self-hosted caption */}
        <text
          className="fd-sh-label"
          x="175"
          y="340"
          textAnchor="middle"
          fill="var(--accent)"
          fillOpacity="0.75"
          fontSize="7.5"
          fontWeight="bold"
          fontFamily="system-ui,sans-serif"
        >
          Data never leaves your infrastructure
        </text>

        {/* Denied verdict badge (red X) below Edison on self-hosted side */}
        <g className="fd-v-deny" style={{ transformOrigin: '155px 185px' }}>
          <circle
            cx="155"
            cy="185"
            r="7"
            fill={DANGER}
            fillOpacity="0.12"
            stroke={DANGER}
            strokeOpacity="0.5"
            strokeWidth="1"
          />
          <line
            x1="151.5"
            y1="181.5"
            x2="158.5"
            y2="188.5"
            stroke={DANGER}
            strokeWidth="1.4"
            strokeLinecap="round"
          />
          <line
            x1="158.5"
            y1="181.5"
            x2="151.5"
            y2="188.5"
            stroke={DANGER}
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </g>

        {/* ══════════════════════════════════════════════════════════
         *  RIGHT SIDE: SaaS
         * ══════════════════════════════════════════════════════════ */}

        {/* ── Your Environment (employee laptops) ── */}
        <g className="fd-saas-glow">
          <text
            x={540}
            y={35}
            fill="var(--text-primary)"
            fillOpacity="0.6"
            fontSize="7.5"
            textAnchor="middle"
            fontFamily="system-ui,sans-serif"
            fontWeight="bold"
          >
            Your Environment
          </text>
          {/* Laptop 1 */}
          <rect
            x={450}
            y={42}
            width={68}
            height={48}
            rx={5}
            fill="var(--text-primary)"
            fillOpacity="0.03"
            stroke="var(--text-muted)"
            strokeOpacity="0.35"
            strokeWidth="1.5"
          />
          <rect
            x={446}
            y={92}
            width={76}
            height={5}
            rx={2.5}
            fill="var(--text-primary)"
            fillOpacity="0.04"
            stroke="var(--text-muted)"
            strokeOpacity="0.35"
            strokeWidth="1"
          />
          <AgentIcon agent={CLAUDE_CODE} x={464} y={50} size={20} />
          <McpIcon x={468} y={74} size={12} color="var(--text-muted)" opacity="0.4" />
          {/* Laptop 2 */}
          <rect
            x={548}
            y={42}
            width={68}
            height={48}
            rx={5}
            fill="var(--text-primary)"
            fillOpacity="0.03"
            stroke="var(--text-muted)"
            strokeOpacity="0.35"
            strokeWidth="1.5"
          />
          <rect
            x={544}
            y={92}
            width={76}
            height={5}
            rx={2.5}
            fill="var(--text-primary)"
            fillOpacity="0.04"
            stroke="var(--text-muted)"
            strokeOpacity="0.35"
            strokeWidth="1"
          />
          <AgentIcon agent={CURSOR} x={562} y={50} size={20} />
          <McpIcon x={566} y={74} size={12} color="var(--text-muted)" opacity="0.4" />
        </g>

        {/* ── Edison Cloud box ── */}
        <g className="fd-saas-glow">
          <rect
            x={490}
            y={138}
            width={130}
            height={85}
            rx={8}
            fill="var(--accent)"
            fillOpacity="0.03"
            stroke="var(--accent)"
            strokeOpacity="0.35"
            strokeWidth="1.2"
          />
          <EdisonLogo x={528} y={144} w={54} h={52.5} />
          <circle
            className="fd-pulse-saas"
            cx="555"
            cy="165"
            r="22"
            fill="none"
            stroke="var(--accent)"
            strokeOpacity="0.4"
            strokeWidth="1.2"
          />
          <text
            x={555}
            y={212}
            fill="var(--accent)"
            fillOpacity="0.7"
            fontSize="7.5"
            textAnchor="middle"
            fontFamily="system-ui,sans-serif"
            fontWeight="bold"
          >
            Edison Cloud
          </text>
        </g>

        {/* ── Connection lines: laptops → Edison Cloud ── */}
        <g className="fd-saas-lines">
          <line
            className="fd-line"
            x1="484"
            y1="97"
            x2="535"
            y2="142"
            stroke="var(--text-muted)"
            strokeOpacity="0.4"
            strokeWidth="1.2"
            strokeDasharray="3 3"
          />
          <line
            className="fd-line"
            x1="582"
            y1="97"
            x2="565"
            y2="142"
            stroke="var(--text-muted)"
            strokeOpacity="0.4"
            strokeWidth="1.2"
            strokeDasharray="3 3"
          />
        </g>

        {/* ── Connection lines: Edison Cloud → 3rd-party MCP ── */}
        <g className="fd-saas-lines">
          <line
            className="fd-line"
            x1="525"
            y1="223"
            x2="500"
            y2="260"
            stroke="var(--accent)"
            strokeOpacity="0.4"
            strokeWidth="1.2"
            strokeDasharray="3 3"
          />
          <line
            className="fd-line"
            x1="575"
            y1="223"
            x2="600"
            y2="260"
            stroke="var(--accent)"
            strokeOpacity="0.4"
            strokeWidth="1.2"
            strokeDasharray="3 3"
          />
        </g>

        {/* ── 3rd-party MCP servers (SaaS side) ── */}
        <g className="fd-saas-glow">
          <ToolBox x={455} y={260} iconSvg={SLACK_SVG} iconViewBox="0 0 2447.6 2452.5" />
          <ToolBox x={525} y={260} iconSvg={GITHUB_SVG} iconViewBox="0 0 1024 1024" />
          <ToolBox x={595} y={260} iconSvg={JIRA_SVG} iconViewBox="0 0 24 24" />
          <text
            x={665}
            y={285}
            fill="var(--text-muted)"
            fontSize="18"
            fillOpacity="0.35"
            fontFamily="system-ui,sans-serif"
          >
            ···
          </text>
        </g>

        {/* SaaS verdict badges */}
        <g className="fd-v-s1" style={{ transformOrigin: '508px 228px' }}>
          <circle
            cx="508"
            cy="228"
            r="7"
            fill="var(--accent)"
            fillOpacity="0.12"
            stroke="var(--accent)"
            strokeOpacity="0.5"
            strokeWidth="1"
          />
          <polyline
            points="504,228 506.5,230.5 512,224"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
        <g className="fd-v-s2" style={{ transformOrigin: '598px 228px' }}>
          <circle
            cx="598"
            cy="228"
            r="7"
            fill="var(--accent)"
            fillOpacity="0.12"
            stroke="var(--accent)"
            strokeOpacity="0.5"
            strokeWidth="1"
          />
          <polyline
            points="594,228 596.5,230.5 602,224"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>

        {/* ══ Packets ══ */}
        <g className="fd-pkt fd-pkt-s1">
          <McpPacket />
        </g>
        <g className="fd-pkt fd-pkt-s2">
          <McpPacket />
        </g>
        <g className="fd-pkt fd-pkt-h1">
          <McpPacket />
        </g>
        <g className="fd-pkt fd-pkt-h2">
          <McpPacket />
        </g>
        <g className="fd-pkt fd-pkt-h3">
          <McpPacket />
        </g>
        <g className="fd-pkt fd-pkt-h4">
          <McpPacket />
        </g>

        {/* ══ Progress bar ══ */}
        <ProgressBar y={345} width={700} className="fd-progress" />
      </svg>
    </div>
  )
}
