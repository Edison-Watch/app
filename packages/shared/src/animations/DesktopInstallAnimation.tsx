/**
 * Desktop app install & onboarding wizard animation.
 *
 * Clean two-phase loop on a single laptop:
 *   Phase 1 (0-40%): Download arrow drops, Edison app icon pops in.
 *   Phase 2 (46-92%): Screen clears to wizard with step dots lighting
 *           up, progress bar filling, and a final checkmark.
 *
 * No overlapping elements - each phase fully replaces the previous.
 *
 * 10s loop. Pure SVG + CSS. Respects `prefers-reduced-motion`.
 */

import { EdisonLogo, ProgressBar } from './_shared'

const fg = 'var(--text-primary)'
const muted = 'var(--text-muted)'
const accent = 'var(--accent)'

const CSS = `
.di-anim { color: ${fg}; }

/* Phase 1: download + icon (visible 0-42%, fades out) */
.di-anim .di-p1 { animation: di-p1 10s ease-in-out infinite; }

/* Phase 2: wizard (fades in at 44%, visible until 92%) */
.di-anim .di-p2 { animation: di-p2 10s ease-in-out infinite; }

/* Download arrow drops */
.di-anim .di-arrow { animation: di-arrow 10s ease-in-out infinite; }

/* App icon bounces in */
.di-anim .di-icon { animation: di-icon 10s ease-in-out infinite; transform-origin: 250px 75px; }

/* Cursor slides in and double-clicks */
.di-anim .di-cursor { animation: di-cursor 10s ease-in-out infinite; }
.di-anim .di-click { animation: di-click 10s ease-in-out infinite; transform-origin: 268px 98px; }

/* Click ripples */
.di-anim .di-rip1 { animation: di-rip1 10s ease-out infinite; transform-origin: 268px 94px; }
.di-anim .di-rip2 { animation: di-rip2 10s ease-out infinite; transform-origin: 268px 94px; }

/* Wizard step dots light up on each click */
.di-anim .di-dot1 { animation: di-dot1 10s ease-in-out infinite; }
.di-anim .di-dot2 { animation: di-dot2 10s ease-in-out infinite; }
.di-anim .di-dot3 { animation: di-dot3 10s ease-in-out infinite; }

/* Wizard cursor clicks Continue button 3 times */
.di-anim .di-wcur { animation: di-wcur 10s ease-in-out infinite; }
.di-anim .di-wclk { animation: di-wclk 10s ease-in-out infinite; transform-origin: 256px 118px; }

/* Wizard click ripples */
.di-anim .di-wrip1 { animation: di-wrip1 10s ease-out infinite; transform-origin: 250px 118px; }
.di-anim .di-wrip2 { animation: di-wrip2 10s ease-out infinite; transform-origin: 250px 118px; }
.di-anim .di-wrip3 { animation: di-wrip3 10s ease-out infinite; transform-origin: 250px 118px; }

/* Wizard content fades out before checkmark */
.di-anim .di-wiz { animation: di-wiz 10s ease-in-out infinite; }

/* Final checkmark */
.di-anim .di-done { animation: di-done 10s ease-in-out infinite; transform-origin: 250px 85px; }

/* Bottom progress bar */
.di-anim .di-progress { transform-origin: 20px 188px; animation: di-prog 10s linear infinite; }

@keyframes di-p1 {
  0%,40%  { opacity: 1; }
  46%     { opacity: 0; }
  100%    { opacity: 0; }
}

@keyframes di-p2 {
  0%,44%  { opacity: 0; }
  50%     { opacity: 1; }
  92%     { opacity: 1; }
  98%     { opacity: 0; }
  100%    { opacity: 0; }
}

@keyframes di-arrow {
  0%      { opacity: 0; transform: translateY(-24px); }
  5%      { opacity: 0.8; transform: translateY(-24px); }
  20%     { opacity: 0.8; transform: translateY(0px); }
  26%     { opacity: 0; transform: translateY(4px); }
  100%    { opacity: 0; }
}

@keyframes di-icon {
  0%,22%  { opacity: 0; transform: scale(0.5); }
  28%     { opacity: 1; transform: scale(1.1); }
  32%     { opacity: 1; transform: scale(1); }
  38%     { opacity: 1; transform: scale(1); }
  44%     { opacity: 0; transform: scale(2); }
  100%    { opacity: 0; transform: scale(2); }
}

/* Cursor: slide in from right, land on icon */
@keyframes di-cursor {
  0%,28%   { opacity: 0; transform: translate(40px, -20px); }
  32%      { opacity: 0.8; transform: translate(40px, -20px); }
  35%      { opacity: 0.8; transform: translate(0px, 0px); }
  40%      { opacity: 0.8; transform: translate(0px, 0px); }
  42%      { opacity: 0; transform: translate(0px, 0px); }
  100%     { opacity: 0; }
}
/* Double-click: two quick scale pulses */
@keyframes di-click {
  0%,35%   { transform: scale(1); }
  36%      { transform: scale(0.85); }
  36.5%    { transform: scale(1); }
  37.5%    { transform: scale(0.85); }
  38%      { transform: scale(1); }
  100%     { transform: scale(1); }
}

/* Ripple 1: expands on first click */
@keyframes di-rip1 {
  0%,35.5%  { opacity: 0; transform: scale(0); }
  36%       { opacity: 0.5; transform: scale(0.3); }
  38%       { opacity: 0; transform: scale(1); }
  100%      { opacity: 0; }
}
/* Ripple 2: expands on second click */
@keyframes di-rip2 {
  0%,37%    { opacity: 0; transform: scale(0); }
  37.5%     { opacity: 0.5; transform: scale(0.3); }
  39.5%     { opacity: 0; transform: scale(1); }
  100%      { opacity: 0; }
}

/* Dots light up in sync with cursor clicks */
@keyframes di-dot1 {
  0%,55%  { fill: ${muted}; fill-opacity: 0.2; }
  56%     { fill: ${accent}; fill-opacity: 0.8; }
  92%     { fill: ${accent}; fill-opacity: 0.8; }
  98%     { fill: ${muted}; fill-opacity: 0.2; }
}
@keyframes di-dot2 {
  0%,61%  { fill: ${muted}; fill-opacity: 0.2; }
  62%     { fill: ${accent}; fill-opacity: 0.8; }
  92%     { fill: ${accent}; fill-opacity: 0.8; }
  98%     { fill: ${muted}; fill-opacity: 0.2; }
}
@keyframes di-dot3 {
  0%,67%  { fill: ${muted}; fill-opacity: 0.2; }
  68%     { fill: ${accent}; fill-opacity: 0.8; }
  92%     { fill: ${accent}; fill-opacity: 0.8; }
  98%     { fill: ${muted}; fill-opacity: 0.2; }
}

/* Wizard cursor: slides in, stays for 3 clicks, fades out */
@keyframes di-wcur {
  0%,51%   { opacity: 0; transform: translate(30px, -15px); }
  54%      { opacity: 0.8; transform: translate(0px, 0px); }
  70%      { opacity: 0.8; transform: translate(0px, 0px); }
  72%      { opacity: 0; transform: translate(0px, 0px); }
  100%     { opacity: 0; }
}
/* Wizard cursor: three click pulses */
@keyframes di-wclk {
  0%,54.5%  { transform: scale(1); }
  55.5%     { transform: scale(0.82); }
  56%       { transform: scale(1); }
  61%       { transform: scale(1); }
  62%       { transform: scale(0.82); }
  62.5%     { transform: scale(1); }
  67%       { transform: scale(1); }
  68%       { transform: scale(0.82); }
  68.5%     { transform: scale(1); }
  100%      { transform: scale(1); }
}

/* Wizard click ripples - one per click */
@keyframes di-wrip1 {
  0%,55%    { opacity: 0; transform: scale(0); }
  55.5%     { opacity: 0.5; transform: scale(0.3); }
  57.5%     { opacity: 0; transform: scale(1); }
  100%      { opacity: 0; }
}
@keyframes di-wrip2 {
  0%,61.5%  { opacity: 0; transform: scale(0); }
  62%       { opacity: 0.5; transform: scale(0.3); }
  64%       { opacity: 0; transform: scale(1); }
  100%      { opacity: 0; }
}
@keyframes di-wrip3 {
  0%,67.5%  { opacity: 0; transform: scale(0); }
  68%       { opacity: 0.5; transform: scale(0.3); }
  70%       { opacity: 0; transform: scale(1); }
  100%      { opacity: 0; }
}

@keyframes di-wiz {
  0%,50%   { opacity: 1; }
  74%      { opacity: 1; }
  78%      { opacity: 0; }
  100%     { opacity: 0; }
}

@keyframes di-done {
  0%,76%  { opacity: 0; transform: scale(0.6); }
  82%     { opacity: 1; transform: scale(1.05); }
  86%     { opacity: 1; transform: scale(1); }
  92%     { opacity: 1; transform: scale(1); }
  98%     { opacity: 0; transform: scale(1); }
}

@keyframes di-prog {
  0%   { transform: scaleX(0); }
  100% { transform: scaleX(1); }
}

@media (prefers-reduced-motion: reduce) {
  .di-anim .di-p1, .di-anim .di-p2,
  .di-anim .di-arrow, .di-anim .di-icon,
  .di-anim .di-cursor, .di-anim .di-click, .di-anim .di-rip1, .di-anim .di-rip2,
  .di-anim .di-dot1, .di-anim .di-dot2, .di-anim .di-dot3,
  .di-anim .di-wcur, .di-anim .di-wclk,
  .di-anim .di-wrip1, .di-anim .di-wrip2, .di-anim .di-wrip3,
  .di-anim .di-wiz, .di-anim .di-done { animation: none; }
  .di-anim .di-cursor { opacity: 0; }
  .di-anim .di-wcur { opacity: 0; }
  .di-anim .di-wiz { opacity: 0; }
  .di-anim .di-p1 { opacity: 0; }
  .di-anim .di-p2 { opacity: 1; }
  .di-anim .di-arrow { opacity: 0; }
  .di-anim .di-icon { opacity: 1; transform: scale(1); }
  .di-anim .di-dot1, .di-anim .di-dot2, .di-anim .di-dot3 {
    fill: ${accent}; fill-opacity: 0.8;
  }
  .di-anim .di-done { opacity: 1; transform: scale(1); }
  .di-anim .di-progress { animation: none; transform: scaleX(1); }
}
`

