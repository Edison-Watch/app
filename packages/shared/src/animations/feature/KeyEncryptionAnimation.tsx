/**
 * Zero-knowledge credential encryption animation for key setup.
 *
 * Shows a laptop with credential cards that get encrypted locally
 * using the user's key, then sent as encrypted blobs to Edison.
 * A large crossed-out eye emphasises zero-knowledge storage.
 *
 * Three acts:
 *   1. Laptop displays credential cards with open padlocks (orange)
 *   2. Key appears -> laptop flashes -> cards transform to locked (accent)
 *   3. Encrypted packet travels to Edison -> big eye with animated
 *      slash shows Edison cannot read the secrets
 *
 * Matches EncryptionAnimation's laptop visual language.
 * 8s loop. Pure SVG + CSS. Respects `prefers-reduced-motion`.
 *
 * Requires CSS custom properties: --text-primary, --accent, --text-muted.
 * Consumers that use different variable names should wrap the component
 * in a container that maps their variables, e.g.:
 *   <div style={{ '--text-primary': 'var(--my-fg)', ... }}>
 *     <KeyEncryptionAnimation />
 *   </div>
 */

import { EDISON_E_PATH, EDISON_FRAME_PATH, EDISON_LOGO_VIEWBOX } from '../../svg/edison-logo-svg'
import { McpIcon, ORANGE, ProgressBar } from '../_shared'

