/**
 * Code Mode Security animation.
 *
 * Visualises the three defence layers protecting MCP-as-code execution:
 *   1. AST analysis  - dangerous TypeScript (eval, dynamic import) is rejected.
 *   2. Deno sandbox  - validated code runs with no network / fs-write and
 *                      strict resource limits while it calls MCP tools.
 *   3. Taint-aware   - per-variable tracking; only data that never touched
 *                      untrusted sources is allowed back to the agent.
 *
 * Five phases (12s loop):
 *   0-15%   Agent IDE composes a TypeScript snippet (lines populate)
 *   15-25%  Code packet flies into the Edison sandbox (orange → accent)
 *   25-35%  AST scan beam sweeps the code; `eval(` rejected, others pass
 *   35-72%  Deno runtime executes; three MCP request/response round-trips,
 *           variables receive taint dots (green = safe, red = tainted)
 *   72-92%  Trifecta verdict: tainted output blocked at the boundary,
 *           safe result returns to the agent in accent colour
 *
 * Pure SVG + CSS. Respects `prefers-reduced-motion`.
 *
 * Requires CSS custom properties: --text-primary, --accent, --text-muted.
 */

import { useId } from 'react'
import { AGENT_REGISTRY } from '../agent-registry'
import {
  AgentIcon, EdisonLogo, McpIcon, McpPacket, ORANGE as O,
  ProgressBar, RED as R,
} from './_shared'

const SAFE = '#3ddc84'

const CLAUDE = AGENT_REGISTRY['claude-code']
const CURSOR = AGENT_REGISTRY['cursor']

const SHIELD_PATH =
  'M208,40H48A16,16,0,0,0,32,56v56c0,52.72,25.52,84.67,46.93,102.19,23.06,18.86,46,25.26,47,25.53a8,8,0,0,0,4.2,0c1-.27,23.91-6.67,47-25.53C198.48,196.67,224,164.72,224,112V56A16,16,0,0,0,208,40Zm0,72c0,37.07-13.66,67.16-40.6,89.42A129.3,129.3,0,0,1,128,223.62a128.25,128.25,0,0,1-38.92-21.81C61.82,179.51,48,149.3,48,112l0-56,160,0Z'

const CHECK_PATH =
  'M232.49,80.49l-128,128a12,12,0,0,1-17,0l-56-56a12,12,0,1,1,17-17L96,183,215.51,63.51a12,12,0,0,1,17,17Z'

const X_PATH =
  'M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z'

