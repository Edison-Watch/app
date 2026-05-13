/**
 * Trifecta defense animation - before/after contrast.
 *
 * Phase 1 (without Edison): Attack succeeds - attacker sends poison email,
 *   email infects agent, agent exfiltrates data to attacker.
 * Phase 2 (with Edison): Email routes through Edison Gateway (which flags it
 *   with a ! warning), agent still gets infected, but when it tries to
 *   exfiltrate, Edison blocks the leak.
 *
 * 10s loop. Pure SVG + CSS. Respects `prefers-reduced-motion`.
 */

import {
  OUTLOOK_SVG, OUTLOOK_SVG_VIEWBOX,
  SLACK_SVG, SLACK_SVG_VIEWBOX,
  GCAL_SVG, GCAL_SVG_VIEWBOX,
} from '../../svg/app-icons-svg'
import {
  ATTACKER_BODY_PATHS,
  ATTACKER_HIGHLIGHT_PATHS,
  ATTACKER_SVG_VIEWBOX,
} from '../../svg/attacker-svg'
import {
  DANGER, EdisonLogo, GREEN as G, POISON_PATH, ProgressBar, RED as R,
  RobotIcon, SHIELD_CHECK_PATH,
} from '../_shared'

const accent = 'var(--accent)'

const CSS = `
.td-anim { color: var(--text-primary); }
.td-anim .td-line { stroke-dashoffset: 0; animation: td-lf 2s linear infinite; }

/* ── Phase visibility ── */
.td-anim .td-p1 { animation: td-p1 10s ease-in-out infinite; }
.td-anim .td-p2 { animation: td-p2 10s ease-in-out infinite; }

/* ── Phase 1: robot states ── */
.td-anim .td-bot1-clean { animation: td-bot1-clean 10s ease-in-out infinite; }
.td-anim .td-bot1-dirty { animation: td-bot1-dirty 10s ease-in-out infinite; }

/* ── Phase 2: robot states ── */
.td-anim .td-bot2-clean { animation: td-bot2-clean 10s ease-in-out infinite; }
.td-anim .td-bot2-dirty { animation: td-bot2-dirty 10s ease-in-out infinite; }

.td-anim .td-eye-pulse  { animation: td-eye-pulse 1.5s ease-in-out infinite; }
.td-anim .td-flash1     { animation: td-flash1 10s ease-in-out infinite; }
.td-anim .td-flash2     { animation: td-flash2 10s ease-in-out infinite; }
.td-anim .td-ring1      { animation: td-ring1 10s ease-in-out infinite; }
.td-anim .td-ring2      { animation: td-ring2 10s ease-in-out infinite; }
.td-anim .td-hl1        { animation: td-hl1 10s ease-in-out infinite; }
.td-anim .td-hl2        { animation: td-hl2 10s ease-in-out infinite; }

/* ── Poison email ── */
.td-anim .td-poison1    { animation: td-poison1 10s ease-in-out infinite; }
.td-anim .td-poison2    { animation: td-poison2 10s ease-in-out infinite; }
.td-anim .td-pglow      { animation: td-pglow 2s ease-in-out infinite; }

/* ── Phase 1 arrows + packets ── */
.td-anim .td-a1-1 { animation: td-a1-1 10s ease-in-out infinite; }
.td-anim .td-pk1-1 { animation: td-pk1-1 10s ease-in-out infinite; }
.td-anim .td-a1-2 { animation: td-a1-2 10s ease-in-out infinite; }
.td-anim .td-pk1-2 { animation: td-pk1-2 10s ease-in-out infinite; }
.td-anim .td-a1-3 { animation: td-a1-3 10s ease-in-out infinite; }
.td-anim .td-pk1-3 { animation: td-pk1-3 10s ease-in-out infinite; }
.td-anim .td-label1 { animation: td-label1 10s ease-in-out infinite; }

/* ── Phase 1 attacker pulse ── */
.td-anim .td-apulse-wrap { animation: td-apulse-vis 10s ease-in-out infinite; }
.td-anim .td-apulse { transform-origin: 396px 28px; animation: td-apulse 1.33s cubic-bezier(.2,.8,.4,1) infinite; }

/* ── Phase 2 arrows + packets ── */
.td-anim .td-a2-1 { animation: td-a2-1 10s ease-in-out infinite; }
.td-anim .td-pk2-1 { animation: td-pk2-1 10s ease-in-out infinite; }
.td-anim .td-a2-2 { animation: td-a2-2 10s ease-in-out infinite; }
.td-anim .td-pk2-2 { animation: td-pk2-2 10s ease-in-out infinite; }
.td-anim .td-a2-3 { animation: td-a2-3 10s ease-in-out infinite; }
.td-anim .td-pk2-3 { animation: td-pk2-3 10s ease-in-out infinite; }
.td-anim .td-a2-4 { animation: td-a2-4 10s ease-in-out infinite; }
.td-anim .td-pk2-4 { animation: td-pk2-4 10s ease-in-out infinite; }

/* ── Edison + shield + block + exclamation ── */
.td-anim .td-edison { animation: td-edison 10s ease-in-out infinite; transform-origin: 267px 24px; }
.td-anim .td-exclaim { animation: td-exclaim 10s ease-in-out infinite; transform-origin: 290px 38px; }
.td-anim .td-shield { animation: td-shield 10s ease-in-out infinite; transform-origin: 267px 24px; }
.td-anim .td-blocked { animation: td-blocked 10s ease-in-out infinite; transform-origin: 236px 23px; }
.td-anim .td-label2 { animation: td-label2 10s ease-in-out infinite; }

.td-anim .td-progress { transform-origin: 20px 188px; animation: td-prog 10s linear infinite; }

/* ═══ KEYFRAMES ═══ */
@keyframes td-lf { to { stroke-dashoffset: -12; } }

/* Phase 1: 0-44%, Phase 2: 48-92% */
@keyframes td-p1 {
  0%     { opacity: 1; }
  44%    { opacity: 1; }
  48%    { opacity: 0; }
  100%   { opacity: 0; }
}
@keyframes td-p2 {
  0%,46% { opacity: 0; }
  50%    { opacity: 1; }
  92%    { opacity: 1; }
  96%    { opacity: 0; }
  100%   { opacity: 0; }
}

/* ── Phase 1 robot ── */
@keyframes td-bot1-clean {
  0%,12% { opacity: 1; }
  16%    { opacity: 0; }
  44%    { opacity: 0; }
  48%    { opacity: 0; }
  100%   { opacity: 0; }
}
@keyframes td-bot1-dirty {
  0%,14% { opacity: 0; }
  18%    { opacity: 1; }
  44%    { opacity: 1; }
  48%    { opacity: 0; }
  100%   { opacity: 0; }
}

/* ── Phase 2 robot ── */
@keyframes td-bot2-clean {
  0%,50% { opacity: 0; }
  52%    { opacity: 1; }
  72%    { opacity: 1; }
  76%    { opacity: 0; }
  92%    { opacity: 0; }
  96%    { opacity: 0; }
  100%   { opacity: 0; }
}
@keyframes td-bot2-dirty {
  0%,74% { opacity: 0; }
  78%    { opacity: 1; }
  92%    { opacity: 1; }
  96%    { opacity: 0; }
  100%   { opacity: 0; }
}

@keyframes td-eye-pulse {
  0%,100% { fill-opacity: 0.5; }
  50%     { fill-opacity: 0.9; }
}

/* ── Phase 1 flash + ring ── */
@keyframes td-flash1 {
  0%,14% { fill-opacity: 0; }
  17%    { fill-opacity: 0.15; }
  20%    { fill-opacity: 0; }
  100%   { fill-opacity: 0; }
}
@keyframes td-ring1 {
  0%,14% { stroke: var(--text-muted); stroke-opacity: 0.35; }
  17%    { stroke: ${R}; stroke-opacity: 0.7; }
  22%    { stroke: var(--text-muted); stroke-opacity: 0.35; }
  100%   { stroke: var(--text-muted); stroke-opacity: 0.35; }
}
@keyframes td-hl1 {
  0%,20% { opacity: 0; }
  24%    { opacity: 0.4; }
  40%    { opacity: 0.4; }
  44%    { opacity: 0; }
  100%   { opacity: 0; }
}

/* ── Phase 2 flash + ring ── */
@keyframes td-flash2 {
  0%,74% { fill-opacity: 0; }
  77%    { fill-opacity: 0.15; }
  80%    { fill-opacity: 0; }
  100%   { fill-opacity: 0; }
}
@keyframes td-ring2 {
  0%,74% { stroke: var(--text-muted); stroke-opacity: 0.35; }
  77%    { stroke: ${R}; stroke-opacity: 0.7; }
  82%    { stroke: var(--text-muted); stroke-opacity: 0.35; }
  100%   { stroke: var(--text-muted); stroke-opacity: 0.35; }
}
@keyframes td-hl2 {
  0%,78% { opacity: 0; }
  80%    { opacity: 0.4; }
  90%    { opacity: 0.4; }
  92%    { opacity: 0; }
  100%   { opacity: 0; }
}

/* ── Poison email ── */
@keyframes td-poison1 {
  0%,4%  { opacity: 0; }
  8%     { opacity: 1; }
  44%    { opacity: 1; }
  48%    { opacity: 0; }
  100%   { opacity: 0; }
}
@keyframes td-poison2 {
  0%,54% { opacity: 0; }
  58%    { opacity: 1; }
  92%    { opacity: 1; }
  96%    { opacity: 0; }
  100%   { opacity: 0; }
}
@keyframes td-pglow {
  0%,100% { fill-opacity: 0.1; }
  50%     { fill-opacity: 0.25; }
}

/* ═══ PHASE 1 ARROWS + PACKETS ═══ */

/* P1 Arrow 1: Attacker → Email */
@keyframes td-a1-1 {
  0%,4%  { opacity: 0; }
  8%     { opacity: 1; }
  44%    { opacity: 1; }
  48%    { opacity: 0; }
  100%   { opacity: 0; }
}
@keyframes td-pk1-1 {
  0%,5%  { transform: translate(374px, 44px); opacity: 0; }
  7%     { transform: translate(374px, 44px); opacity: .8; }
  11%    { transform: translate(288px, 118px); opacity: 1; }
  13%    { transform: translate(288px, 118px); opacity: 0; }
  100%   { opacity: 0; }
}

/* P1 Arrow 2: Email → Laptop */
@keyframes td-a1-2 {
  0%,10% { opacity: 0; }
  14%    { opacity: 1; }
  44%    { opacity: 1; }
  48%    { opacity: 0; }
  100%   { opacity: 0; }
}
@keyframes td-pk1-2 {
  0%,11% { transform: translate(248px, 130px); opacity: 0; }
  13%    { transform: translate(248px, 130px); opacity: .8; }
  17%    { transform: translate(158px, 54px); opacity: 1; }
  19%    { transform: translate(158px, 54px); opacity: 0; }
  100%   { opacity: 0; }
}

/* P1 Arrow 3: Laptop → Attacker (data leaked!) */
@keyframes td-a1-3 {
  0%,20% { opacity: 0; }
  24%    { opacity: 1; }
  44%    { opacity: 1; }
  48%    { opacity: 0; }
  100%   { opacity: 0; }
}
@keyframes td-pk1-3 {
  0%,24% { transform: translate(158px, 26px); opacity: 0; }
  26%    { transform: translate(158px, 26px); opacity: .8; }
  32%    { transform: translate(376px, 24px); opacity: 1; }
  34%    { transform: translate(376px, 24px); opacity: 0; }
  36%    { transform: translate(158px, 26px); opacity: 0; }
  37%    { transform: translate(158px, 26px); opacity: .8; }
  42%    { transform: translate(376px, 24px); opacity: 1; }
  44%    { transform: translate(376px, 24px); opacity: 0; }
  100%   { opacity: 0; }
}

/* P1 attacker pulse */
@keyframes td-apulse-vis {
  0%,28% { opacity: 0; }
  32%    { opacity: 1; }
  42%    { opacity: 1; }
  46%    { opacity: 0; }
  100%   { opacity: 0; }
}
@keyframes td-apulse {
  0%   { transform: scale(1);   opacity: 0; }
  10%  { transform: scale(1);   opacity: .35; }
  60%  { transform: scale(1.6); opacity: 0; }
  100% { transform: scale(1.6); opacity: 0; }
}

/* P1 warning label */
@keyframes td-label1 {
  0%,28% { opacity: 0; }
  32%    { opacity: 1; }
  42%    { opacity: 1; }
  46%    { opacity: 0; }
  100%   { opacity: 0; }
}

/* ═══ PHASE 2 ARROWS + PACKETS ═══ */

/* P2 Arrow 1: Attacker → Email */
@keyframes td-a2-1 {
  0%,54% { opacity: 0; }
  58%    { opacity: 1; }
  92%    { opacity: 1; }
  96%    { opacity: 0; }
  100%   { opacity: 0; }
}
@keyframes td-pk2-1 {
  0%,55% { transform: translate(374px, 44px); opacity: 0; }
  57%    { transform: translate(374px, 44px); opacity: .8; }
  61%    { transform: translate(288px, 118px); opacity: 1; }
  63%    { transform: translate(288px, 118px); opacity: 0; }
  100%   { opacity: 0; }
}

/* P2 Arrow 2: Email → Edison */
@keyframes td-a2-2 {
  0%,60% { opacity: 0; }
  64%    { opacity: 1; }
  92%    { opacity: 1; }
  96%    { opacity: 0; }
  100%   { opacity: 0; }
}
@keyframes td-pk2-2 {
  0%,61% { transform: translate(268px, 130px); opacity: 0; }
  63%    { transform: translate(268px, 130px); opacity: .8; }
  67%    { transform: translate(267px, 42px); opacity: 1; }
  69%    { transform: translate(267px, 42px); opacity: 0; }
  100%   { opacity: 0; }
}

/* P2 Arrow 3: Edison → Laptop (with ! warning) */
@keyframes td-a2-3 {
  0%,66% { opacity: 0; }
  70%    { opacity: 1; }
  92%    { opacity: 1; }
  96%    { opacity: 0; }
  100%   { opacity: 0; }
}
@keyframes td-pk2-3 {
  0%,67% { transform: translate(245px, 24px); opacity: 0; }
  69%    { transform: translate(245px, 24px); opacity: .8; }
  73%    { transform: translate(158px, 36px); opacity: 1; }
  75%    { transform: translate(158px, 36px); opacity: 0; }
  100%   { opacity: 0; }
}

/* P2 Arrow 4: Laptop → Edison (exfiltration attempt, blocked) */
@keyframes td-a2-4 {
  0%,76% { opacity: 0; }
  80%    { opacity: 1; }
  92%    { opacity: 1; }
  96%    { opacity: 0; }
  100%   { opacity: 0; }
}
@keyframes td-pk2-4 {
  0%,77% { transform: translate(158px, 26px); opacity: 0; }
  79%    { transform: translate(158px, 26px); opacity: .8; }
  84%    { transform: translate(250px, 22px); opacity: 1; }
  86%    { transform: translate(250px, 22px); opacity: 0; }
  100%   { opacity: 0; }
}

/* Edison fades in between phases */
@keyframes td-edison {
  0%,44% { opacity: 0; transform: scale(0.85); }
  50%    { opacity: 1; transform: scale(1); }
  92%    { opacity: 1; transform: scale(1); }
  96%    { opacity: 0; transform: scale(1); }
  100%   { opacity: 0; }
}

/* Exclamation ! pops in when email passes through Edison */
@keyframes td-exclaim {
  0%,66% { opacity: 0; transform: scale(0.5); }
  69%    { opacity: 1; transform: scale(1.15); }
  71%    { opacity: 1; transform: scale(1); }
  78%    { opacity: 1; transform: scale(1); }
  80%    { opacity: 0; transform: scale(1); }
  100%   { opacity: 0; }
}

/* Shield pops in when packet blocked */
@keyframes td-shield {
  0%,84% { opacity: 0; transform: scale(0.5); }
  87%    { opacity: 1; transform: scale(1.1); }
  89%    { opacity: 1; transform: scale(1); }
  92%    { opacity: 1; transform: scale(1); }
  96%    { opacity: 0; transform: scale(1); }
  100%   { opacity: 0; }
}

/* Red X badge */
@keyframes td-blocked {
  0%,85% { opacity: 0; transform: scale(0.5); }
  88%    { opacity: 1; transform: scale(1.1); }
  90%    { opacity: 1; transform: scale(1); }
  92%    { opacity: 1; transform: scale(1); }
  96%    { opacity: 0; transform: scale(1); }
  100%   { opacity: 0; }
}

/* P2 success label */
@keyframes td-label2 {
  0%,85% { opacity: 0; }
  88%    { opacity: 1; }
  92%    { opacity: 1; }
  96%    { opacity: 0; }
  100%   { opacity: 0; }
}

@keyframes td-prog {
  0%   { transform: scaleX(0); }
  100% { transform: scaleX(1); }
}

@media (prefers-reduced-motion: reduce) {
  .td-anim .td-line,
  .td-anim .td-p1, .td-anim .td-p2,
  .td-anim .td-bot1-clean, .td-anim .td-bot1-dirty,
  .td-anim .td-bot2-clean, .td-anim .td-bot2-dirty,
  .td-anim .td-eye-pulse, .td-anim .td-flash1, .td-anim .td-flash2,
  .td-anim .td-ring1, .td-anim .td-ring2,
  .td-anim .td-hl1, .td-anim .td-hl2,
  .td-anim .td-poison1, .td-anim .td-poison2, .td-anim .td-pglow,
  .td-anim .td-a1-1, .td-anim .td-pk1-1,
  .td-anim .td-a1-2, .td-anim .td-pk1-2,
  .td-anim .td-a1-3, .td-anim .td-pk1-3,
  .td-anim .td-a2-1, .td-anim .td-pk2-1,
  .td-anim .td-a2-2, .td-anim .td-pk2-2,
  .td-anim .td-a2-3, .td-anim .td-pk2-3,
  .td-anim .td-a2-4, .td-anim .td-pk2-4,
  .td-anim .td-apulse, .td-anim .td-apulse-wrap,
  .td-anim .td-edison, .td-anim .td-exclaim,
  .td-anim .td-shield, .td-anim .td-blocked,
  .td-anim .td-label1, .td-anim .td-label2 { animation: none; }
  .td-anim .td-p1 { opacity: 0; }
  .td-anim .td-p2 { opacity: 1; }
  .td-anim .td-bot1-clean, .td-anim .td-bot1-dirty { opacity: 0; }
  .td-anim .td-bot2-clean { opacity: 0; }
  .td-anim .td-bot2-dirty { opacity: 1; }
  .td-anim .td-poison1 { opacity: 0; }
  .td-anim .td-poison2 { opacity: 1; }
  .td-anim .td-edison { opacity: 1; transform: scale(1); }
  .td-anim .td-exclaim { opacity: 0; }
  .td-anim .td-shield { opacity: 1; transform: scale(1); }
  .td-anim .td-blocked { opacity: 1; transform: scale(1); }
  .td-anim .td-label1 { opacity: 0; }
  .td-anim .td-label2 { opacity: 1; }
  .td-anim .td-a1-1, .td-anim .td-a1-2, .td-anim .td-a1-3 { opacity: 0; }
  .td-anim .td-pk1-1, .td-anim .td-pk1-2, .td-anim .td-pk1-3 { opacity: 0; }
  .td-anim .td-apulse-wrap { opacity: 0; }
  .td-anim .td-hl1 { opacity: 0; }
  .td-anim .td-a2-1, .td-anim .td-a2-2, .td-anim .td-a2-3, .td-anim .td-a2-4 { opacity: 1; }
  .td-anim .td-pk2-1, .td-anim .td-pk2-2, .td-anim .td-pk2-3, .td-anim .td-pk2-4 { opacity: 0; }
  .td-anim .td-hl2 { opacity: 0.4; }
  .td-anim .td-progress { animation: none; transform: scaleX(1); }
}
`

