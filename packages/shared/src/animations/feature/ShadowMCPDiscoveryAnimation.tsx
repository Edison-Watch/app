/**
 * Shadow-connector discovery (illumination) animation.
 *
 * Dramatises how unapproved "shadow" connectors sit invisible in a
 * client's config until Edison sweeps a beam of light across them and
 * brings each into the inventory with a verdict.
 *
 * Three acts (12s loop), narration carried by visual cues alone:
 *   1. Dark: an admin watches a field of barely-visible connector icons
 *      (faint paperclips with "?" badges) - present but invisible to IT.
 *      The admin is blind: eye-slash, "No visibility", and red dashed
 *      blind rays reach toward the unseen connectors (metaphor E, lifted
 *      from admin/AdminFleetBlindAnimation#AdminNoVisibilityOverlay).
 *   2. Ignite: the Edison light source switches on; an ambient glow grows
 *      out from the logo and the admin's eye opens ("Full visibility").
 *   3. Sweep: a bright light beam travels left -> right. As the wavefront
 *      reaches each column, those connectors light up - icon brightens to
 *      accent, name appears, and a verdict badge pops in (approve / block).
 *
 * Metaphors E (visibility eye-swap) + F (shadow connectors). 12s loop.
 * Pure SVG + CSS. Respects `prefers-reduced-motion`.
 *
 * Requires CSS custom properties: --text-primary, --text-muted, --accent.
 */
import {
  ADMIN_PATH,
  DANGER,
  EYE_PATH,
  EYE_SLASH_PATH,
  EdisonLogo,
  McpIcon,
  ProgressBar,
  VerdictBadge,
} from "../_shared";

const fg = "var(--text-primary)";
const muted = "var(--text-muted)";
const accent = "var(--accent)";

const CSS = `
.smd-anim { color: ${fg}; }

/* Edison light source: only visible once it switches on */
.smd-anim .smd-edison { animation: smd-edison 12s ease-in-out infinite; }

/* Edison light source: continuous soft pulse ring */
.smd-anim .smd-pulse { transform-origin: 58px 100px; animation: smd-pulse 1.8s cubic-bezier(.2,.8,.4,1) infinite; }

/* Ambient illumination that grows out from Edison */
.smd-anim .smd-glow  { transform-origin: 58px 100px; animation: smd-glow 12s ease-in-out infinite; }

/* Sweeping light beam */
.smd-anim .smd-beam  { animation: smd-beam 12s ease-in-out infinite; }

/* Per-column reveal: dark layer hides, lit layer appears as beam passes */
.smd-anim .smd-d1 { animation: smd-d1 12s ease-in-out infinite; }
.smd-anim .smd-r1 { animation: smd-r1 12s ease-in-out infinite; }
.smd-anim .smd-d2 { animation: smd-d2 12s ease-in-out infinite; }
.smd-anim .smd-r2 { animation: smd-r2 12s ease-in-out infinite; }
.smd-anim .smd-d3 { animation: smd-d3 12s ease-in-out infinite; }
.smd-anim .smd-r3 { animation: smd-r3 12s ease-in-out infinite; }

/* Visibility eye swap */
.smd-anim .smd-eslash { animation: smd-eslash 12s ease-in-out infinite; }
.smd-anim .smd-eye    { animation: smd-eye 12s ease-in-out infinite; }

.smd-anim .smd-progress { transform-origin: 20px 214px; animation: smd-prog 12s linear infinite; }

/* ----- keyframes ----- */

@keyframes smd-edison {
  0%,16% { opacity: 0; }
  26%    { opacity: 1; }
  96%    { opacity: 1; }
  100%   { opacity: 0; }
}

@keyframes smd-pulse {
  0%   { transform: scale(1);   opacity: 0; }
  12%  { transform: scale(1);   opacity: .4; }
  70%  { transform: scale(1.8); opacity: 0; }
  100% { transform: scale(1.8); opacity: 0; }
}

@keyframes smd-glow {
  0%,16% { transform: scale(.2);  opacity: 0; }
  30%    { transform: scale(1);   opacity: .45; }
  92%    { transform: scale(1.05); opacity: .45; }
  100%   { transform: scale(1.05); opacity: 0; }
}

@keyframes smd-beam {
  0%,24% { transform: translateX(120px); opacity: 0; }
  28%    { transform: translateX(150px); opacity: .9; }
  70%    { transform: translateX(515px); opacity: .9; }
  74%    { transform: translateX(540px); opacity: 0; }
  100%   { transform: translateX(540px); opacity: 0; }
}

/* Column 1 (~38%) */
@keyframes smd-d1 { 0%,34% { opacity: 1; } 40% { opacity: 0; } 96% { opacity: 0; } 100% { opacity: 1; } }
@keyframes smd-r1 { 0%,34% { opacity: 0; } 42% { opacity: 1; } 96% { opacity: 1; } 100% { opacity: 0; } }
/* Column 2 (~50%) */
@keyframes smd-d2 { 0%,46% { opacity: 1; } 52% { opacity: 0; } 96% { opacity: 0; } 100% { opacity: 1; } }
@keyframes smd-r2 { 0%,46% { opacity: 0; } 54% { opacity: 1; } 96% { opacity: 1; } 100% { opacity: 0; } }
/* Column 3 (~62%) */
@keyframes smd-d3 { 0%,58% { opacity: 1; } 64% { opacity: 0; } 96% { opacity: 0; } 100% { opacity: 1; } }
@keyframes smd-r3 { 0%,58% { opacity: 0; } 66% { opacity: 1; } 96% { opacity: 1; } 100% { opacity: 0; } }

@keyframes smd-eslash { 0%,26% { opacity: 1; } 34% { opacity: 0; } 96% { opacity: 0; } 100% { opacity: 1; } }
@keyframes smd-eye    { 0%,34% { opacity: 0; } 42% { opacity: 1; } 96% { opacity: 1; } 100% { opacity: 0; } }

@keyframes smd-prog { 0% { transform: scaleX(0); } 100% { transform: scaleX(1); } }

@media (prefers-reduced-motion: reduce) {
  .smd-anim .smd-edison, .smd-anim .smd-pulse, .smd-anim .smd-glow, .smd-anim .smd-beam,
  .smd-anim .smd-d1, .smd-anim .smd-r1, .smd-anim .smd-d2, .smd-anim .smd-r2,
  .smd-anim .smd-d3, .smd-anim .smd-r3, .smd-anim .smd-eslash, .smd-anim .smd-eye { animation: none; }
  .smd-anim .smd-edison { opacity: 1; }
  .smd-anim .smd-pulse { opacity: 0; }
  .smd-anim .smd-glow  { opacity: .4; transform: scale(1); }
  .smd-anim .smd-beam  { opacity: 0; }
  .smd-anim .smd-d1, .smd-anim .smd-d2, .smd-anim .smd-d3 { opacity: 0; }
  .smd-anim .smd-r1, .smd-anim .smd-r2, .smd-anim .smd-r3 { opacity: 1; }
  .smd-anim .smd-eslash { opacity: 0; }
  .smd-anim .smd-eye { opacity: 1; }
  .smd-anim .smd-progress { animation: none; transform: scaleX(1); }
}
`;