const CSS = `
.cms { color: var(--text-primary); }

/* dashed-line flow */
.cms .cms-line { stroke-dashoffset: 0; animation: cms-lf 2s linear infinite; }
.cms .cms-pkt path, .cms .cms-pkt circle { fill: currentColor; }

/* code editor lines populate */
.cms .cms-code1 { animation: cms-code1 12s ease-in-out infinite; }
.cms .cms-code2 { animation: cms-code2 12s ease-in-out infinite; }
.cms .cms-code3 { animation: cms-code3 12s ease-in-out infinite; }
.cms .cms-code4 { animation: cms-code4 12s ease-in-out infinite; }

/* code packet: laptop -> Edison */
.cms .cms-submit { color:${O}; animation: cms-submit 12s ease-in-out infinite; }

/* AST scan beam */
.cms .cms-beam { animation: cms-beam 12s ease-in-out infinite; transform-origin: 235px 30px; }

/* AST verdicts */
.cms .cms-ast-ok    { animation: cms-ast-ok 12s ease-in-out infinite; transform-origin: 230px 28px; }
.cms .cms-ast-bad   { animation: cms-ast-bad 12s ease-in-out infinite; transform-origin: 295px 60px; }
.cms .cms-bad-flash { animation: cms-bad-flash 12s ease-in-out infinite; }

/* sandbox container */
.cms .cms-box       { animation: cms-box 12s ease-in-out infinite; }
.cms .cms-deno      { animation: cms-deno 12s ease-in-out infinite; }

/* MCP round-trips */
.cms .cms-pkt-a { color: var(--accent); animation: cms-pkt-a 12s ease-in-out infinite; }
.cms .cms-pkt-b { color: var(--accent); animation: cms-pkt-b 12s ease-in-out infinite; }
.cms .cms-pkt-c { color: var(--accent); animation: cms-pkt-c 12s ease-in-out infinite; }

/* taint dots on variables */
.cms .cms-var-a   { animation: cms-var-a 12s ease-in-out infinite; }
.cms .cms-var-b   { animation: cms-var-b 12s ease-in-out infinite; }
.cms .cms-var-c   { animation: cms-var-c 12s ease-in-out infinite; }

/* trifecta verdict + return packet */
.cms .cms-block      { animation: cms-block 12s ease-in-out infinite; transform-origin: 320px 138px; }
.cms .cms-block-flash{ animation: cms-block-flash 12s ease-in-out infinite; }
.cms .cms-return     { color: var(--accent); animation: cms-return 12s ease-in-out infinite; }
.cms .cms-result     { animation: cms-result 12s ease-in-out infinite; }

/* sandbox pulse ring */
.cms .cms-pulse-wrap { animation: cms-pulse-vis 12s ease-in-out infinite; }
.cms .cms-pulse      { transform-origin: 270px 95px; animation: cms-pulse 1.5s cubic-bezier(.2,.8,.4,1) infinite; }

.cms .cms-progress { transform-origin: 20px 198px; animation: cms-prog 12s linear infinite; }

/* ----- keyframes ----- */
@keyframes cms-lf { to { stroke-dashoffset: -12; } }

@keyframes cms-code1 {
  0%,2%   { opacity: 0; }
  4%      { opacity: 1; }
  92%     { opacity: 1; }
  96%,100%{ opacity: 0; }
}
@keyframes cms-code2 {
  0%,5%   { opacity: 0; }
  8%      { opacity: 1; }
  92%     { opacity: 1; }
  96%,100%{ opacity: 0; }
}
@keyframes cms-code3 {
  0%,8%   { opacity: 0; }
  11%     { opacity: 1; }
  92%     { opacity: 1; }
  96%,100%{ opacity: 0; }
}
@keyframes cms-code4 {
  0%,11%  { opacity: 0; }
  14%     { opacity: 1; }
  92%     { opacity: 1; }
  96%,100%{ opacity: 0; }
}

/* code packet: laptop editor -> sandbox AST area */
@keyframes cms-submit {
  0%,15%  { transform: translate(80px, 70px); opacity: 0; }
  17%     { transform: translate(80px, 70px); opacity: .8; }
  23%     { transform: translate(180px, 50px); opacity: 1; }
  25%     { transform: translate(180px, 50px); opacity: 0; }
  100%    { transform: translate(180px, 50px); opacity: 0; }
}

/* sandbox container fades in once code arrives */
@keyframes cms-box {
  0%,15%  { opacity: 0; }
  22%     { opacity: 1; }
  92%     { opacity: 1; }
  96%,100%{ opacity: 0; }
}

/* AST scan beam sweeps top of sandbox */
@keyframes cms-beam {
  0%,22%  { opacity: 0; transform: scaleY(0.2); }
  26%     { opacity: 0.6; transform: scaleY(1); }
  33%     { opacity: 0.6; transform: scaleY(1); }
  37%     { opacity: 0; transform: scaleY(1); }
  100%    { opacity: 0; }
}

@keyframes cms-ast-ok {
  0%,30%  { opacity: 0; transform: scale(.4); }
  34%     { opacity: 1; transform: scale(1); }
  92%     { opacity: 1; transform: scale(1); }
  96%,100%{ opacity: 0; transform: scale(1); }
}

@keyframes cms-ast-bad {
  0%,28%  { opacity: 0; transform: scale(.4); }
  31%     { opacity: 1; transform: scale(1.1); }
  35%     { opacity: 1; transform: scale(1); }
  44%     { opacity: 1; transform: scale(1); }
  48%     { opacity: 0; transform: scale(1); }
  100%    { opacity: 0; }
}

@keyframes cms-bad-flash {
  0%,28%  { fill-opacity: 0.05; stroke-opacity: 0.18; }
  31%     { fill-opacity: 0.30; stroke-opacity: 0.85; }
  38%     { fill-opacity: 0.10; stroke-opacity: 0.5; }
  46%     { fill-opacity: 0.05; stroke-opacity: 0.18; }
  100%    { fill-opacity: 0.05; stroke-opacity: 0.18; }
}

/* Deno runtime activates after AST passes */
@keyframes cms-deno {
  0%,32%  { opacity: 0; }
  36%     { opacity: 1; }
  92%     { opacity: 1; }
  96%,100%{ opacity: 0; }
}


/* 3 MCP round-trips during execution */
@keyframes cms-pkt-a {
  0%,38%  { transform: translate(360px, 70px); opacity: 0; }
  40%     { transform: translate(360px, 70px); opacity: .9; }
  46%     { transform: translate(488px, 35px); opacity: 1; }
  47%     { transform: translate(488px, 35px); opacity: .5; }
  49%     { transform: translate(488px, 35px); opacity: .9; }
  55%     { transform: translate(360px, 70px); opacity: 1; }
  57%     { transform: translate(360px, 70px); opacity: 0; }
  100%    { opacity: 0; }
}
@keyframes cms-pkt-b {
  0%,46%  { transform: translate(360px, 95px); opacity: 0; }
  48%     { transform: translate(360px, 95px); opacity: .9; }
  54%     { transform: translate(488px, 95px); opacity: 1; }
  55%     { transform: translate(488px, 95px); opacity: .5; }
  57%     { transform: translate(488px, 95px); opacity: .9; }
  63%     { transform: translate(360px, 95px); opacity: 1; }
  65%     { transform: translate(360px, 95px); opacity: 0; }
  100%    { opacity: 0; }
}
@keyframes cms-pkt-c {
  0%,54%  { transform: translate(360px, 120px); opacity: 0; }
  56%     { transform: translate(360px, 120px); opacity: .9; }
  62%     { transform: translate(488px, 155px); opacity: 1; }
  63%     { transform: translate(488px, 155px); opacity: .5; }
  65%     { transform: translate(488px, 155px); opacity: .9; }
  71%     { transform: translate(360px, 120px); opacity: 1; }
  73%     { transform: translate(360px, 120px); opacity: 0; }
  100%    { opacity: 0; }
}

/* taint dots populate after each MCP returns */
@keyframes cms-var-a {
  0%,55%  { opacity: 0; }
  57%     { opacity: 1; }
  92%     { opacity: 1; }
  96%,100%{ opacity: 0; }
}
@keyframes cms-var-b {
  0%,63%  { opacity: 0; }
  65%     { opacity: 1; }
  92%     { opacity: 1; }
  96%,100%{ opacity: 0; }
}
@keyframes cms-var-c {
  0%,71%  { opacity: 0; }
  73%     { opacity: 1; }
  92%     { opacity: 1; }
  96%,100%{ opacity: 0; }
}

/* trifecta block X over tainted variable */
@keyframes cms-block {
  0%,76%  { opacity: 0; transform: scale(.4); }
  80%     { opacity: 1; transform: scale(1.1); }
  84%     { opacity: 1; transform: scale(1); }
  92%     { opacity: 1; transform: scale(1); }
  96%,100%{ opacity: 0; transform: scale(1); }
}

@keyframes cms-block-flash {
  0%,76%  { fill-opacity: 0; }
  80%     { fill-opacity: 0.18; }
  86%     { fill-opacity: 0.04; }
  92%,100%{ fill-opacity: 0; }
}

/* safe result returns to agent */
@keyframes cms-return {
  0%,80%  { transform: translate(263px, 137px); opacity: 0; }
  82%     { transform: translate(263px, 137px); opacity: .9; }
  90%     { transform: translate(80px, 70px); opacity: 1; }
  92%     { transform: translate(80px, 70px); opacity: 0; }
  100%    { opacity: 0; }
}

@keyframes cms-result {
  0%,88%  { opacity: 0; }
  91%     { opacity: 1; }
  95%     { opacity: 1; }
  100%    { opacity: 0; }
}

@keyframes cms-pulse-vis {
  0%,32%  { opacity: 0; }
  36%     { opacity: 1; }
  76%     { opacity: 1; }
  82%,100%{ opacity: 0; }
}
@keyframes cms-pulse {
  0%   { transform: scale(1);   opacity: 0; }
  10%  { transform: scale(1);   opacity: .35; }
  60%  { transform: scale(1.6); opacity: 0; }
  100% { transform: scale(1.6); opacity: 0; }
}

@keyframes cms-prog {
  0%   { transform: scaleX(0); }
  100% { transform: scaleX(1); }
}

@media (prefers-reduced-motion: reduce) {
  .cms .cms-line, .cms .cms-submit,
  .cms .cms-beam, .cms .cms-ast-ok, .cms .cms-ast-bad, .cms .cms-bad-flash,
  .cms .cms-box, .cms .cms-deno,
  .cms .cms-pkt-a, .cms .cms-pkt-b, .cms .cms-pkt-c,
  .cms .cms-var-a, .cms .cms-var-b, .cms .cms-var-c,
  .cms .cms-block, .cms .cms-block-flash, .cms .cms-return, .cms .cms-result,
  .cms .cms-pulse, .cms .cms-pulse-wrap,
  .cms .cms-code1, .cms .cms-code2, .cms .cms-code3, .cms .cms-code4,
  .cms .cms-progress { animation: none; }
  .cms .cms-code1, .cms .cms-code2, .cms .cms-code3, .cms .cms-code4 { opacity: 1; }
  .cms .cms-box, .cms .cms-deno,
  .cms .cms-ast-ok, .cms .cms-var-a, .cms .cms-var-b, .cms .cms-var-c,
  .cms .cms-block, .cms .cms-result { opacity: 1; }
  .cms .cms-submit, .cms .cms-pkt-a, .cms .cms-pkt-b, .cms .cms-pkt-c,
  .cms .cms-return, .cms .cms-ast-bad, .cms .cms-block-flash { opacity: 0; }
  .cms .cms-progress { transform: scaleX(1); }
}
`