const CSS = `
.ek-anim { color: var(--text-primary); }

/* dashed-line flow */
.ek-anim .ek-line { stroke-dashoffset: 0; animation: ek-lf 2s linear infinite; }

/* packet fill */
.ek-anim .ek-pkt circle { fill: currentColor; }

/* -- phase visibility (8s cycle) -- */

.ek-anim .ek-plain       { animation: ek-plain 8s ease-in-out infinite; }
.ek-anim .ek-enc         { animation: ek-enc 8s ease-in-out infinite; }
.ek-anim .ek-key-icon    { animation: ek-key-persist 8s ease-in-out infinite; transform-origin: 90px -8px; }
.ek-anim .ek-pulse-wrap  { animation: ek-pulse-vis 8s ease-in-out infinite; }
.ek-anim .ek-key-pulse   { transform-origin: 90px -8px; animation: ek-key-pulse 1.5s cubic-bezier(.2,.8,.4,1) infinite; }
.ek-anim .ek-flash       { animation: ek-flash 8s ease-in-out infinite; }
.ek-anim .ek-laptop-ring { animation: ek-laptop-ring 8s ease-in-out infinite; }
.ek-anim .ek-flow        { animation: ek-flow 8s ease-in-out infinite; }
.ek-anim .ek-pkt-main    { color: var(--accent); animation: ek-pkt 8s ease-in-out infinite; }
.ek-anim .ek-vault-content { animation: ek-vault 8s ease-in-out infinite; }
.ek-anim .ek-shield      { animation: ek-shield 8s ease-in-out infinite; transform-origin: 364px -4px; }
.ek-anim .ek-eye         { animation: ek-eye 8s ease-in-out infinite; }
.ek-anim .ek-slash       { stroke-dasharray: 65; stroke-dashoffset: 65; animation: ek-slash 8s ease-in-out infinite; }
.ek-anim .ek-zk          { animation: ek-zk 8s ease-in-out infinite; }
.ek-anim .ek-progress    { transform-origin: 20px 188px; animation: ek-prog 8s linear infinite; }

/* ----- keyframes ----- */

@keyframes ek-lf { to { stroke-dashoffset: -12; } }

/* Readable cards: visible at start, fade during encryption */
@keyframes ek-plain {
  0%,18%   { opacity: 1; }
  30%      { opacity: 0; }
  92%      { opacity: 0; }
  100%     { opacity: 1; }
}

/* Encrypted cards in laptop: appear during encryption */
@keyframes ek-enc {
  0%,20%   { opacity: 0; }
  32%      { opacity: 1; }
  92%      { opacity: 1; }
  100%     { opacity: 0; }
}

/* Key icon: scales in and stays visible until loop reset */
@keyframes ek-key-persist {
  0%,15%   { opacity: 0; transform: scale(0.8); }
  24%      { opacity: 1; transform: scale(1); }
  92%      { opacity: 1; transform: scale(1); }
  100%     { opacity: 0; transform: scale(1); }
}

/* Pulse ring: visible only during encryption phase */
@keyframes ek-pulse-vis {
  0%,15%   { opacity: 0; }
  20%      { opacity: 1; }
  42%      { opacity: 1; }
  50%      { opacity: 0; }
  100%     { opacity: 0; }
}

@keyframes ek-key-pulse {
  0%   { transform: scale(1);   opacity: 0; }
  10%  { transform: scale(1);   opacity: .35; }
  60%  { transform: scale(1.6); opacity: 0; }
  100% { transform: scale(1.6); opacity: 0; }
}

/* Strong accent flash over laptop body */
@keyframes ek-flash {
  0%,20%   { fill-opacity: 0; }
  25%      { fill-opacity: 0.10; }
  30%      { fill-opacity: 0.03; }
  36%,100% { fill-opacity: 0; }
}

/* Laptop border pulses accent during encryption */
@keyframes ek-laptop-ring {
  0%,20%   { stroke: var(--text-muted); stroke-opacity: 0.35; }
  25%      { stroke: var(--accent);     stroke-opacity: 0.7; }
  34%      { stroke: var(--text-muted); stroke-opacity: 0.35; }
  100%     { stroke: var(--text-muted); stroke-opacity: 0.35; }
}

/* Flow line appears after encryption */
@keyframes ek-flow {
  0%,30%   { opacity: 0; }
  38%      { opacity: 1; }
  92%      { opacity: 1; }
  100%     { opacity: 0; }
}

/* Packet travels laptop -> Edison vault */
@keyframes ek-pkt {
  0%,32%   { transform: translate(176px, 71px); opacity: 0; }
  36%      { transform: translate(176px, 71px); opacity: .8; }
  54%      { transform: translate(330px, 71px); opacity: 1; }
  58%      { transform: translate(330px, 71px); opacity: 0; }
  100%     { opacity: 0; }
}

/* Edison vault content appears on packet arrival */
@keyframes ek-vault {
  0%,50%   { opacity: 0; }
  58%      { opacity: 1; }
  92%      { opacity: 1; }
  100%     { opacity: 0; }
}

/* Shield scales in over vault */
@keyframes ek-shield {
  0%,54%   { opacity: 0; transform: scale(0.5); }
  64%      { opacity: 1; transform: scale(1); }
  92%      { opacity: 1; transform: scale(1); }
  100%     { opacity: 0; transform: scale(1); }
}

/* Eye fades in */
@keyframes ek-eye {
  0%,56%   { opacity: 0; }
  64%      { opacity: 1; }
  92%      { opacity: 1; }
  100%     { opacity: 0; }
}

/* Slash draws through eye */
@keyframes ek-slash {
  0%,66%   { stroke-dashoffset: 65; }
  76%      { stroke-dashoffset: 0; }
  92%      { stroke-dashoffset: 0; }
  100%     { stroke-dashoffset: 65; }
}

/* Zero-knowledge text */
@keyframes ek-zk {
  0%,72%   { opacity: 0; }
  80%,90%  { opacity: 1; }
  98%,100% { opacity: 0; }
}

@keyframes ek-prog {
  0%   { transform: scaleX(0); }
  100% { transform: scaleX(1); }
}

@media (prefers-reduced-motion: reduce) {
  .ek-anim .ek-line, .ek-anim .ek-plain,
  .ek-anim .ek-enc, .ek-anim .ek-key-icon,
  .ek-anim .ek-pulse-wrap, .ek-anim .ek-key-pulse,
  .ek-anim .ek-flash, .ek-anim .ek-shield,
  .ek-anim .ek-laptop-ring, .ek-anim .ek-flow,
  .ek-anim .ek-pkt-main, .ek-anim .ek-vault-content,
  .ek-anim .ek-eye, .ek-anim .ek-slash,
  .ek-anim .ek-zk { animation: none; }
  .ek-anim .ek-plain { opacity: 0; }
  .ek-anim .ek-enc { opacity: 1; }
  .ek-anim .ek-key-icon { opacity: 1; transform: scale(1); }
  .ek-anim .ek-pulse-wrap { opacity: 0; }
  .ek-anim .ek-flash { fill-opacity: 0; }
  .ek-anim .ek-laptop-ring { stroke: var(--text-muted); stroke-opacity: 0.35; }
  .ek-anim .ek-pkt-main { opacity: 0; }
  .ek-anim .ek-flow { opacity: 0; }
  .ek-anim .ek-vault-content { opacity: 1; }
  .ek-anim .ek-shield { opacity: 1; transform: scale(1); }
  .ek-anim .ek-eye { opacity: 1; }
  .ek-anim .ek-slash { stroke-dashoffset: 0; }
  .ek-anim .ek-zk { opacity: 1; }
  .ek-anim .ek-progress { animation: none; transform: scaleX(1); }
}
`