const CELL_W = 108;
const CELL_H = 56;

/** Dark, unknown connector - faint paperclip + "?" badge, no name. */
function DarkConnector({
  cx,
  cy,
  col,
}: {
  cx: number;
  cy: number;
  col: 1 | 2 | 3;
}): React.ReactNode {
  return (
    <g className={`smd-d${col}`}>
      <rect
        x={cx}
        y={cy}
        width={CELL_W}
        height={CELL_H}
        rx={6}
        fill={fg}
        fillOpacity="0.015"
        stroke={muted}
        strokeOpacity="0.18"
        strokeWidth="1"
        strokeDasharray="3 3"
      />
      <McpIcon x={cx + 12} y={cy + 18} size={20} color={muted} opacity="0.16" />
      <text
        x={cx + 78}
        y={cy + 35}
        textAnchor="middle"
        fill={muted}
        fillOpacity="0.3"
        fontSize="18"
        fontWeight="bold"
        fontFamily="system-ui,sans-serif"
      >
        ?
      </text>
    </g>
  );
}

/** Illuminated connector - bright paperclip + name + verdict badge. */
function LitConnector({
  cx,
  cy,
  col,
  name,
  blocked,
}: {
  cx: number;
  cy: number;
  col: 1 | 2 | 3;
  name: string;
  blocked?: boolean;
}): React.ReactNode {
  const c = blocked ? DANGER : accent;
  return (
    <g className={`smd-r${col}`}>
      <rect
        x={cx}
        y={cy}
        width={CELL_W}
        height={CELL_H}
        rx={6}
        fill={c}
        fillOpacity="0.04"
        stroke={c}
        strokeOpacity="0.4"
        strokeWidth="1.2"
      />
      <McpIcon x={cx + 12} y={cy + 11} size={20} color={c} opacity="0.7" />
      <text
        x={cx + 12}
        y={cy + 47}
        fill={c}
        fillOpacity="0.85"
        fontSize="8.5"
        fontWeight="600"
        fontFamily="ui-monospace,monospace"
      >
        {name}
      </text>
      <VerdictBadge
        cx={cx + 90}
        cy={cy + 16}
        r={8}
        variant={blocked ? "deny" : "allow"}
      />
    </g>
  );
}

/** A connector cell: dark layer + lit layer stacked at the same spot. */
function Connector(props: {
  cx: number;
  cy: number;
  col: 1 | 2 | 3;
  name: string;
  blocked?: boolean;
}): React.ReactNode {
  return (
    <>
      <DarkConnector cx={props.cx} cy={props.cy} col={props.col} />
      <LitConnector {...props} />
    </>
  );
}