function McpServer({ x, y }: { x: number; y: number }): React.ReactNode {
  return (
    <g>
      <rect x={x} y={y} width="50" height="42" rx="6"
        fill="var(--text-primary)" fillOpacity="0.03"
        stroke="var(--text-muted)" strokeOpacity="0.35" strokeWidth="1" />
      <McpIcon x={x + 13} y={y + 5} size={22} color="var(--text-muted)" opacity="0.6" />
      <circle cx={x + 25} cy={y + 33} r="1.3" fill="var(--text-muted)" fillOpacity="0.35" />
      <line x1={x + 31} y1={y + 33} x2={x + 43} y2={y + 33}
        stroke="var(--text-muted)" strokeOpacity="0.15" strokeWidth="1" strokeDasharray="2 2" />
    </g>
  )
}

export default function CodeModeSecurityAnimation(): React.ReactNode {
  const id = useId()
  return (
    <div className="flex justify-center">
      <style>{CSS}</style>
      <svg
        className="cms"
        viewBox="0 0 540 210"
        style={{ width: '100%', maxWidth: 720, height: 'auto' }}
        xmlns="http://www.w3.org/2000/svg"
        role="presentation"
        aria-hidden="true"
      >
        <defs>
          <marker id={`${id}-arr`} viewBox="0 0 10 10" refX="9" refY="5"
            markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0 1 L9 5 L0 9 Z" fill="var(--text-muted)" fillOpacity={0.5} />
          </marker>
          <marker id={`${id}-arrA`} viewBox="0 0 10 10" refX="9" refY="5"
            markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0 1 L9 5 L0 9 Z" fill="var(--accent)" fillOpacity={0.6} />
          </marker>
        </defs>

        {/* ===== LAPTOP WITH AGENT IDE (left) ===== */}
        <rect x="4" y="20" width="150" height="106" rx="6"
          fill="var(--text-primary)" fillOpacity="0.03"
          stroke="var(--text-muted)" strokeOpacity="0.35" strokeWidth="1.5" />
        <rect x="0" y="128" width="158" height="7" rx="3.5"
          fill="var(--text-primary)" fillOpacity="0.04"
          stroke="var(--text-muted)" strokeOpacity="0.35" strokeWidth="1" />

        {/* Agent icons in tab bar */}
        <AgentIcon agent={CLAUDE} x={12} y={26} size={18} />
        <AgentIcon agent={CURSOR} x={34} y={26} size={18} />
        <text x="58" y="38" fill="var(--text-primary)" fillOpacity="0.45"
          fontSize="7" fontFamily="ui-monospace,SFMono-Regular,Consolas,monospace">
          runtime.ts
        </text>

        {/* Editor panel */}
        <rect x="10" y="50" width="138" height="72" rx="4"
          fill="var(--text-primary)" fillOpacity="0.04"
          stroke="var(--text-muted)" strokeOpacity="0.18" strokeWidth="0.8" />

        {/* Line numbers */}
        {[59, 71, 83, 95, 107].map((ly, i) => (
          <text key={ly} x="16" y={ly} fill="var(--text-muted)" fillOpacity="0.5"
            fontSize="6.5" fontFamily="ui-monospace,SFMono-Regular,Consolas,monospace">
            {i + 1}
          </text>
        ))}

        {/* Animated code lines (token-like rects) */}
        <g className="cms-code1">
          <rect x="24" y="54" width="22" height="4" rx="1" fill="#c084fc" fillOpacity="0.7" />
          <rect x="48" y="54" width="14" height="4" rx="1" fill="var(--text-primary)" fillOpacity="0.55" />
          <rect x="64" y="54" width="36" height="4" rx="1" fill={O} fillOpacity="0.6" />
        </g>
        <g className="cms-code2">
          <rect x="30" y="66" width="14" height="4" rx="1" fill="#60a5fa" fillOpacity="0.7" />
          <rect x="46" y="66" width="20" height="4" rx="1" fill="var(--text-primary)" fillOpacity="0.55" />
          <rect x="68" y="66" width="32" height="4" rx="1" fill={O} fillOpacity="0.6" />
          <rect x="102" y="66" width="6" height="4" rx="1" fill="var(--text-primary)" fillOpacity="0.4" />
        </g>
        <g className="cms-code3">
          <rect x="30" y="78" width="14" height="4" rx="1" fill="#60a5fa" fillOpacity="0.7" />
          <rect x="46" y="78" width="18" height="4" rx="1" fill="var(--text-primary)" fillOpacity="0.55" />
          <rect x="66" y="78" width="40" height="4" rx="1" fill={O} fillOpacity="0.6" />
        </g>
        <g className="cms-code4">
          <rect x="30" y="90" width="22" height="4" rx="1" fill="#c084fc" fillOpacity="0.7" />
          <rect x="54" y="90" width="34" height="4" rx="1" fill={SAFE} fillOpacity="0.6" />
          <rect x="24" y="102" width="6" height="4" rx="1" fill="var(--text-primary)" fillOpacity="0.55" />
        </g>

        <text x="79" y="142" textAnchor="middle"
          fill="var(--text-primary)" fontSize="9" fontWeight="bold" fontFamily="system-ui,sans-serif">
          AI Agent
        </text>

        {/* ===== EDISON SANDBOX (center) ===== */}
        <g className="cms-box">
          {/* Outer sandbox container */}
          <rect x="180" y="14" width="180" height="160" rx="8"
            fill="var(--accent)" fillOpacity="0.025"
            stroke="var(--accent)" strokeOpacity="0.45" strokeWidth="1.2"
            strokeDasharray="4 3" />

          {/* Edison logo badge */}
          <EdisonLogo x={184} y={4} w={20} h={19.5} />

          {/* Sandbox label */}
          <text x="270" y="13" textAnchor="middle"
            fill="var(--accent)" fillOpacity="0.85" fontSize="8" fontWeight="bold"
            fontFamily="system-ui,sans-serif">
            Deno Sandbox
          </text>

          {/* Sandbox pulse */}
          <g className="cms-pulse-wrap">
            <rect className="cms-pulse" x="180" y="14" width="180" height="160" rx="8"
              fill="none" stroke="var(--accent)" strokeOpacity="0.4" strokeWidth="1.2" />
          </g>
        </g>

        {/* ──── AST ANALYSIS SECTION (top of sandbox) ──── */}
        <g className="cms-box">
          <rect x="190" y="22" width="160" height="46" rx="5"
            fill="var(--text-primary)" fillOpacity="0.025"
            stroke="var(--text-muted)" strokeOpacity="0.2" strokeWidth="0.8" />
          <text x="196" y="32" fill="var(--text-primary)" fillOpacity="0.6"
            fontSize="7" fontWeight="bold" fontFamily="system-ui,sans-serif">
            1. AST Analysis
          </text>

          {/* Token-like representation of code lines being analyzed */}
          <g fillOpacity="0.6">
            <rect x="200" y="38" width="14" height="3" rx="1" fill="#c084fc" />
            <rect x="216" y="38" width="20" height="3" rx="1" fill={O} />
            <rect x="238" y="38" width="34" height="3" rx="1" fill="var(--text-muted)" />
          </g>
          <g fillOpacity="0.6">
            <rect x="200" y="46" width="10" height="3" rx="1" fill="#60a5fa" />
            <rect x="212" y="46" width="22" height="3" rx="1" fill={O} />
            <rect x="236" y="46" width="36" height="3" rx="1" fill="var(--text-muted)" />
          </g>
          {/* "eval(" line that gets rejected */}
          <g className="cms-bad-flash">
            <rect x="280" y="42" width="60" height="20" rx="2"
              fill={R} fillOpacity="0.05"
              stroke={R} strokeOpacity="0.18" strokeWidth="0.8"
              strokeDasharray="2 2" />
          </g>
          <text x="284" y="55" fill={R} fillOpacity="0.85"
            fontSize="6.5" fontFamily="ui-monospace,SFMono-Regular,Consolas,monospace">
            eval(input)
          </text>

          {/* AST scan beam */}
          <rect className="cms-beam" x="190" y="22" width="160" height="46" rx="5"
            fill="var(--accent)" fillOpacity="0.08"
            stroke="var(--accent)" strokeOpacity="0.5" strokeWidth="0.8" />
        </g>

        {/* AST OK badge (left side) */}
        <g className="cms-ast-ok">
          <circle cx="186" cy="30" r="5.5" fill={SAFE} fillOpacity="0.18"
            stroke={SAFE} strokeOpacity="0.7" strokeWidth="0.8" />
          <svg x="182" y="26" width="8" height="8" viewBox="0 0 256 256">
            <path d={CHECK_PATH} fill={SAFE} fillOpacity="0.95" />
          </svg>
        </g>

        {/* AST rejected badge */}
        <g className="cms-ast-bad">
          <circle cx="343" cy="60" r="5.5" fill={R} fillOpacity="0.2"
            stroke={R} strokeOpacity="0.8" strokeWidth="0.8" />
          <svg x="338.5" y="55.5" width="9" height="9" viewBox="0 0 256 256">
            <path d={X_PATH} fill={R} fillOpacity="0.95" />
          </svg>
        </g>

        {/* ──── DENO RUNTIME SECTION (middle of sandbox) ──── */}
        <g className="cms-deno">
          <rect x="190" y="74" width="160" height="50" rx="5"
            fill="var(--text-primary)" fillOpacity="0.03"
            stroke="var(--accent)" strokeOpacity="0.35" strokeWidth="0.8" />
          <text x="196" y="84" fill="var(--text-primary)" fillOpacity="0.6"
            fontSize="7" fontWeight="bold" fontFamily="system-ui,sans-serif">
            2. Deno Runtime
          </text>

          {/* Tool call rows */}
          <g fillOpacity="0.65" fontFamily="ui-monospace,SFMono-Regular,Consolas,monospace" fontSize="6">
            <rect x="198" y="91" width="2.4" height="2.4" rx="0.6" fill={SAFE} />
            <text x="203" y="94" fill="var(--text-primary)" fillOpacity="0.7">
              cal.list()
            </text>
            <rect x="198" y="101" width="2.4" height="2.4" rx="0.6" fill={SAFE} />
            <text x="203" y="104" fill="var(--text-primary)" fillOpacity="0.7">
              docs.read()
            </text>
            <rect x="198" y="111" width="2.4" height="2.4" rx="0.6" fill={SAFE} />
            <text x="203" y="114" fill="var(--text-primary)" fillOpacity="0.7">
              gmail.search()
            </text>
          </g>
        </g>

        {/* ──── TAINT-AWARE VARIABLES SECTION (bottom of sandbox) ──── */}
        <g className="cms-deno">
          <rect x="190" y="130" width="160" height="38" rx="5"
            fill="var(--text-primary)" fillOpacity="0.025"
            stroke="var(--text-muted)" strokeOpacity="0.2" strokeWidth="0.8" />
          <text x="196" y="140" fill="var(--text-primary)" fillOpacity="0.6"
            fontSize="7" fontWeight="bold" fontFamily="system-ui,sans-serif">
            3. Taint-aware Trifecta
          </text>
        </g>

        {/* Variable a: safe (calendar startTime) */}
        <g className="cms-var-a">
          <circle cx="202" cy="155" r="3" fill={SAFE} fillOpacity="0.25"
            stroke={SAFE} strokeOpacity="0.7" strokeWidth="0.6" />
          <text x="208" y="158" fill="var(--text-primary)" fillOpacity="0.7"
            fontSize="6.5" fontFamily="ui-monospace,SFMono-Regular,Consolas,monospace">
            a: safe
          </text>
        </g>

        {/* Variable b: safe (doc title) */}
        <g className="cms-var-b">
          <circle cx="247" cy="155" r="3" fill={SAFE} fillOpacity="0.25"
            stroke={SAFE} strokeOpacity="0.7" strokeWidth="0.6" />
          <text x="253" y="158" fill="var(--text-primary)" fillOpacity="0.7"
            fontSize="6.5" fontFamily="ui-monospace,SFMono-Regular,Consolas,monospace">
            b: safe
          </text>
        </g>

        {/* Variable c: tainted (email body) */}
        <g className="cms-var-c">
          <circle cx="294" cy="155" r="3" fill={R} fillOpacity="0.3"
            stroke={R} strokeOpacity="0.85" strokeWidth="0.6" />
          <text x="300" y="158" fill={R} fillOpacity="0.85"
            fontSize="6.5" fontFamily="ui-monospace,SFMono-Regular,Consolas,monospace">
            c: tainted
          </text>
        </g>

        {/* Block X over tainted variable c (covering its boundary) */}
        <g className="cms-block">
          <circle cx="335" cy="155" r="6" fill={R} fillOpacity="0.18"
            stroke={R} strokeOpacity="0.8" strokeWidth="0.9" />
          <svg x="330" y="150" width="10" height="10" viewBox="0 0 256 256">
            <path d={X_PATH} fill={R} fillOpacity="0.95" />
          </svg>
        </g>

        {/* Boundary flash on tainted block */}
        <rect className="cms-block-flash" x="280" y="146" width="64" height="18" rx="3"
          fill={R} fillOpacity="0" />


        {/* ===== CONNECTOR: Laptop -> Sandbox ===== */}
        <line className="cms-line" x1="156" y1="73" x2="180" y2="50"
          stroke="var(--text-muted)" strokeOpacity="0.45" strokeWidth="1.2"
          strokeDasharray="3 3" markerEnd={`url(#${id}-arr)`} />

        {/* ===== CONNECTOR: Sandbox -> Laptop (return) ===== */}
        <line className="cms-line" x1="180" y1="138" x2="156" y2="100"
          stroke="var(--accent)" strokeOpacity="0.5" strokeWidth="1.2"
          strokeDasharray="3 3" markerEnd={`url(#${id}-arrA)`} />

        {/* ===== CONNECTORS: Sandbox -> MCP servers ===== */}
        <line className="cms-line" x1="360" y1="70" x2="466" y2="35"
          stroke="var(--accent)" strokeOpacity="0.45" strokeWidth="1.2"
          strokeDasharray="3 3" />
        <line className="cms-line" x1="360" y1="95" x2="466" y2="95"
          stroke="var(--accent)" strokeOpacity="0.45" strokeWidth="1.2"
          strokeDasharray="3 3" />
        <line className="cms-line" x1="360" y1="120" x2="466" y2="155"
          stroke="var(--accent)" strokeOpacity="0.45" strokeWidth="1.2"
          strokeDasharray="3 3" />

        {/* ===== MCP SERVERS (right) ===== */}
        <McpServer x={466} y={14} />
        <McpServer x={466} y={74} />
        <McpServer x={466} y={134} />

        <text x="491" y="194" textAnchor="middle"
          fill="var(--text-primary)" fontSize="9" fontWeight="bold" fontFamily="system-ui,sans-serif">
          MCP Servers
        </text>

        {/* ===== PACKETS ===== */}
        {/* Code-submit packet (orange = pre-validation TS code) */}
        <g className="cms-pkt cms-submit">
          <rect x="-9" y="-6" width="18" height="12" rx="2"
            fill={O} fillOpacity="0.3" stroke={O} strokeOpacity="0.65" strokeWidth="0.8" />
          {/* Tiny brackets glyph */}
          <path d="M-4,-3 L-6,0 L-4,3 M4,-3 L6,0 L4,3"
            fill="none" stroke={O} strokeOpacity="0.9" strokeWidth="0.8"
            strokeLinecap="round" strokeLinejoin="round" />
        </g>

        {/* MCP round-trip packets (accent) */}
        <g className="cms-pkt cms-pkt-a"><McpPacket /></g>
        <g className="cms-pkt cms-pkt-b"><McpPacket /></g>
        <g className="cms-pkt cms-pkt-c"><McpPacket /></g>

        {/* Safe-result packet returning to agent (accent) */}
        <g className="cms-pkt cms-return">
          <circle r="6.5" fill="var(--accent)" fillOpacity="0.18" />
          <svg x="-5" y="-5" width="10" height="10" viewBox="0 0 256 256">
            <path d={SHIELD_PATH} fill="var(--accent)" fillOpacity="0.85" />
          </svg>
        </g>

        {/* Safe result acknowledgement label */}
        <g className="cms-result">
          <text x="79" y="14" textAnchor="middle"
            fill="var(--accent)" fillOpacity="0.85" fontSize="8" fontWeight="600"
            fontFamily="system-ui,sans-serif">
            Safe result returned
          </text>
        </g>

        {/* ===== PROGRESS BAR ===== */}
        <ProgressBar y={205} width={500} className="cms-progress" />
      </svg>
    </div>
  )
}