/** Small padlock - open variant (shackle disconnected). */
function PadlockOpen({ x, y }: { x: number; y: number }): React.ReactNode {
  return (
    <g>
      <rect
        x={x}
        y={y + 5}
        width="10"
        height="8"
        rx="1.5"
        fill={ORANGE}
        fillOpacity="0.25"
        stroke={ORANGE}
        strokeOpacity="0.35"
        strokeWidth="0.6"
      />
      <path
        d={`M${x + 2.5} ${y + 5}V${y + 2}a2.5 2.5 0 015 0`}
        fill="none"
        stroke={ORANGE}
        strokeWidth="1.2"
        strokeOpacity="0.5"
        strokeLinecap="round"
      />
    </g>
  )
}

/** Small padlock - closed variant (shackle connected). */
function PadlockClosed({ x, y }: { x: number; y: number }): React.ReactNode {
  return (
    <g>
      <rect
        x={x}
        y={y + 5}
        width="10"
        height="8"
        rx="1.5"
        fill="var(--accent)"
        fillOpacity="0.25"
        stroke="var(--accent)"
        strokeOpacity="0.35"
        strokeWidth="0.6"
      />
      <path
        d={`M${x + 2.5} ${y + 5}V${y + 2}a2.5 2.5 0 015 0V${y + 5}`}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="1.2"
        strokeOpacity="0.5"
        strokeLinecap="round"
      />
      {/* keyhole dot */}
      <circle cx={x + 5} cy={y + 9.5} r="1.2" fill="var(--accent)" fillOpacity="0.4" />
    </g>
  )
}

/** Credential card - a rounded-rect "object" with MCP icon + padlock + label. */
function CredentialCard({
  y,
  label,
  locked
}: {
  y: number
  label: string
  locked: boolean
}): React.ReactNode {
  const borderColor = locked ? 'var(--accent)' : ORANGE
  const textColor = locked ? 'var(--accent)' : ORANGE
  return (
    <g>
      <rect
        x="20"
        y={y}
        width="136"
        height="26"
        rx="5"
        fill={locked ? 'var(--accent)' : 'var(--text-primary)'}
        fillOpacity={locked ? 0.03 : 0.04}
        stroke={borderColor}
        strokeOpacity="0.35"
        strokeWidth="1.2"
      />
      <McpIcon
        x={25}
        y={y + 5}
        size={14}
        color={locked ? 'var(--accent)' : ORANGE}
        opacity="0.55"
      />
      {locked ? <PadlockClosed x={42} y={y + 2} /> : <PadlockOpen x={42} y={y + 2} />}
      <text
        x={57}
        y={y + 16}
        fontSize="7.5"
        fontWeight="600"
        fill={textColor}
        fontFamily="ui-monospace,monospace"
        opacity="0.7"
      >
        {label}
      </text>
    </g>
  )
}

function EncryptedPacket(): React.ReactNode {
  return (
    <>
      <circle r="9" fillOpacity="0.12" />
      <circle r="3.5" fillOpacity="0.5" />
    </>
  )
}