export default function TrifectaDefenseAnimation(): React.ReactNode {
  return (
    <div className="flex justify-center">
      <style>{CSS}</style>
      <svg
        className="td-anim"
        viewBox="0 0 500 190"
        style={{ width: '100%', maxWidth: 500, height: 'auto' }}
        xmlns="http://www.w3.org/2000/svg"
        role="presentation"
        aria-hidden="true"
      >
        <defs>
          <marker id="td-arrR" viewBox="0 0 10 10" refX="9" refY="5"
            markerWidth="5" markerHeight="5" orient="auto">
            <path d="M0 1 L9 5 L0 9 Z" fill={R} fillOpacity={0.5} />
          </marker>
        </defs>

        {/* ===== LAPTOP (always visible) ===== */}
        <g>
          {/* Phase 1 ring */}
          <rect className="td-ring1" x="8" y="12" width="150" height="82" rx="6"
            fill="var(--text-primary)" fillOpacity="0.03"
            stroke="var(--text-muted)" strokeOpacity="0.35" strokeWidth="1.5" />
          {/* Phase 2 ring (layered on top) */}
          <rect className="td-ring2" x="8" y="12" width="150" height="82" rx="6"
            fill="none"
            stroke="var(--text-muted)" strokeOpacity="0" strokeWidth="1.5" />
        </g>
        <rect x="4" y="96" width="158" height="7" rx="3.5"
          fill="var(--text-primary)" fillOpacity="0.04"
          stroke="var(--text-muted)" strokeOpacity="0.35" strokeWidth="1" />

        {/* Phase 1 robot states */}
        <g className="td-bot1-clean">
          <RobotIcon x={61} y={15} size={40} fill={G} fillOpacity="0.55" />
        </g>
        <g className="td-bot1-dirty">
          <RobotIcon x={61} y={15} size={40} fill={R} fillOpacity="0.6" />
          <circle className="td-eye-pulse" cx="76.6" cy="39.4" r="2.4" fill={R} fillOpacity="0.7" />
          <circle className="td-eye-pulse" cx="85.4" cy="39.4" r="2.4" fill={R} fillOpacity="0.7" />
          <svg x="104" y="18" width="28" height="28" viewBox="0 0 48 48">
            <path d={POISON_PATH} fill={R} fillOpacity="0.6" fillRule="evenodd" />
          </svg>
        </g>

        {/* Phase 2 robot states */}
        <g className="td-bot2-clean">
          <RobotIcon x={61} y={15} size={40} fill={G} fillOpacity="0.55" />
        </g>
        <g className="td-bot2-dirty">
          <RobotIcon x={61} y={15} size={40} fill={R} fillOpacity="0.6" />
          <circle className="td-eye-pulse" cx="76.6" cy="39.4" r="2.4" fill={R} fillOpacity="0.7" />
          <circle className="td-eye-pulse" cx="85.4" cy="39.4" r="2.4" fill={R} fillOpacity="0.7" />
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

        {/* App highlight overlays (per phase) */}
        <rect className="td-hl1" x="34" y="58" width="84" height="24" rx="5" fill={R} />
        <rect className="td-hl2" x="34" y="58" width="84" height="24" rx="5" fill={R} />

        {/* Laptop flash (per phase) */}
        <rect className="td-flash1" x="8" y="12" width="150" height="82" rx="6" fill={R} fillOpacity="0" />
        <rect className="td-flash2" x="8" y="12" width="150" height="82" rx="6" fill={R} fillOpacity="0" />

        {/* ===== ATTACKER (top-right, always visible) ===== */}
        <g className="td-apulse-wrap">
          <circle className="td-apulse" cx="396" cy="28" r="25"
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

        {/* ===== MALICIOUS EMAIL (per phase) ===== */}
        <g className="td-poison1">
          <circle className="td-pglow" cx="268" cy="132" r="30" fill={R} fillOpacity="0.06" />
          <rect x="244" y="114" width="48" height="34" rx="3"
            fill="var(--text-primary)" fillOpacity="0.06"
            stroke={R} strokeOpacity="0.25" strokeWidth="1.2" />
          <path d="M244,114 L268,134 L292,114"
            fill="none" stroke={R} strokeOpacity="0.25" strokeWidth="1.2" strokeLinejoin="round" />
          <circle cx="290" cy="144" r="13"
            fill="var(--text-primary)" fillOpacity="0.12"
            stroke={R} strokeOpacity="0.35" strokeWidth="0.8" />
          <svg x="278" y="132" width="24" height="24" viewBox="0 0 48 48">
            <path d={POISON_PATH} fill={R} fillOpacity="0.65" fillRule="evenodd" />
          </svg>
        </g>
        <g className="td-poison2">
          <circle className="td-pglow" cx="268" cy="132" r="30" fill={R} fillOpacity="0.06" />
          <rect x="244" y="114" width="48" height="34" rx="3"
            fill="var(--text-primary)" fillOpacity="0.06"
            stroke={R} strokeOpacity="0.25" strokeWidth="1.2" />
          <path d="M244,114 L268,134 L292,114"
            fill="none" stroke={R} strokeOpacity="0.25" strokeWidth="1.2" strokeLinejoin="round" />
          <circle cx="290" cy="144" r="13"
            fill="var(--text-primary)" fillOpacity="0.12"
            stroke={R} strokeOpacity="0.35" strokeWidth="0.8" />
          <svg x="278" y="132" width="24" height="24" viewBox="0 0 48 48">
            <path d={POISON_PATH} fill={R} fillOpacity="0.65" fillRule="evenodd" />
          </svg>
        </g>

        {/* ═══ PHASE 1 ARROWS ═══ */}
        <g className="td-a1-1">
          <line className="td-line" x1="374" y1="44" x2="290" y2="116"
            stroke={R} strokeOpacity="0.35" strokeWidth="1.5"
            strokeDasharray="3 3" markerEnd="url(#td-arrR)" />
        </g>
        <g className="td-a1-2">
          <line className="td-line" x1="246" y1="130" x2="158" y2="54"
            stroke={R} strokeOpacity="0.4" strokeWidth="1.5"
            strokeDasharray="3 3" markerEnd="url(#td-arrR)" />
        </g>
        <g className="td-a1-3">
          <line className="td-line" x1="158" y1="26" x2="376" y2="22"
            stroke={R} strokeOpacity="0.4" strokeWidth="1.5"
            strokeDasharray="3 3" markerEnd="url(#td-arrR)" />
        </g>

        {/* Phase 1 packets */}
        <g className="td-pk1-1">
          <rect x="-12" y="-8" width="24" height="16" rx="2"
            fill={R} fillOpacity="0.25" stroke={R} strokeOpacity="0.5" strokeWidth="1" />
          <path d="M-12,-8 L0,2 L12,-8"
            fill="none" stroke={R} strokeOpacity="0.6" strokeWidth="1" strokeLinejoin="round" />
        </g>
        <g className="td-pk1-2">
          <rect x="-10" y="-7" width="20" height="14" rx="2"
            fill={R} fillOpacity="0.25" stroke={R} strokeOpacity="0.5" strokeWidth="0.8" />
          <path d="M-10,-7 L0,1 L10,-7"
            fill="none" stroke={R} strokeOpacity="0.6" strokeWidth="0.8" strokeLinejoin="round" />
        </g>
        <g className="td-pk1-3">
          <rect x="-10" y="-7" width="20" height="14" rx="2"
            fill={R} fillOpacity="0.25" stroke={R} strokeOpacity="0.5" strokeWidth="0.8" />
          <path d="M-10,-7 L0,1 L10,-7"
            fill="none" stroke={R} strokeOpacity="0.6" strokeWidth="0.8" strokeLinejoin="round" />
        </g>

        {/* Phase 1 warning label */}
        <g className="td-label1">
          <text x="267" y="16" textAnchor="middle"
            fill={R} fontSize="8" fontWeight="600" fontFamily="system-ui,sans-serif" opacity="0.8">
            The AI leaked sensitive data
          </text>
        </g>

        {/* ═══ EDISON GATEWAY (fades in between phases) ═══ */}
        <g className="td-edison">
          <rect x="245" y="4" width="44" height="38" rx="6"
            fill="var(--text-primary)" fillOpacity="0.05"
            stroke={accent} strokeOpacity="0.4" strokeWidth="1.2" />
          <EdisonLogo x={255} y={8} w={24} h={23} />
        </g>

        {/* ═══ PHASE 2 ARROWS ═══ */}
        {/* P2 Arrow 1: Attacker → Email */}
        <g className="td-a2-1">
          <line className="td-line" x1="374" y1="44" x2="290" y2="116"
            stroke={R} strokeOpacity="0.35" strokeWidth="1.5"
            strokeDasharray="3 3" markerEnd="url(#td-arrR)" />
        </g>
        {/* P2 Arrow 2: Email → Edison */}
        <g className="td-a2-2">
          <line className="td-line" x1="268" y1="114" x2="267" y2="44"
            stroke={R} strokeOpacity="0.4" strokeWidth="1.5"
            strokeDasharray="3 3" markerEnd="url(#td-arrR)" />
        </g>
        {/* P2 Arrow 3: Edison → Laptop */}
        <g className="td-a2-3">
          <line className="td-line" x1="245" y1="24" x2="158" y2="36"
            stroke={R} strokeOpacity="0.4" strokeWidth="1.5"
            strokeDasharray="3 3" markerEnd="url(#td-arrR)" />
        </g>
        {/* P2 Arrow 4: Laptop → Edison (exfiltration attempt) */}
        <g className="td-a2-4">
          <line className="td-line" x1="158" y1="26" x2="248" y2="22"
            stroke={R} strokeOpacity="0.4" strokeWidth="1.5"
            strokeDasharray="3 3" markerEnd="url(#td-arrR)" />
        </g>

        {/* Phase 2 packets */}
        <g className="td-pk2-1">
          <rect x="-12" y="-8" width="24" height="16" rx="2"
            fill={R} fillOpacity="0.25" stroke={R} strokeOpacity="0.5" strokeWidth="1" />
          <path d="M-12,-8 L0,2 L12,-8"
            fill="none" stroke={R} strokeOpacity="0.6" strokeWidth="1" strokeLinejoin="round" />
        </g>
        <g className="td-pk2-2">
          <rect x="-10" y="-7" width="20" height="14" rx="2"
            fill={R} fillOpacity="0.25" stroke={R} strokeOpacity="0.5" strokeWidth="0.8" />
          <path d="M-10,-7 L0,1 L10,-7"
            fill="none" stroke={R} strokeOpacity="0.6" strokeWidth="0.8" strokeLinejoin="round" />
        </g>
        <g className="td-pk2-3">
          <rect x="-10" y="-7" width="20" height="14" rx="2"
            fill={R} fillOpacity="0.25" stroke={R} strokeOpacity="0.5" strokeWidth="0.8" />
          <path d="M-10,-7 L0,1 L10,-7"
            fill="none" stroke={R} strokeOpacity="0.6" strokeWidth="0.8" strokeLinejoin="round" />
        </g>
        <g className="td-pk2-4">
          <rect x="-10" y="-7" width="20" height="14" rx="2"
            fill={R} fillOpacity="0.25" stroke={R} strokeOpacity="0.5" strokeWidth="0.8" />
          <path d="M-10,-7 L0,1 L10,-7"
            fill="none" stroke={R} strokeOpacity="0.6" strokeWidth="0.8" strokeLinejoin="round" />
        </g>

        {/* Exclamation ! badge (appears when email passes through Edison) */}
        <g className="td-exclaim" style={{ transformOrigin: '290px 38px' }}>
          <circle cx="290" cy="38" r="8"
            fill="var(--text-primary)" fillOpacity="0.08" stroke={R} strokeOpacity="0.6" strokeWidth="1.2" />
          <text x="290" y="42" textAnchor="middle"
            fill={R} fontSize="12" fontWeight="bold" fontFamily="system-ui,sans-serif">!</text>
        </g>

        {/* Shield check (accent) */}
        <g className="td-shield" style={{ transformOrigin: '267px 24px' }}>
          <svg x="253" y="28" width="28" height="28" viewBox="0 0 256 256">
            <path d={SHIELD_CHECK_PATH} fill={accent} fillOpacity="0.7" />
          </svg>
        </g>

        {/* Red X denied badge (left of Edison) */}
        <g className="td-blocked" style={{ transformOrigin: '236px 23px' }}>
          <circle cx="236" cy="23" r="9"
            fill={DANGER} fillOpacity="0.12" stroke={DANGER} strokeOpacity="0.5" strokeWidth="1" />
          <line x1="232" y1="19" x2="240" y2="27" stroke={DANGER} strokeWidth="1.8" strokeLinecap="round" />
          <line x1="240" y1="19" x2="232" y2="27" stroke={DANGER} strokeWidth="1.8" strokeLinecap="round" />
        </g>

        {/* Phase 2 success label */}
        <g className="td-label2">
          <text x="340" y="16" textAnchor="middle"
            fill={accent} fontSize="8" fontWeight="600" fontFamily="system-ui,sans-serif" opacity="0.9">
            Edison blocked the leak
          </text>
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
        <g className="td-poison1">
          <text x="268" y="162" textAnchor="middle"
            fill="var(--text-primary)" fontSize="8" fontWeight="bold" fontFamily="system-ui,sans-serif">
            Malicious Email with jailbreak instructions
          </text>
        </g>
        <g className="td-poison2">
          <text x="268" y="162" textAnchor="middle"
            fill="var(--text-primary)" fontSize="8" fontWeight="bold" fontFamily="system-ui,sans-serif">
            Malicious Email with jailbreak instructions
          </text>
        </g>

        <ProgressBar y={188} width={460} className="td-progress" />
      </svg>
    </div>
  )
}
