/**
 * Prompt injection / data exfiltration risk animation.
 *
 * Triangular layout with three entities:
 *   - AI Agent (laptop + robot) on the left
 *   - Attacker (ghost) on the top-right
 *   - Malicious Email (envelope + poison badge) on the bottom-center
 *
 * Clockwise flow: Attacker → Poison Email → AI Agent → Attacker
 *   1. Attacker sends poisoned email (red arrow)
 *   2. Email infects AI agent (red arrow, robot turns red)
 *   3. Corrupted agent exfiltrates data to attacker (red arrow)
 *
 * 10s loop. Pure SVG + CSS. Respects `prefers-reduced-motion`.
 *
 * Requires CSS custom properties: --text-primary, --accent, --text-muted.
 */

import {
  OUTLOOK_SVG, OUTLOOK_SVG_VIEWBOX,
  SLACK_SVG, SLACK_SVG_VIEWBOX,
  GCAL_SVG, GCAL_SVG_VIEWBOX,
} from '../svg/app-icons-svg'
import {
  ATTACKER_BODY_PATHS,
  ATTACKER_HIGHLIGHT_PATHS,
  ATTACKER_SVG_VIEWBOX,
} from '../svg/attacker-svg'
import { ProgressBar, RED as R, RobotIcon } from './_shared'

const G = '#3ddc84'

const POISON_PATH =
  'M17 5a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-2v4a7 7 0 0 1 7 7v20a3 3 0 0 1-3 3H16a3 3 0 0 1-3-3V21a7 7 0 0 1 7-7v-4h-2a1 1 0 0 1-1-1zm5 5v5a1 1 0 0 1-1 1h-1a5 5 0 0 0-4.9 4h17.8a5 5 0 0 0-4.9-4h-1a1 1 0 0 1-1-1v-5zm5.536 19.829l.707.707l1.414-1.415l-2.829-2.828l-1.414 1.414l.708.708L24 30.537l-2.121-2.122l.707-.707l-1.414-1.414l-.708.707l-1.414 1.414l-.707.707l1.414 1.414l.707-.707l2.122 2.122l-2.121 2.12l-.708-.707l-1.414 1.415l.708.707l1.414 1.415l.707.706l1.414-1.414l-.707-.707L24 33.365l2.121 2.121l-.707.707l1.414 1.415l2.829-2.829l-1.414-1.414l-.707.707l-2.122-2.121z'