export default function KeyEncryptionAnimation(): React.ReactNode {
  return (
    <div className="flex justify-center">
      <style>{CSS}</style>
      <svg
        className="ek-anim"
        width={500}
        height={216}
        viewBox="0 -26 500 216"
        xmlns="http://www.w3.org/2000/svg"
        role="presentation"
        aria-hidden="true"
      >
        {/* Laptop shell (matches EncryptionAnimation) */}
        <rect
          className="ek-laptop-ring"
          x="4"
          y="23"
          width="168"
          height="96"
          rx="7"
          fill="var(--text-primary)"
          fillOpacity="0.03"
          stroke="var(--text-muted)"
          strokeOpacity="0.35"
          strokeWidth="1.5"
        />
        <rect
          x="0"
          y="121"
          width="176"
          height="8"
          rx="4"
          fill="var(--text-primary)"
          fillOpacity="0.04"
          stroke="var(--text-muted)"
          strokeOpacity="0.35"
          strokeWidth="1"
        />

        {/* Plaintext credential cards (phase 1) */}
        <g className="ek-plain">
          <CredentialCard y={30} label="GITHUB_TOKEN" locked={false} />
          <CredentialCard y={59} label="SLACK_TOKEN" locked={false} />
          <CredentialCard y={88} label="AWS_SECRET_KEY" locked={false} />
        </g>

        {/* Encrypted credential cards (phase 2) */}
        <g className="ek-enc">
          <CredentialCard y={30} label="$EDISON$1$a3B..." locked />
          <CredentialCard y={59} label="$EDISON$1$k7P..." locked />
          <CredentialCard y={88} label="$EDISON$1$mN2..." locked />
        </g>

        {/* Accent flash overlay on laptop */}
        <rect
          className="ek-flash"
          x="4"
          y="23"
          width="168"
          height="96"
          rx="7"
          fill="var(--accent)"
          fillOpacity="0"
        />

        {/* Key icon above laptop (persists after appearing) */}
        <g className="ek-key-icon">
          {/* Pulse ring - only visible during encryption phase */}
          <g className="ek-pulse-wrap">
            <circle
              className="ek-key-pulse"
              cx="90"
              cy="-8"
              r="22"
              fill="none"
              stroke="var(--accent)"
              strokeOpacity="0.5"
              strokeWidth="1.5"
            />
          </g>
          {/* Key head (ring with hole) */}
          <circle
            cx="78"
            cy="-8"
            r="10"
            fill="var(--accent)"
            fillOpacity="0.06"
            stroke="var(--accent)"
            strokeWidth="2.2"
            strokeOpacity="0.7"
          />
          <circle cx="78" cy="-8" r="3.5" fill="var(--accent)" fillOpacity="0.2" />
          {/* Key shaft + teeth */}
          <line
            x1="88"
            y1="-8"
            x2="112"
            y2="-8"
            stroke="var(--accent)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeOpacity="0.7"
          />
          <line
            x1="106"
            y1="-8"
            x2="106"
            y2="-1"
            stroke="var(--accent)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeOpacity="0.7"
          />
          <line
            x1="98"
            y1="-8"
            x2="98"
            y2="-2"
            stroke="var(--accent)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeOpacity="0.7"
          />
          {/* Label */}
          <text
            x="90"
            y="14"
            textAnchor="middle"
            fill="var(--accent)"
            fontSize="7.5"
            fontWeight="600"
            fontFamily="system-ui,sans-serif"
            opacity="0.7"
          >
            Personal Encryption Key
          </text>
        </g>

        {/* Edison logo + label */}
        <svg x="378" y="-22" width="36" height="36" viewBox={EDISON_LOGO_VIEWBOX}>
          <path
            d={EDISON_E_PATH}
            fill="var(--accent)"
            fillOpacity="0.7"
            stroke="var(--accent)"
            strokeWidth="5"
            strokeMiterlimit="10"
          />
          <path d={EDISON_FRAME_PATH} fill="var(--accent)" fillOpacity="0.7" />
        </svg>
        <text
          x="395"
          y="24"
          textAnchor="middle"
          fill="var(--text-primary)"
          fontSize="9"
          fontWeight="bold"
          fontFamily="system-ui,sans-serif"
          opacity="0.7"
        >
          Edison Databases
        </text>

        {/* Edison vault */}
        <rect
          x="330"
          y="38"
          width="130"
          height="75"
          rx="6"
          fill="var(--text-primary)"
          fillOpacity="0.03"
          stroke="var(--text-muted)"
          strokeOpacity="0.35"
          strokeWidth="1"
        />

        {/* Vault encrypted entries (appear when packet arrives) */}
        <g className="ek-vault-content">
          <McpIcon x={336} y={44} size={12} color="var(--accent)" opacity="0.5" />
          <PadlockClosed x={350} y={44} />
          <text
            x="365"
            y="56"
            fontSize="6.5"
            fontWeight="600"
            fill="var(--accent)"
            fontFamily="ui-monospace,monospace"
            opacity="0.6"
          >
            $EDISON$1$a3B...
          </text>
          <McpIcon x={336} y={66} size={12} color="var(--accent)" opacity="0.5" />
          <PadlockClosed x={350} y={66} />
          <text
            x="365"
            y="78"
            fontSize="6.5"
            fontWeight="600"
            fill="var(--accent)"
            fontFamily="ui-monospace,monospace"
            opacity="0.6"
          >
            $EDISON$1$k7P...
          </text>
          <McpIcon x={336} y={88} size={12} color="var(--accent)" opacity="0.5" />
          <PadlockClosed x={350} y={88} />
          <text
            x="365"
            y="100"
            fontSize="6.5"
            fontWeight="600"
            fill="var(--accent)"
            fontFamily="ui-monospace,monospace"
            opacity="0.6"
          >
            $EDISON$1$mN2...
          </text>
        </g>

        {/* Shield (next to Edison logo) */}
        <g className="ek-shield">
          <svg x={350} y={-18} width={28} height={28} viewBox="0 0 24 24">
            <path
              d="M12,1L3,5V11C3,16.55 6.84,21.74 12,23C17.16,21.74 21,16.55 21,11V5L12,1Z"
              fill="var(--accent)"
              fillOpacity="0.08"
              stroke="var(--accent)"
              strokeWidth="1.2"
              strokeOpacity="0.5"
              strokeLinejoin="round"
            />
            <path
              d="M9 12 L11 14 L15 10"
              fill="none"
              stroke="var(--accent)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeOpacity="0.7"
            />
          </svg>
        </g>

        {/* Flow line (laptop -> Edison) */}
        <g className="ek-flow">
          <line
            className="ek-line"
            x1="176"
            y1="71"
            x2="330"
            y2="71"
            stroke="var(--accent)"
            strokeOpacity="0.4"
            strokeWidth="1.5"
            strokeDasharray="3 3"
          />
        </g>

        {/* Animated packet */}
        <g className="ek-pkt ek-pkt-main">
          <EncryptedPacket />
        </g>

        {/* Labels */}
        <text
          x="88"
          y="145"
          textAnchor="middle"
          fill="var(--text-primary)"
          fontSize="9"
          fontWeight="bold"
          fontFamily="system-ui,sans-serif"
        >
          Your Device
        </text>

        {/* Big crossed-out eye */}
        <g className="ek-eye">
          {/* Eye outline (almond shape) */}
          <path
            d="M367 140 Q395 116 423 140 Q395 164 367 140Z"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2"
            strokeOpacity="0.6"
          />
          {/* Iris */}
          <circle
            cx="395"
            cy="140"
            r="10"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="1.5"
            strokeOpacity="0.5"
          />
          {/* Pupil */}
          <circle cx="395" cy="140" r="4" fill="var(--accent)" fillOpacity="0.2" />
        </g>

        {/* Animated slash through eye */}
        <line
          className="ek-slash"
          x1="370"
          y1="160"
          x2="420"
          y2="120"
          stroke="var(--accent)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeOpacity="0.7"
        />

        {/* Zero-knowledge text */}
        <g className="ek-zk">
          <text
            x="395"
            y="174"
            textAnchor="middle"
            fill="var(--accent)"
            fontSize="7.5"
            fontWeight="600"
            fontFamily="system-ui,sans-serif"
            opacity="0.6"
          >
            Edison cannot read encrypted credentials
          </text>
        </g>

        {/* Progress bar */}
        <ProgressBar y={188} width={460} className="ek-progress" />
      </svg>
    </div>
  )
}