export default function DesktopInstallAnimation(): React.ReactNode {
  return (
    <div className="flex justify-center">
      <style>{CSS}</style>
      <svg
        className="di-anim"
        width={500}
        height={190}
        viewBox="0 0 500 190"
        xmlns="http://www.w3.org/2000/svg"
        role="presentation"
        aria-hidden="true"
      >
        {/* Laptop shell (always visible) */}
        <rect x={160} y={20} width={180} height={120} rx={7}
          fill={fg} fillOpacity="0.03"
          stroke={muted} strokeOpacity="0.35" strokeWidth="1.5" />
        <rect x={155} y={142} width={190} height={8} rx={4}
          fill={fg} fillOpacity="0.04"
          stroke={muted} strokeOpacity="0.35" strokeWidth="1" />

        {/* ===== PHASE 1: Download + app icon ===== */}
        <g className="di-p1">
          {/* Download arrow */}
          <g className="di-arrow">
            <line x1={250} y1={40} x2={250} y2={68}
              stroke={accent} strokeWidth="2.5" strokeLinecap="round" strokeOpacity="0.7" />
            <path d="M242 62 L250 72 L258 62"
              fill="none" stroke={accent} strokeWidth="2.5"
              strokeLinecap="round" strokeLinejoin="round" strokeOpacity="0.7" />
          </g>

          {/* Edison app icon (pops in after arrow lands) */}
          <g className="di-icon">
            <rect x={226} y={52} width={48} height={48} rx={12}
              fill={accent} fillOpacity="0.08"
              stroke={accent} strokeOpacity="0.35" strokeWidth="1.5" />
            <EdisonLogo x={233} y={57} w={34} h={33} />
            <text x={250} y={116} textAnchor="middle"
              fill={fg} fontSize="8" fontWeight="600"
              fontFamily="system-ui,sans-serif" fillOpacity="0.5">
              Edison Watch
            </text>
          </g>

          {/* Click ripples */}
          <circle className="di-rip1" cx={268} cy={94} r={22}
            fill="none" stroke={accent} strokeWidth="1.5" />
          <circle className="di-rip2" cx={268} cy={94} r={22}
            fill="none" stroke={accent} strokeWidth="1.5" />

          {/* Cursor double-click on app icon */}
          <g className="di-cursor">
            <g className="di-click">
              <path d="M268 94 L268 108 L272 104 L276 110 L278 109 L274 103 L279 102 Z"
                fill={fg} fillOpacity="0.7" stroke={fg} strokeOpacity="0.3" strokeWidth="0.5" />
            </g>
          </g>
        </g>

        {/* ===== PHASE 2: Onboarding wizard ===== */}
        <g className="di-p2">
          {/* App window outline */}
          <rect x={170} y={26} width={160} height={108} rx={5}
            fill={fg} fillOpacity="0.02"
            stroke={accent} strokeOpacity="0.25" strokeWidth="1" />
          {/* Title bar */}
          <rect x={170} y={26} width={160} height={16} rx={5}
            fill={accent} fillOpacity="0.06" />
          <rect x={170} y={37} width={160} height={5}
            fill={accent} fillOpacity="0.06" />
          {/* Edison logo in title bar */}
          <EdisonLogo x={174} y={28} w={12} h={12} />
          <text x={190} y={37} fill={fg} fontSize="6.5" fontWeight="600"
            fontFamily="system-ui,sans-serif" fillOpacity="0.5">
            Edison Watch
          </text>
          {/* Window dots */}
          <circle cx={316} cy={34} r={2} fill={muted} fillOpacity="0.2" />
          <circle cx={323} cy={34} r={2} fill={muted} fillOpacity="0.2" />

          {/* Wizard steps - fades out before checkmark */}
          <g className="di-wiz">
            <text x={250} y={54} textAnchor="middle"
              fill={fg} fontSize="8" fontWeight="bold"
              fontFamily="system-ui,sans-serif" fillOpacity="0.6">
              Setup Wizard
            </text>

            {/* Step dots */}
            <circle className="di-dot1" cx={234} cy={62} r={3}
              fill={muted} fillOpacity="0.2" />
            <circle className="di-dot2" cx={250} cy={62} r={3}
              fill={muted} fillOpacity="0.2" />
            <circle className="di-dot3" cx={266} cy={62} r={3}
              fill={muted} fillOpacity="0.2" />

            {/* Content placeholder lines */}
            <rect x={200} y={74} width={100} height={3} rx={1.5}
              fill={muted} fillOpacity="0.12" />
            <rect x={200} y={82} width={76} height={3} rx={1.5}
              fill={muted} fillOpacity="0.08" />
            <rect x={200} y={90} width={88} height={3} rx={1.5}
              fill={muted} fillOpacity="0.06" />

            {/* Right arrow button */}
            <circle cx={250} cy={118} r={8}
              fill={accent} fillOpacity="0.1"
              stroke={accent} strokeOpacity="0.25" strokeWidth="0.8" />
            <line x1={245} y1={118} x2={254} y2={118}
              stroke={accent} strokeWidth="1.5" strokeLinecap="round" strokeOpacity="0.5" />
            <path d="M251 115 L255 118 L251 121"
              fill="none" stroke={accent} strokeWidth="1.5"
              strokeLinecap="round" strokeLinejoin="round" strokeOpacity="0.5" />

            {/* Click ripples on button */}
            <circle className="di-wrip1" cx={250} cy={118} r={18}
              fill="none" stroke={accent} strokeWidth="1.5" />
            <circle className="di-wrip2" cx={250} cy={118} r={18}
              fill="none" stroke={accent} strokeWidth="1.5" />
            <circle className="di-wrip3" cx={250} cy={118} r={18}
              fill="none" stroke={accent} strokeWidth="1.5" />

            {/* Cursor clicking arrow button */}
            <g className="di-wcur">
              <g className="di-wclk">
                <path d="M256 118 L256 132 L260 128 L264 134 L266 133 L262 127 L267 126 Z"
                  fill={fg} fillOpacity="0.7" stroke={fg} strokeOpacity="0.3" strokeWidth="0.5" />
              </g>
            </g>
          </g>

          {/* Completion checkmark (appears on clean screen) */}
          <g className="di-done">
            <circle cx={250} cy={85} r={18}
              fill={accent} fillOpacity="0.06"
              stroke={accent} strokeOpacity="0.35" strokeWidth="1.5" />
            <path d="M241 85 L247 91 L260 78"
              fill="none" stroke={accent} strokeWidth="2.5"
              strokeLinecap="round" strokeLinejoin="round" strokeOpacity="0.7" />
            <text x={250} y={112} textAnchor="middle"
              fill={accent} fontSize="7" fontWeight="bold"
              fontFamily="system-ui,sans-serif" fillOpacity="0.7">
              All set!
            </text>
          </g>
        </g>

        {/* Label */}
        <text x={250} y={168} textAnchor="middle"
          fill={fg} fontSize="9" fontWeight="bold" fontFamily="system-ui,sans-serif">
          Your Laptop
        </text>

        {/* Progress bar */}
        <ProgressBar y={188} width={460} className="di-progress" />
      </svg>
    </div>
  )
}