const CSS = `
.pi-anim { color: var(--text-primary); }

.pi-anim .pi-line { stroke-dashoffset: 0; animation: pi-lf 2s linear infinite; }

.pi-anim .pi-bot-clean  { animation: pi-bot-clean 10s ease-in-out infinite; }
.pi-anim .pi-bot-dirty  { animation: pi-bot-dirty 10s ease-in-out infinite; }
.pi-anim .pi-eye-pulse  { animation: pi-eye-pulse 1.5s ease-in-out infinite; }
.pi-anim .pi-flash      { animation: pi-flash 10s ease-in-out infinite; }
.pi-anim .pi-ring       { animation: pi-ring 10s ease-in-out infinite; }
.pi-anim .pi-hl         { animation: pi-hl 10s ease-in-out infinite; }

.pi-anim .pi-poison     { animation: pi-poison 10s ease-in-out infinite; }
.pi-anim .pi-pglow      { animation: pi-pglow 2s ease-in-out infinite; }

.pi-anim .pi-arrow1     { animation: pi-arrow1 10s ease-in-out infinite; }
.pi-anim .pi-pkt1       { animation: pi-pkt1 10s ease-in-out infinite; }
.pi-anim .pi-arrow2     { animation: pi-arrow2 10s ease-in-out infinite; }
.pi-anim .pi-pkt2       { animation: pi-pkt2 10s ease-in-out infinite; }
.pi-anim .pi-arrow3     { animation: pi-arrow3 10s ease-in-out infinite; }
.pi-anim .pi-pkt3       { animation: pi-pkt3 10s ease-in-out infinite; }

.pi-anim .pi-apulse-wrap{ animation: pi-apulse-vis 10s ease-in-out infinite; }
.pi-anim .pi-apulse     { transform-origin: 396px 28px; animation: pi-apulse 1.33s cubic-bezier(.2,.8,.4,1) infinite; }
.pi-anim .pi-label      { animation: pi-label 10s ease-in-out infinite; }
.pi-anim .pi-progress   { transform-origin: 20px 188px; animation: pi-prog 10s linear infinite; }

@keyframes pi-lf { to { stroke-dashoffset: -12; } }

@keyframes pi-bot-clean {
  0%,26%  { opacity: 1; }
  32%     { opacity: 0; }
  84%     { opacity: 0; }
  92%     { opacity: 1; }
}

@keyframes pi-bot-dirty {
  0%,28%  { opacity: 0; }
  34%     { opacity: 1; }
  84%     { opacity: 1; }
  92%     { opacity: 0; }
}

@keyframes pi-eye-pulse {
  0%,100% { fill-opacity: 0.5; }
  50%     { fill-opacity: 0.9; }
}

@keyframes pi-flash {
  0%,28%  { fill-opacity: 0; }
  32%     { fill-opacity: 0.15; }
  36%     { fill-opacity: 0.04; }
  40%,100%{ fill-opacity: 0; }
}

@keyframes pi-ring {
  0%,28%  { stroke: var(--text-muted); stroke-opacity: 0.35; }
  32%     { stroke: ${R}; stroke-opacity: 0.7; }
  40%     { stroke: var(--text-muted); stroke-opacity: 0.35; }
  100%    { stroke: var(--text-muted); stroke-opacity: 0.35; }
}

@keyframes pi-hl {
  0%,38%  { opacity: 0; }
  42%     { opacity: 0.4; }
  78%     { opacity: 0.4; }
  82%     { opacity: 0; }
  100%    { opacity: 0; }
}

@keyframes pi-poison {
  0%,14%  { opacity: 0; }
  18%     { opacity: 1; }
  82%     { opacity: 1; }
  88%     { opacity: 0; }
  100%    { opacity: 0; }
}

@keyframes pi-pglow {
  0%,100% { fill-opacity: 0.1; }
  50%     { fill-opacity: 0.25; }
}

@keyframes pi-arrow1 {
  0%,14%  { opacity: 0; }
  18%     { opacity: 1; }
  82%     { opacity: 1; }
  88%     { opacity: 0; }
  100%    { opacity: 0; }
}

@keyframes pi-pkt1 {
  0%,16%  { transform: translate(374px, 44px); opacity: 0; }
  18%     { transform: translate(374px, 44px); opacity: .8; }
  22%     { transform: translate(288px, 118px); opacity: 1; }
  24%     { transform: translate(288px, 118px); opacity: 0; }
  100%    { transform: translate(288px, 118px); opacity: 0; }
}

@keyframes pi-arrow2 {
  0%,22%  { opacity: 0; }
  26%     { opacity: 1; }
  82%     { opacity: 1; }
  88%     { opacity: 0; }
  100%    { opacity: 0; }
}

@keyframes pi-pkt2 {
  0%,24%  { transform: translate(248px, 130px); opacity: 0; }
  26%     { transform: translate(248px, 130px); opacity: .8; }
  30%     { transform: translate(158px, 54px); opacity: 1; }
  32%     { transform: translate(158px, 54px); opacity: 0; }
  100%    { transform: translate(158px, 54px); opacity: 0; }
}

@keyframes pi-arrow3 {
  0%,36%  { opacity: 0; }
  40%     { opacity: 1; }
  82%     { opacity: 1; }
  88%     { opacity: 0; }
  100%    { opacity: 0; }
}

@keyframes pi-pkt3 {
  0%,40%  { transform: translate(158px, 26px); opacity: 0; }
  42%     { transform: translate(158px, 26px); opacity: .8; }
  48%     { transform: translate(376px, 24px); opacity: 1; }
  50%     { transform: translate(376px, 24px); opacity: 0; }
  52%     { transform: translate(158px, 26px); opacity: 0; }
  54%     { transform: translate(158px, 26px); opacity: .8; }
  60%     { transform: translate(376px, 24px); opacity: 1; }
  62%     { transform: translate(376px, 24px); opacity: 0; }
  64%     { transform: translate(158px, 26px); opacity: 0; }
  66%     { transform: translate(158px, 26px); opacity: .8; }
  72%     { transform: translate(376px, 24px); opacity: 1; }
  74%     { transform: translate(376px, 24px); opacity: 0; }
  100%    { transform: translate(376px, 24px); opacity: 0; }
}

@keyframes pi-apulse-vis {
  0%,44%  { opacity: 0; }
  48%     { opacity: 1; }
  80%     { opacity: 1; }
  84%     { opacity: 0; }
  100%    { opacity: 0; }
}

@keyframes pi-apulse {
  0%   { transform: scale(1);   opacity: 0; }
  10%  { transform: scale(1);   opacity: .35; }
  60%  { transform: scale(1.6); opacity: 0; }
  100% { transform: scale(1.6); opacity: 0; }
}

@keyframes pi-label {
  0%,42%  { opacity: 0; }
  46%,80% { opacity: 1; }
  86%,100%{ opacity: 0; }
}

@keyframes pi-prog {
  0%   { transform: scaleX(0); }
  100% { transform: scaleX(1); }
}

@media (prefers-reduced-motion: reduce) {
  .pi-anim .pi-line,
  .pi-anim .pi-bot-clean, .pi-anim .pi-bot-dirty,
  .pi-anim .pi-eye-pulse, .pi-anim .pi-flash,
  .pi-anim .pi-ring, .pi-anim .pi-hl,
  .pi-anim .pi-poison, .pi-anim .pi-pglow,
  .pi-anim .pi-arrow1, .pi-anim .pi-pkt1,
  .pi-anim .pi-arrow2, .pi-anim .pi-pkt2,
  .pi-anim .pi-arrow3, .pi-anim .pi-pkt3,
  .pi-anim .pi-apulse, .pi-anim .pi-apulse-wrap,
  .pi-anim .pi-label { animation: none; }
  .pi-anim .pi-bot-clean { opacity: 0; }
  .pi-anim .pi-bot-dirty { opacity: 1; }
  .pi-anim .pi-eye-pulse { fill-opacity: 0.7; }
  .pi-anim .pi-flash { fill-opacity: 0; }
  .pi-anim .pi-ring { stroke: var(--text-muted); stroke-opacity: 0.35; }
  .pi-anim .pi-hl { opacity: 0.4; }
  .pi-anim .pi-poison { opacity: 1; }
  .pi-anim .pi-arrow1, .pi-anim .pi-arrow2, .pi-anim .pi-arrow3 { opacity: 1; }
  .pi-anim .pi-pkt1, .pi-anim .pi-pkt2, .pi-anim .pi-pkt3 { opacity: 0; }
  .pi-anim .pi-apulse-wrap { opacity: 1; }
  .pi-anim .pi-label { opacity: 1; }
  .pi-anim .pi-progress { animation: none; transform: scaleX(1); }
}
`