export default function ShadowMCPDiscoveryAnimation(): React.ReactNode {
  // Column x / row y origins for the aligned 3x2 connector grid.
  const COL = [168, 296, 424] as const;
  const ROW = [44, 116] as const;
  return (
    <div style={{ display: "flex", justifyContent: "center" }}>
      <style>{CSS}</style>
      <svg
        className="smd-anim"
        width={560}
        height={222}
        viewBox="0 0 560 222"
        xmlns="http://www.w3.org/2000/svg"
        role="presentation"
        aria-hidden="true"
      >
        <defs>
          <radialGradient id="smd-glow-grad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={accent} stopOpacity="0.32" />
            <stop offset="55%" stopColor={accent} stopOpacity="0.07" />
            <stop offset="100%" stopColor={accent} stopOpacity="0" />
          </radialGradient>
          <linearGradient id="smd-beam-grad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={accent} stopOpacity="0" />
            <stop offset="50%" stopColor={accent} stopOpacity="0.5" />
            <stop offset="100%" stopColor={accent} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Title */}
        <text
          x={350}
          y={15}
          textAnchor="middle"
          fill={fg}
          fontSize="10"
          fontWeight="bold"
          fontFamily="system-ui,sans-serif"
        >
          Connector inventory
        </text>

        {/* Ambient illumination from Edison */}
        <circle
          className="smd-glow"
          cx={58}
          cy={100}
          r={300}
          fill="url(#smd-glow-grad)"
        />

        {/* Admin persona (always present, watching the fleet) */}
        <svg x={45} y={12} width={26} height={26} viewBox="0 0 256 256">
          <path d={ADMIN_PATH} fill={fg} fillOpacity="0.7" />
        </svg>
        <text
          x={58}
          y={50}
          textAnchor="middle"
          fill={fg}
          fontSize="8"
          fontWeight="bold"
          fontFamily="system-ui,sans-serif"
        >
          Admin
        </text>

        {/* BEFORE: admin is blind - eye-slash, "No visibility", red blind rays */}
        <g className="smd-eslash">
          <svg x={75} y={12} width={24} height={24} viewBox="0 0 256 256">
            <path d={EYE_SLASH_PATH} fill={DANGER} fillOpacity="0.7" />
          </svg>
          <text
            x={58}
            y={66}
            textAnchor="middle"
            fill={DANGER}
            fillOpacity="0.65"
            fontSize="8"
            fontFamily="system-ui,sans-serif"
          >
            No visibility
          </text>
          {/* Dashed blind rays reaching toward the (unseen) connectors */}
          {(
            [
              [168, 72],
              [296, 72],
              [424, 72],
              [168, 144],
              [296, 144],
              [424, 144],
            ] as const
          ).map(([rx, ry]) => (
            <line
              key={`${rx}-${ry}`}
              x1={92}
              y1={40}
              x2={rx}
              y2={ry}
              stroke={DANGER}
              strokeOpacity="0.45"
              strokeWidth="1.2"
              strokeDasharray="4 3"
            />
          ))}
        </g>

        {/* AFTER: Edison restores sight - eye opens, "Full visibility" */}
        <g className="smd-eye">
          <svg x={75} y={12} width={24} height={24} viewBox="0 0 256 256">
            <path d={EYE_PATH} fill={accent} fillOpacity="0.8" />
          </svg>
          <text
            x={58}
            y={66}
            textAnchor="middle"
            fill={accent}
            fillOpacity="0.8"
            fontSize="8"
            fontWeight="bold"
            fontFamily="system-ui,sans-serif"
          >
            Full visibility
          </text>
        </g>

        {/* Edison light source (left) - only appears once it switches on */}
        <g className="smd-edison">
          <g className="smd-pulse">
            <circle
              cx={58}
              cy={100}
              r={22}
              fill="none"
              stroke={accent}
              strokeOpacity="0.5"
              strokeWidth="1.5"
            />
          </g>
          <EdisonLogo x={44} y={86} w={28} h={27} />
          <text
            x={58}
            y={134}
            textAnchor="middle"
            fill={fg}
            fontSize="8"
            fontWeight="bold"
            fontFamily="system-ui,sans-serif"
          >
            Edison
          </text>
        </g>

        {/* Connector grid - aligned 3x2; the two blocked connectors sit
            diagonally so they don't read as a single column. */}
        <Connector cx={COL[0]} cy={ROW[0]} col={1} name="notion" />
        <Connector cx={COL[1]} cy={ROW[0]} col={2} name="github" />
        <Connector cx={COL[2]} cy={ROW[0]} col={3} name="web-scraper" blocked />
        <Connector cx={COL[0]} cy={ROW[1]} col={1} name="shadow-tool" blocked />
        <Connector cx={COL[1]} cy={ROW[1]} col={2} name="gdrive" />
        <Connector cx={COL[2]} cy={ROW[1]} col={3} name="slack" />

        {/* Sweeping light beam (travels across the grid) */}
        <g className="smd-beam">
          <rect
            x={0}
            y={36}
            width={44}
            height={146}
            fill="url(#smd-beam-grad)"
          />
        </g>

        {/* Progress bar */}
        <ProgressBar y={214} width={520} className="smd-progress" />
      </svg>
    </div>
  );
}