export default function PromptInjectionAnimation(): React.ReactNode {
  return (
    <div className="flex justify-center">
      <style>{CSS}</style>
      <svg
        className="pi-anim"
        viewBox="0 0 500 190"
        style={{ width: '100%', maxWidth: 500, height: 'auto' }}
        xmlns="http://www.w3.org/2000/svg"
        role="presentation"
        aria-hidden="true"
      >
        {/* ===== ARROW MARKERS ===== */}
        <defs>
          <marker id="pi-arrR" viewBox="0 0 10 10" refX="9" refY="5"
            markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0 1 L9 5 L0 9 Z" fill={R} fillOpacity={0.5} />
          </marker>
        </defs>

        {/* ===== LAPTOP (left) ===== */}
        <rect className="pi-ring" x="8" y="12" width="150" height="82" rx="6"
          fill="var(--text-primary)" fillOpacity="0.03"
          stroke="var(--text-muted)" strokeOpacity="0.35" strokeWidth="1.5" />
        <rect x="4" y="96" width="158" height="7" rx="3.5"
          fill="var(--text-primary)" fillOpacity="0.04"
          stroke="var(--text-muted)" strokeOpacity="0.35" strokeWidth="1" />

        {/* Clean robot (green = safe) */}
        <g className="pi-bot-clean">
          <RobotIcon x={61} y={15} size={40} fill={G} fillOpacity="0.55" />
        </g>

        {/* Corrupted robot (red = compromised) + large poison icon */}
        <g className="pi-bot-dirty">
          <RobotIcon x={61} y={15} size={40} fill={R} fillOpacity="0.6" />
          {/* Pulse highlights centered on RobotIcon's pill eyes
              (256-vb eye centers (100,156) and (156,156) mapped into the 40-px parent). */}
          <circle className="pi-eye-pulse" cx="76.6" cy="39.4" r="2.4" fill={R} fillOpacity="0.7" />
          <circle className="pi-eye-pulse" cx="85.4" cy="39.4" r="2.4" fill={R} fillOpacity="0.7" />
          {/* Large poison icon to the right of corrupted robot */}
          <svg x="104" y="18" width="28" height="28" viewBox="0 0 48 48">
            <path d={POISON_PATH} fill={R} fillOpacity="0.6" fillRule="evenodd" />
          </svg>
        </g>

        {/* App connector icons */}
        <rect x="34" y="58" width="24" height="24" rx="5"
          fill="var(--text-primary)" fillOpacity="0.06"
          stroke="var(--text-muted)" strokeOpacity="0.2" strokeWidth="0.8" />
        <svg x="37" y="61" width="18" height="18" viewBox={OUTLOOK_SVG_VIEWBOX}
          dangerouslySetInnerHTML={{ __html: OUTLOOK_SVG }} />

        <rect x="64" y="58" width="24" height="24" rx="5"
          fill="var(--text-primary)" fillOpacity="0.06"
          stroke="var(--text-muted)" strokeOpacity="0.2" strokeWidth="0.8" />
        <svg x="67" y="61" width="18" height="18" viewBox={SLACK_SVG_VIEWBOX}
          dangerouslySetInnerHTML={{ __html: SLACK_SVG }} />

        <rect x="94" y="58" width="24" height="24" rx="5"
          fill="var(--text-primary)" fillOpacity="0.06"
          stroke="var(--text-muted)" strokeOpacity="0.2" strokeWidth="0.8" />
        <svg x="97" y="61" width="18" height="18" viewBox={GCAL_SVG_VIEWBOX}
          dangerouslySetInnerHTML={{ __html: GCAL_SVG }} />

        {/* App icon highlight overlay (strong red = data being stolen) */}
        <rect className="pi-hl" x="34" y="58" width="84" height="24" rx="5" fill={R} />

        {/* Laptop screen flash (red on corruption) */}
        <rect className="pi-flash" x="8" y="12" width="150" height="82" rx="6"
          fill={R} fillOpacity="0" />

        {/* ===== ATTACKER (top-right, red ghost) ===== */}
        <g className="pi-apulse-wrap">
          <circle className="pi-apulse" cx="396" cy="28" r="25"
            fill="none" stroke={R} strokeOpacity="0.5" strokeWidth="1.5" />
        </g>
        <svg x="374" y="6" width="44" height="44" viewBox={ATTACKER_SVG_VIEWBOX}>
          {ATTACKER_BODY_PATHS.map((d, i) => (
            <path key={`body-${i}`} d={d} fill={R} fillOpacity="0.5" />
          ))}
          {ATTACKER_HIGHLIGHT_PATHS.map((d, i) => (
            <path key={`hl-${i}`} d={d} fill="#fff" />
          ))}
        </svg>

        {/* ===== MALICIOUS EMAIL (bottom-center: envelope + poison badge) ===== */}
        <g className="pi-poison">
          <circle className="pi-pglow" cx="268" cy="132" r="30"
            fill={R} fillOpacity="0.06" />

          {/* Envelope body */}
          <rect x="244" y="114" width="48" height="34" rx="3"
            fill="var(--text-primary)" fillOpacity="0.06"
            stroke={R} strokeOpacity="0.25" strokeWidth="1.2" />
          {/* Envelope flap */}
          <path d="M244,114 L268,134 L292,114"
            fill="none" stroke={R} strokeOpacity="0.25"
            strokeWidth="1.2" strokeLinejoin="round" />

          {/* Poison badge (bottom-right corner, larger) */}
          <circle cx="290" cy="144" r="13"
            fill="var(--text-primary)" fillOpacity="0.12"
            stroke={R} strokeOpacity="0.35" strokeWidth="0.8" />
          <svg x="278" y="132" width="24" height="24" viewBox="0 0 48 48">
            <path d={POISON_PATH} fill={R} fillOpacity="0.65" fillRule="evenodd" />
          </svg>
        </g>

        {/* ===== ARROW 1: Attacker → Email (red, sends email) ===== */}
        <g className="pi-arrow1">
          <line className="pi-line" x1="374" y1="44" x2="290" y2="116"
            stroke={R} strokeOpacity="0.35" strokeWidth="1.5"
            strokeDasharray="3 3" markerEnd="url(#pi-arrR)" />
        </g>

        {/* ===== ARROW 2: Email → Laptop (red, infects agent) ===== */}
        <g className="pi-arrow2">
          <line className="pi-line" x1="246" y1="130" x2="158" y2="54"
            stroke={R} strokeOpacity="0.4" strokeWidth="1.5"
            strokeDasharray="3 3" markerEnd="url(#pi-arrR)" />
        </g>

        {/* ===== ARROW 3: Laptop → Attacker (red, data exfiltration) ===== */}
        <g className="pi-arrow3">
          <line className="pi-line" x1="158" y1="26" x2="376" y2="22"
            stroke={R} strokeOpacity="0.4" strokeWidth="1.5"
            strokeDasharray="3 3" markerEnd="url(#pi-arrR)" />
        </g>

        {/* ===== PACKETS ===== */}
        {/* Packet 1: Large red envelope (Attacker → Email) */}
        <g className="pi-pkt1">
          <rect x="-12" y="-8" width="24" height="16" rx="2"
            fill={R} fillOpacity="0.25" stroke={R} strokeOpacity="0.5" strokeWidth="1" />
          <path d="M-12,-8 L0,2 L12,-8"
            fill="none" stroke={R} strokeOpacity="0.6" strokeWidth="1" strokeLinejoin="round" />
        </g>

        {/* Packet 2: Red envelope (Email → Laptop) */}
        <g className="pi-pkt2">
          <rect x="-10" y="-7" width="20" height="14" rx="2"
            fill={R} fillOpacity="0.25" stroke={R} strokeOpacity="0.5" strokeWidth="0.8" />
          <path d="M-10,-7 L0,1 L10,-7"
            fill="none" stroke={R} strokeOpacity="0.6" strokeWidth="0.8" strokeLinejoin="round" />
        </g>

        {/* Packet 3: Red envelope (Laptop → Attacker, stolen data) */}
        <g className="pi-pkt3">
          <rect x="-10" y="-7" width="20" height="14" rx="2"
            fill={R} fillOpacity="0.25" stroke={R} strokeOpacity="0.5" strokeWidth="0.8" />
          <path d="M-10,-7 L0,1 L10,-7"
            fill="none" stroke={R} strokeOpacity="0.6" strokeWidth="0.8" strokeLinejoin="round" />
        </g>

        {/* ===== LABELS ===== */}
        <text x="83" y="114" textAnchor="middle"
          fill="var(--text-primary)" fontSize="9" fontWeight="bold" fontFamily="system-ui,sans-serif">
          Your AI Agent
        </text>
        <text x="396" y="62" textAnchor="middle"
          fill="var(--text-primary)" fontSize="9" fontWeight="bold" fontFamily="system-ui,sans-serif">
          Attacker
        </text>
        <g className="pi-poison">
          <text x="268" y="162" textAnchor="middle"
            fill="var(--text-primary)" fontSize="8" fontWeight="bold" fontFamily="system-ui,sans-serif">
            Malicious Email with jailbreak instructions
          </text>
        </g>

        {/* Warning label positioned along arrow 3 (laptop → attacker) */}
        <g className="pi-label">
          <text x="267" y="16" textAnchor="middle"
            fill={R} fontSize="8" fontWeight="600" fontFamily="system-ui,sans-serif" opacity="0.8">
            The AI leaked sensitive data
          </text>
        </g>

        {/* ===== PROGRESS BAR ===== */}
        <ProgressBar y={188} width={460} className="pi-progress" />
      </svg>
    </div>
  )
}
