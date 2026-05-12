/**
 * SIEM Integration animation for documentation.
 *
 * Shows Edison Watch deployed on-prem/VPC with SIEM (Splunk) integration.
 * AI agents make tool calls through Edison (inside VPC boundary), while
 * security events simultaneously stream from Edison to Splunk.
 *
 * 10s loop. Pure SVG + CSS. Respects `prefers-reduced-motion`.
 */
import { useId } from 'react'
import { AGENT_REGISTRY, type AgentIconEntry } from '../../agent-registry/index'
import {
  AgentIcon, DANGER, EdisonLogo, McpIcon, McpPacket, ORANGE as O, ProgressBar,
} from '../_shared'

const CURSOR = AGENT_REGISTRY['cursor']
const CLAUDE = AGENT_REGISTRY['claude-code']
const CODEX = AGENT_REGISTRY['codex']

const SPLUNK_GREEN = '#77B539'

const GITLAB_SVG = '<path d="m31.46 12.78-.04-.12-4.35-11.35A1.14 1.14 0 0 0 25.94.6c-.24 0-.47.1-.66.24-.19.15-.33.36-.39.6l-2.94 9h-11.9l-2.94-9A1.14 1.14 0 0 0 6.07.58a1.15 1.15 0 0 0-1.14.72L.58 12.68l-.05.11a8.1 8.1 0 0 0 2.68 9.34l.02.01.04.03 6.63 4.97 3.28 2.48 2 1.52a1.35 1.35 0 0 0 1.62 0l2-1.52 3.28-2.48 6.67-5h.02a8.09 8.09 0 0 0 2.7-9.36Z" fill="#E24329"/><path d="m31.46 12.78-.04-.12a14.75 14.75 0 0 0-5.86 2.64l-9.55 7.24 6.09 4.6 6.67-5h.02a8.09 8.09 0 0 0 2.67-9.36Z" fill="#FC6D26"/><path d="m9.9 27.14 3.28 2.48 2 1.52a1.35 1.35 0 0 0 1.62 0l2-1.52 3.28-2.48-6.1-4.6-6.07 4.6Z" fill="#FCA326"/><path d="M6.44 15.3a14.71 14.71 0 0 0-5.86-2.63l-.05.12a8.1 8.1 0 0 0 2.68 9.34l.02.01.04.03 6.63 4.97 6.1-4.6-9.56-7.24Z" fill="#FC6D26"/>'

const POSTGRESQL_SVG = '<path d="M402.395 271.23c-50.302 10.376-53.76-6.655-53.76-6.655 53.111-78.808 75.313-178.843 56.153-203.326-52.27-66.785-142.752-35.2-144.262-34.38l-.486.087c-9.938-2.063-21.06-3.292-33.56-3.496-22.761-.373-40.026 5.967-53.127 15.902 0 0-161.411-66.495-153.904 83.63 1.597 31.938 45.776 241.657 98.471 178.312 19.26-23.163 37.869-42.748 37.869-42.748 9.243 6.14 20.308 9.272 31.908 8.147l.901-.765c-.28 2.876-.152 5.689.361 9.019-13.575 15.167-9.586 17.83-36.723 23.416-27.459 5.659-11.328 15.734-.796 18.367 12.768 3.193 42.307 7.716 62.266-20.224l-.796 3.188c5.319 4.26 9.054 27.711 8.428 48.969-.626 21.259-1.044 35.854 3.147 47.254 4.191 11.4 8.368 37.05 44.042 29.406 29.809-6.388 45.256-22.942 47.405-50.555 1.525-19.631 4.976-16.729 5.194-34.28l2.768-8.309c3.192-26.611.507-35.196 18.872-31.203l4.463.392c13.517.615 31.208-2.174 41.591-7 22.358-10.376 35.618-27.7 13.573-23.148z" fill="#336791" stroke="none"/><path d="M323.205 324.227c2.833-23.601 1.984-27.062 19.563-23.239l4.463.392c13.517.615 31.199-2.174 41.587-7 22.362-10.376 35.622-27.7 13.572-23.148-50.297 10.376-53.755-6.655-53.755-6.655 53.111-78.803 75.313-178.836 56.149-203.322-52.27-66.789-142.748-35.206-144.262-34.386l-.482.089c-9.938-2.062-21.06-3.294-33.554-3.496-22.761-.374-40.032 5.967-53.133 15.904 0 0-161.408-66.498-153.899 83.628 1.597 31.936 45.777 241.655 98.47 178.31 19.259-23.163 37.871-42.748 37.871-42.748 9.242 6.14 20.307 9.272 31.912 8.147l.897-.765c-.281 2.876-.157 5.689.359 9.019-13.572 15.167-9.584 17.83-36.723 23.416-27.457 5.659-11.326 15.734-.797 18.367 12.768 3.193 42.305 7.716 62.268-20.224l-.795 3.188c5.325 4.26 4.965 30.619 5.72 49.452.756 18.834 2.017 36.409 5.856 46.771 3.839 10.36 8.369 37.05 44.036 29.406 29.809-6.388 52.6-15.582 54.677-101.107" fill="none" stroke="#fff" stroke-width="37.395" stroke-linecap="butt" stroke-linejoin="miter"/>'

function grafanaSvg(prefix: string) {
  return `<defs><linearGradient id="${prefix}-gf" x1="49.995%" x2="49.995%" y1="122.45%" y2="31.139%"><stop offset="0%" stop-color="#FFF100"/><stop offset="100%" stop-color="#F05A28"/></linearGradient></defs><path fill="url(#${prefix}-gf)" d="M255.59 122.775c-.46-4.675-1.226-10.04-2.759-16.017a98.01 98.01 0 0 0-7.204-19.16 106.69 106.69 0 0 0-13.412-20.54c-2.222-2.681-4.675-5.287-7.28-7.816 3.908-15.558-4.752-29.046-4.752-29.046-14.945-.92-24.448 4.675-27.973 7.204-.613-.23-1.15-.537-1.763-.767-2.529-.996-5.135-1.992-7.894-2.835a130.374 130.374 0 0 0-8.277-2.3c-2.835-.69-5.67-1.226-8.583-1.686-.537-.076-.996-.153-1.533-.23C157.646 8.738 138.946 0 138.946 0c-20.922 13.258-24.831 31.805-24.831 31.805s-.077.383-.23 1.073c-1.15.307-2.299.69-3.449.996-1.609.46-3.218 1.073-4.751 1.686a123.11 123.11 0 0 0-4.752 1.916 117.205 117.205 0 0 0-9.35 4.599c-2.989 1.686-5.9 3.525-8.737 5.441l-.766-.307c-28.97-11.036-54.643 2.223-54.643 2.223-2.376 30.809 11.572 50.198 14.331 53.724-.69 1.916-1.303 3.832-1.916 5.748-2.146 6.974-3.755 14.101-4.751 21.535-.154 1.073-.307 2.146-.384 3.219C7.894 146.916 0 173.97 0 173.97c22.302 25.674 48.359 27.283 48.359 27.283l.077-.076c3.295 5.9 7.127 11.495 11.419 16.783a111.904 111.904 0 0 0 5.671 6.362c-8.124 23.298 1.15 42.61 1.15 42.61 24.83.92 41.155-10.882 44.603-13.564a84.473 84.473 0 0 0 7.511 2.222 109.703 109.703 0 0 0 23.298 3.449c1.916.076 3.909.153 5.825.076H150.672l1.226-.076v.076c11.726 16.708 32.265 19.084 32.265 19.084 14.638-15.405 15.48-30.733 15.48-34.028v-1.38c3.066-2.145 5.979-4.445 8.738-6.974 5.824-5.288 10.959-11.342 15.25-17.857l1.15-1.839c16.554.92 28.28-10.27 28.28-10.27-2.759-17.243-12.569-25.673-14.638-27.283 0 0-.077-.076-.23-.153-.153-.077-.153-.153-.153-.153-.077-.077-.23-.154-.383-.23.076-1.073.153-2.07.23-3.142.153-1.84.153-3.756.153-5.595v-2.913l-.077-1.149-.076-1.533c0-.536-.077-.996-.154-1.456-.076-.46-.076-.996-.153-1.456l-.153-1.456-.23-1.456c-.307-1.916-.613-3.756-1.073-5.672-1.763-7.433-4.675-14.484-8.43-20.845a70.373 70.373 0 0 0-14.025-16.707c-5.365-4.752-11.42-8.584-17.704-11.42-6.36-2.835-12.952-4.675-19.543-5.518-3.295-.46-6.59-.613-9.886-.536h-2.453l-1.226.077c-.46 0-.92.076-1.303.076a51.958 51.958 0 0 0-4.981.69c-6.591 1.226-12.799 3.602-18.24 6.897-5.441 3.296-10.193 7.358-14.025 11.956a54.7 54.7 0 0 0-8.89 15.021 52.857 52.857 0 0 0-3.525 16.094c-.077 1.303-.077 2.683-.077 3.986v.996l.077 1.073c.076.613.076 1.303.153 1.916.23 2.682.766 5.288 1.456 7.74 1.456 4.982 3.755 9.503 6.59 13.335 2.836 3.832 6.285 6.975 9.887 9.504 3.602 2.452 7.51 4.215 11.343 5.364 3.832 1.15 7.664 1.61 11.266 1.61H154.58c.23 0 .46 0 .689-.077.383 0 .766-.077 1.15-.077.076 0 .23 0 .306-.076l.383-.077c.23 0 .46-.076.69-.076.46-.077.843-.154 1.303-.23.46-.077.843-.154 1.226-.307.843-.153 1.61-.46 2.376-.69 1.533-.536 3.066-1.15 4.368-1.839 1.38-.69 2.606-1.533 3.832-2.3.307-.23.69-.459.997-.766 1.226-.996 1.456-2.835.46-4.061-.844-1.073-2.376-1.38-3.603-.69l-.92.46a24.914 24.914 0 0 1-3.295 1.38c-1.15.382-2.375.689-3.602.919-.613.076-1.226.153-1.916.23-.306 0-.613.076-.996.076h-1.84c-.383 0-.766 0-1.149-.076H154.58c-.153 0-.383 0-.536-.077-.383-.077-.69-.077-1.073-.153-2.836-.383-5.671-1.226-8.354-2.453a29.275 29.275 0 0 1-7.74-5.058c-2.376-2.146-4.445-4.675-6.055-7.587-1.61-2.912-2.759-6.131-3.295-9.503-.23-1.686-.383-3.449-.307-5.135 0-.46.077-.92.077-1.38v-.613c0-.23.077-.46.077-.69.076-.919.23-1.839.383-2.758 1.303-7.358 4.981-14.562 10.653-20.003 1.456-1.38 2.988-2.606 4.598-3.755a31.705 31.705 0 0 1 5.211-2.99 35.739 35.739 0 0 1 5.672-2.068c1.915-.537 3.908-.844 5.977-1.073.997-.077 1.993-.154 3.066-.154h2.376l.843.077c2.222.153 4.368.46 6.514.996 4.292.92 8.507 2.53 12.415 4.675 7.818 4.369 14.485 11.113 18.547 19.237 2.07 4.061 3.525 8.43 4.215 12.951.153 1.15.307 2.3.383 3.45l.077.842.077.843v3.296c0 .536-.077 1.456-.077 1.992-.077 1.227-.23 2.53-.383 3.756s-.383 2.452-.613 3.678a49.548 49.548 0 0 1-.843 3.602 64.129 64.129 0 0 1-2.3 7.128 62.417 62.417 0 0 1-7.204 13.105c-5.9 8.124-13.948 14.715-23.144 18.93-4.599 2.069-9.427 3.602-14.408 4.368-2.453.46-4.982.69-7.511.766h-3.832a36.08 36.08 0 0 1-4.062-.23c-5.365-.383-10.653-1.379-15.864-2.835-5.135-1.456-10.116-3.525-14.868-5.978-9.427-5.058-17.933-11.956-24.524-20.31a79.015 79.015 0 0 1-8.584-13.334 79.197 79.197 0 0 1-5.671-14.638c-1.38-5.058-2.223-10.193-2.606-15.405l-.077-.996v-6.821c.077-2.529.307-5.211.614-7.817.306-2.606.766-5.288 1.302-7.894.537-2.605 1.15-5.211 1.916-7.817a102.856 102.856 0 0 1 5.442-14.791c4.368-9.35 10.04-17.704 16.86-24.371 1.686-1.686 3.449-3.22 5.288-4.752a78.196 78.196 0 0 1 5.748-4.138c1.916-1.303 3.985-2.453 6.055-3.526a39.773 39.773 0 0 1 3.142-1.533 11118896.038 11118896.038 0 0 1 3.219-1.379c2.146-.92 4.368-1.686 6.667-2.376.537-.153 1.15-.306 1.686-.536.537-.154 1.15-.307 1.686-.46 1.15-.307 2.3-.613 3.45-.843.536-.153 1.149-.23 1.762-.383.613-.154 1.15-.23 1.763-.384.613-.076 1.15-.23 1.762-.306l.843-.153.92-.154c.613-.076 1.15-.153 1.763-.23.69-.076 1.302-.153 1.992-.23.537-.076 1.456-.153 1.993-.23.383-.076.843-.076 1.226-.153l.843-.076.383-.077h.46c.69-.077 1.303-.077 1.993-.153l.996-.077h.767c.536 0 1.149-.076 1.685-.076a98.944 98.944 0 0 1 6.745 0c4.445.153 8.813.69 13.028 1.456 8.507 1.61 16.478 4.291 23.758 7.893 7.28 3.526 13.719 7.894 19.39 12.646.383.306.69.613 1.073.92.306.306.69.613.996.92.69.612 1.303 1.225 1.993 1.838.69.614 1.303 1.227 1.916 1.84a44.302 44.302 0 0 1 1.839 1.916c2.376 2.529 4.598 5.058 6.59 7.664a98.897 98.897 0 0 1 9.734 15.25l.46.92.46.92c.306.613.613 1.226.843 1.84.306.613.536 1.149.843 1.762.23.613.536 1.15.766 1.763.92 2.299 1.84 4.521 2.53 6.59 1.149 3.373 1.992 6.362 2.682 8.967a2.043 2.043 0 0 0 2.299 1.61c1.15-.077 1.992-.996 1.992-2.146.077-2.759 0-6.054-.383-9.81Z"/>`
}

// Splunk chevron (the ">" mark from the logo)
const SPLUNK_CHEVRON_D = 'M40 20.5V22l6 2-6 2.602V28l7-3v-2z'

// Database/server icon
const SERVER_D = 'M128,24C74.17,24,32,48.51,32,80v96c0,31.49,42.17,56,96,56s96-24.51,96-56V80C224,48.51,181.83,24,128,24Zm80,152c0,18.95-34.12,40-80,40S48,194.95,48,176V144.26C64.44,158.53,93.12,168,128,168s63.56-9.47,80-23.74Zm0-56c0,18.95-34.12,40-80,40S48,138.95,48,120V88.26C64.44,102.53,93.12,112,128,112s63.56-9.47,80-23.74ZM128,96C82.12,96,48,77,48,64S82.12,32,128,32s80,13,80,32S173.88,96,128,96Z'

// Log/document icon
const LOG_D = 'M200,24H72A16,16,0,0,0,56,40V64H40A16,16,0,0,0,24,80v96a16,16,0,0,0,16,16H184a16,16,0,0,0,16-16V168h16a16,16,0,0,0,16-16V40A16,16,0,0,0,216,24ZM184,176H40V80H184Zm32-24H200V80a16,16,0,0,0-16-16H72V40H216ZM160,104H64a8,8,0,0,1,0-16h96a8,8,0,0,1,0,16Zm0,32H64a8,8,0,0,1,0-16h96a8,8,0,0,1,0,16Zm0,32H64a8,8,0,0,1,0-16h96a8,8,0,0,1,0,16Z'

const CSS = `
.siem { color: var(--text-primary); }

.siem .siem-line { stroke-dashoffset:0; animation: siem-lf 2s linear infinite; }

/* ── event stream packets ── */
.siem .siem-evt1 { animation: siem-evt1 10s ease-in-out infinite; }
.siem .siem-evt2 { animation: siem-evt2 10s ease-in-out infinite; }
.siem .siem-evt3 { animation: siem-evt3 10s ease-in-out infinite; }

/* ── tool call packets ── */
.siem .siem-pkt1 { animation: siem-pkt1 10s ease-in-out infinite; }
.siem .siem-pkt2 { animation: siem-pkt2 10s ease-in-out infinite; }
.siem .siem-pkt3 { animation: siem-pkt3 10s ease-in-out infinite; }

/* ── splunk log lines appearing ── */
.siem .siem-log1 { animation: siem-log1 10s ease-in-out infinite; }
.siem .siem-log2 { animation: siem-log2 10s ease-in-out infinite; }
.siem .siem-log3 { animation: siem-log3 10s ease-in-out infinite; }
.siem .siem-log4 { animation: siem-log4 10s ease-in-out infinite; }

/* ── policy verdict badges ── */
.siem .siem-v1 { animation: siem-v1 10s ease-in-out infinite; }
.siem .siem-v2 { animation: siem-v2 10s ease-in-out infinite; }
.siem .siem-v3 { animation: siem-v3 10s ease-in-out infinite; }

/* Edison pulse */
.siem .siem-pulse { transform-origin:220px 120px; animation: siem-pulse 1.5s cubic-bezier(.2,.8,.4,1) infinite; }

/* ───── keyframes ───── */
@keyframes siem-lf { to { stroke-dashoffset: -12; } }

@keyframes siem-pulse {
  0%   { transform:scale(1);   opacity:0; }
  10%  { transform:scale(1);   opacity:.3; }
  60%  { transform:scale(1.5); opacity:0; }
  100% { transform:scale(1.5); opacity:0; }
}

/* verdict badges pop in when packets hit Edison */
@keyframes siem-v1 {
  0%,14% { opacity:0; transform:scale(0.5); }
  17%    { opacity:1; transform:scale(1); }
  90%    { opacity:1; transform:scale(1); }
  95%,100% { opacity:0; transform:scale(0.5); }
}
@keyframes siem-v2 {
  0%,40% { opacity:0; transform:scale(0.5); }
  43%    { opacity:1; transform:scale(1); }
  90%    { opacity:1; transform:scale(1); }
  95%,100% { opacity:0; transform:scale(0.5); }
}
@keyframes siem-v3 {
  0%,66% { opacity:0; transform:scale(0.5); }
  69%    { opacity:1; transform:scale(1); }
  90%    { opacity:1; transform:scale(1); }
  95%,100% { opacity:0; transform:scale(0.5); }
}

/* ── Tool call pkt1: Agent1 → Edison → GitLab ── */
@keyframes siem-pkt1 {
  0%,4%   { opacity:0; }
  5%      { transform:translate(90px,55px);   opacity:.8; color:${O}; }
  15%     { transform:translate(190px,120px); opacity:1;  color:${O}; }
  16%     { transform:translate(220px,120px); opacity:.3; color:var(--accent); }
  17%     { transform:translate(250px,120px); opacity:1;  color:var(--accent); }
  30%     { transform:translate(430px,55px);  opacity:1;  color:var(--accent); }
  31%     { opacity:0; }
  32%,100%{ opacity:0; }
}

/* ── Tool call pkt2: Agent2 → Edison → PostgreSQL ── */
@keyframes siem-pkt2 {
  0%,30%  { opacity:0; }
  31%     { transform:translate(90px,120px);  opacity:.8; color:${O}; }
  41%     { transform:translate(190px,120px); opacity:1;  color:${O}; }
  42%     { transform:translate(220px,120px); opacity:.3; color:var(--accent); }
  43%     { transform:translate(250px,120px); opacity:1;  color:var(--accent); }
  56%     { transform:translate(430px,120px); opacity:1;  color:var(--accent); }
  57%     { opacity:0; }
  58%,100%{ opacity:0; }
}

/* ── Tool call pkt3: Agent3 → Edison → DENIED ── */
@keyframes siem-pkt3 {
  0%,56%  { opacity:0; }
  57%     { transform:translate(90px,185px);  opacity:.8; color:${O}; }
  67%     { transform:translate(190px,120px); opacity:1;  color:${O}; }
  68%     { transform:translate(190px,120px); opacity:.6; color:${DANGER}; }
  70%     { transform:translate(190px,120px); opacity:0;  color:${DANGER}; }
  71%,100%{ opacity:0; }
}

/* ── Event stream evt1: Edison → Splunk ── */
@keyframes siem-evt1 {
  0%,16%  { opacity:0; }
  17%     { transform:translate(220px,155px); opacity:.8; color:${SPLUNK_GREEN}; }
  30%     { transform:translate(350px,240px); opacity:1;  color:${SPLUNK_GREEN}; }
  31%     { opacity:0; }
  32%,100%{ opacity:0; }
}

/* ── Event stream evt2: Edison → Splunk ── */
@keyframes siem-evt2 {
  0%,42%  { opacity:0; }
  43%     { transform:translate(220px,155px); opacity:.8; color:${SPLUNK_GREEN}; }
  56%     { transform:translate(350px,240px); opacity:1;  color:${SPLUNK_GREEN}; }
  57%     { opacity:0; }
  58%,100%{ opacity:0; }
}

/* ── Event stream evt3: Edison → Splunk ── */
@keyframes siem-evt3 {
  0%,68%  { opacity:0; }
  69%     { transform:translate(220px,155px); opacity:.8; color:${SPLUNK_GREEN}; }
  82%     { transform:translate(350px,240px); opacity:1;  color:${SPLUNK_GREEN}; }
  83%     { opacity:0; }
  84%,100%{ opacity:0; }
}

/* ── Splunk log lines appearing ── */
@keyframes siem-log1 {
  0%,30%  { opacity:0; transform:translateX(-4px); }
  33%     { opacity:1; transform:translateX(0); }
  90%     { opacity:1; }
  95%,100%{ opacity:0; }
}
@keyframes siem-log2 {
  0%,56%  { opacity:0; transform:translateX(-4px); }
  59%     { opacity:1; transform:translateX(0); }
  90%     { opacity:1; }
  95%,100%{ opacity:0; }
}
@keyframes siem-log3 {
  0%,82%  { opacity:0; transform:translateX(-4px); }
  85%     { opacity:1; transform:translateX(0); }
  90%     { opacity:1; }
  95%,100%{ opacity:0; }
}
@keyframes siem-log4 {
  0%,88%  { opacity:0; transform:translateX(-4px); }
  91%     { opacity:1; transform:translateX(0); }
  95%     { opacity:1; }
  98%,100%{ opacity:0; }
}

/* progress bar */
.siem .siem-progress { transform-origin:20px 310px; animation: siem-prog 10s linear infinite; }
@keyframes siem-prog {
  0%   { transform:scaleX(0); }
  100% { transform:scaleX(1); }
}

@media (prefers-reduced-motion:reduce) {
  .siem .siem-line, .siem .siem-pkt1, .siem .siem-pkt2, .siem .siem-pkt3,
  .siem .siem-evt1, .siem .siem-evt2, .siem .siem-evt3,
  .siem .siem-pulse, .siem .siem-log1, .siem .siem-log2,
  .siem .siem-log3, .siem .siem-log4,
  .siem .siem-v1, .siem .siem-v2, .siem .siem-v3 { animation:none; }
  .siem .siem-pkt1, .siem .siem-pkt2, .siem .siem-pkt3 { opacity:0; }
  .siem .siem-evt1, .siem .siem-evt2, .siem .siem-evt3 { opacity:0; }
  .siem .siem-v1, .siem .siem-v2, .siem .siem-v3 { opacity:1; transform:scale(1); }
  .siem .siem-log1, .siem .siem-log2, .siem .siem-log3, .siem .siem-log4 { opacity:1; transform:none; }
  .siem .siem-progress { animation:none; transform:scaleX(1); }
}
`

function Laptop({ y, agent }: {
  y: number; agent: AgentIconEntry
}): React.ReactNode {
  return (
    <g>
      <rect x={16} y={y} width={80} height={44} rx={5}
        fill="var(--text-primary)" fillOpacity="0.03"
        stroke="var(--text-muted)" strokeOpacity="0.35" strokeWidth="1.5" />
      <rect x={12} y={y + 46} width={88} height={5} rx={2.5}
        fill="var(--text-primary)" fillOpacity="0.04"
        stroke="var(--text-muted)" strokeOpacity="0.35" strokeWidth="1" />
      <AgentIcon agent={agent} x={46} y={y + 6} size={20} />
      <McpIcon x={49} y={y + 28} size={14} color="var(--text-muted)" opacity="0.45" />
    </g>
  )
}

function McpServer({ x, y, iconSvg, iconViewBox }: {
  x: number; y: number; iconSvg?: string; iconViewBox?: string
}): React.ReactNode {
  return (
    <g>
      <rect x={x} y={y} width={70} height={44} rx={6}
        fill="var(--text-primary)" fillOpacity="0.03"
        stroke="var(--text-muted)" strokeOpacity="0.35" strokeWidth="1.5" />
      {/* MCP icon (left side) */}
      <McpIcon x={x + 4} y={y + 12} size={20} color="var(--accent)" opacity="0.7" />
      {/* Service icon (right side) */}
      {iconSvg ? (
        <svg x={x + 30} y={y + 10} width={24} height={24}
          viewBox={iconViewBox || '0 0 24 24'}
          dangerouslySetInnerHTML={{ __html: iconSvg }}
        />
      ) : (
        <McpIcon x={x + 30} y={y + 10} size={24} color="var(--text-muted)" opacity="0.6" />
      )}
      {/* "MCP" label under the box */}
      <text x={x + 35} y={y + 56} textAnchor="middle"
        fill="var(--text-muted)" fillOpacity="0.5" fontSize="7" fontFamily="system-ui,sans-serif">
        MCP
      </text>
    </g>
  )
}


function EventPacket(): React.ReactNode {
  return (
    <>
      <circle r="6" fillOpacity="0.15" />
      <svg x={-4} y={-4} width={8} height={8} viewBox="0 0 256 256">
        <path d={LOG_D} fill="currentColor" fillOpacity="0.9" />
      </svg>
    </>
  )
}

function SplunkLogo({ x, y }: { x: number; y: number }): React.ReactNode {
  return (
    <g>
      {/* Splunk wordmark */}
      <svg x={x} y={y} width={80} height={22} viewBox="0.012 18 47 13">
        <path fill="var(--text-primary)" fillOpacity="0.7" d="M13.434 18l.066 10H15V18zM32 18v10.004h1.805s.015-3.61.035-3.606c.02 0 2.691 3.743 2.715 3.73.027-.007 1.601-.573 1.601-.589 0-.012-2.683-3.441-2.683-3.445 0-.008 2.25-2.512 2.23-2.532-.062-.058-1.281-.585-1.316-.566-.016.012-2.582 2.797-2.582 2.797V18zM2.098 21.05c-.649.137-1.258.552-1.508 1.032a1.675 1.675 0 0 0 .008 1.488c.16.309.625.739 1.347 1.246.782.555 1.078.832 1.153 1.094.113.387-.059.75-.434.93-.187.09-.27.101-.602.086-.433-.02-.73-.13-1.171-.446-.141-.097-.27-.168-.286-.152-.015.016-.156.227-.312.469l-.281.433.105.082c.063.043.25.157.422.254 1.188.66 2.945.555 3.836-.23a1.79 1.79 0 0 0 .602-1.645c-.086-.582-.407-.964-1.415-1.695-.792-.574-1.167-.89-1.253-1.058-.168-.329-.051-.645.304-.829.18-.093.254-.101.61-.086.347.012.453.04.742.176l.336.164.261-.41c.145-.226.25-.426.239-.445-.047-.07-.598-.301-.942-.39-.457-.122-1.34-.157-1.761-.067zm7.933.884c.79.37 1.211 1.53 1.04 2.851-.06.469-.227 1.035-.383 1.297-.157.27-.461.563-.704.676-.445.21-1.105.129-1.523-.188-.578-.441-.895-1.523-.774-2.648.114-1.031.485-1.684 1.133-1.985.336-.156.88-.156 1.211-.003zm-.719-1.149c-.472.106-.847.317-1.253.703l-.368.352V21H6v10h1.691v-4.078l.325.316c.593.582 1.289.817 2.101.703.531-.074.906-.21 1.301-.476 1.11-.742 1.723-2.223 1.555-3.77-.16-1.468-.914-2.484-2.13-2.87-.312-.102-1.163-.122-1.53-.04zm6.946.215s.055 5.285.09 5.438c.136.582.527 1.136.965 1.375.402.218.726.285 1.332.285.863-.004 1.386-.211 2.027-.801L21 27v1h1.742l-.023-7H21s.023 4.348 0 4.5c-.102.61-.574 1.11-1.055 1.27-.285.097-.785.175-1.086.128-.308-.05-.828-.39-.859-.898v-4.977zm14.484 7s-.055-5.285-.09-5.438c-.136-.582-.527-1.136-.965-1.375-.402-.218-.726-.285-1.332-.285-.863.004-1.386.211-2.027.801L26 22v-1h-1.742l.023 7H26s-.023-4.348 0-4.5c.102-.61.574-1.11 1.055-1.27.285-.097.66-.171 1.086-.128.425.046.89.433.859.898v4.977z" />
        <path fill={SPLUNK_GREEN} fillRule="evenodd" d={SPLUNK_CHEVRON_D} />
      </svg>
    </g>
  )
}

export default function SIEMIntegrationAnimation(): React.ReactNode {
  const id = useId()
  return (
    <div className="flex justify-center">
      <style>{CSS}</style>
      <svg
        className="siem"
        width={600}
        height={320}
        viewBox="0 0 600 320"
        xmlns="http://www.w3.org/2000/svg"
        role="presentation"
        aria-hidden="true"
      >
        {/* ══ 3 Agent Laptops (OUTSIDE boundary) ══ */}
        <Laptop y={38} agent={CLAUDE} />
        <Laptop y={103} agent={CODEX} />
        <Laptop y={168} agent={CURSOR} />

        {/* ══ Connection lines: Agents → Edison (crossing boundary) ══ */}
        <line className="siem-line" x1="100" y1="60" x2="190" y2="120"
          stroke="var(--text-muted)" strokeOpacity="0.4" strokeWidth="1.5" strokeDasharray="3 3" />
        <line className="siem-line" x1="100" y1="125" x2="190" y2="120"
          stroke="var(--text-muted)" strokeOpacity="0.4" strokeWidth="1.5" strokeDasharray="3 3" />
        <line className="siem-line" x1="100" y1="190" x2="190" y2="120"
          stroke="var(--text-muted)" strokeOpacity="0.4" strokeWidth="1.5" strokeDasharray="3 3" />

        {/* ══ VPC / On-Prem boundary (Edison is the gateway at edge) ══ */}
        <rect x={155} y={4} width={441} height={300} rx={8}
          fill="var(--text-primary)" fillOpacity="0.015"
          stroke="var(--text-muted)" strokeOpacity="0.3" strokeWidth="1.5"
          strokeDasharray="6 4" />
        <text x="168" y="20"
          fill="var(--text-primary)" fillOpacity="0.75" fontSize="11" fontFamily="system-ui,sans-serif"
          fontWeight="600">
          Your Infrastructure (VPC / On-Prem)
        </text>

        {/* ══ Edison Watch (gateway at left edge of boundary) ══ */}
        <circle className="siem-pulse" cx="220" cy="120" r="28"
          fill="none" stroke="var(--accent)" strokeOpacity="0.4" strokeWidth="1.5" />
        <EdisonLogo x={194} y={95} w={52} h={50} />
        <text x="220" y="163" textAnchor="middle"
          fill="var(--text-primary)" fontSize="8" fontWeight="bold" fontFamily="system-ui,sans-serif">
          Edison Gateway
        </text>

        {/* ══ Connection lines: Edison → Services ══ */}
        <line className="siem-line" x1="250" y1="120" x2="435" y2="57"
          stroke="var(--accent)" strokeOpacity="0.4" strokeWidth="1.5" strokeDasharray="3 3" />
        <line className="siem-line" x1="250" y1="120" x2="435" y2="122"
          stroke="var(--accent)" strokeOpacity="0.4" strokeWidth="1.5" strokeDasharray="3 3" />
        <line className="siem-line" x1="250" y1="120" x2="435" y2="187"
          stroke="var(--accent)" strokeOpacity="0.4" strokeWidth="1.5" strokeDasharray="3 3" />

        {/* ══ On-Prem Services ══ */}
        <McpServer x={435} y={35} iconSvg={GITLAB_SVG} iconViewBox="0 0 32 32" />
        <McpServer x={435} y={100} iconSvg={POSTGRESQL_SVG} iconViewBox="0 0 432.071 445.383" />
        <McpServer x={435} y={165} iconSvg={grafanaSvg(id)} iconViewBox="0 0 256 279" />



        {/* ══ Event stream line: Edison → Splunk ══ */}
        <line className="siem-line" x1="220" y1="155" x2="350" y2="240"
          stroke={SPLUNK_GREEN} strokeOpacity="0.5" strokeWidth="1.5" strokeDasharray="3 3" />

        {/* ══ Splunk SIEM Panel (inside boundary) ══ */}
        <rect x={310} y={225} width={200} height={70} rx={6}
          fill="var(--text-primary)" fillOpacity="0.03"
          stroke={SPLUNK_GREEN} strokeOpacity="0.4" strokeWidth="1.5" />

        {/* Splunk logo */}
        <SplunkLogo x={320} y={230} />

        {/* SIEM label */}
        <text x="430" y="243"
          fill="var(--text-muted)" fillOpacity="0.5" fontSize="7" fontFamily="system-ui,sans-serif">
          SIEM
        </text>

        {/* Database icon */}
        <svg x={468} y={231} width={14} height={14} viewBox="0 0 256 256">
          <path d={SERVER_D} fill={SPLUNK_GREEN} fillOpacity="0.5" />
        </svg>

        {/* Log lines (animated) */}
        <g className="siem-log1">
          <rect x={320} y={252} width={150} height={8} rx={2}
            fill={SPLUNK_GREEN} fillOpacity="0.08" />
          <text x="324" y="259"
            fill={SPLUNK_GREEN} fillOpacity="0.8" fontSize="6" fontFamily="monospace">
            CEF:0|tool_call|read_file|5|ok
          </text>
        </g>
        <g className="siem-log2">
          <rect x={320} y={263} width={170} height={8} rx={2}
            fill={SPLUNK_GREEN} fillOpacity="0.08" />
          <text x="324" y="270"
            fill={SPLUNK_GREEN} fillOpacity="0.8" fontSize="6" fontFamily="monospace">
            CEF:0|security|trifecta_flag|8|block
          </text>
        </g>
        <g className="siem-log3">
          <rect x={320} y={274} width={160} height={8} rx={2}
            fill={SPLUNK_GREEN} fillOpacity="0.08" />
          <text x="324" y="281"
            fill={SPLUNK_GREEN} fillOpacity="0.8" fontSize="6" fontFamily="monospace">
            CEF:0|tool_call|send_msg|5|ok
          </text>
        </g>
        <g className="siem-log4">
          <rect x={320} y={285} width={140} height={8} rx={2}
            fill={SPLUNK_GREEN} fillOpacity="0.08" />
          <text x="324" y="292"
            fill={SPLUNK_GREEN} fillOpacity="0.8" fontSize="6" fontFamily="monospace">
            CEF:0|admin|config_change|3
          </text>
        </g>

        {/* ══ Policy verdict badges (left side of Edison, facing clients) ══ */}
        {/* pkt1 → allowed */}
        <g className="siem-v1" style={{ transformOrigin: '185px 102px' }}>
          <circle cx="185" cy="102" r="9"
            fill="var(--accent)" fillOpacity="0.12" stroke="var(--accent)" strokeOpacity="0.5" strokeWidth="1" />
          <polyline points="180,102 183,105 190,98"
            fill="none" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </g>
        {/* pkt2 → allowed */}
        <g className="siem-v2" style={{ transformOrigin: '185px 122px' }}>
          <circle cx="185" cy="122" r="9"
            fill="var(--accent)" fillOpacity="0.12" stroke="var(--accent)" strokeOpacity="0.5" strokeWidth="1" />
          <polyline points="180,122 183,125 190,118"
            fill="none" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </g>
        {/* pkt3 → denied */}
        <g className="siem-v3" style={{ transformOrigin: '185px 142px' }}>
          <circle cx="185" cy="142" r="9"
            fill={DANGER} fillOpacity="0.12" stroke={DANGER} strokeOpacity="0.5" strokeWidth="1" />
          <line x1="181" y1="138" x2="189" y2="146" stroke={DANGER} strokeWidth="1.8" strokeLinecap="round" />
          <line x1="189" y1="138" x2="181" y2="146" stroke={DANGER} strokeWidth="1.8" strokeLinecap="round" />
        </g>

        {/* ══ Tool call packets ══ */}
        <g className="siem-pkt1" fill="currentColor"><McpPacket /></g>
        <g className="siem-pkt2" fill="currentColor"><McpPacket /></g>
        <g className="siem-pkt3" fill="currentColor"><McpPacket /></g>

        {/* ══ Event stream packets ══ */}
        <g className="siem-evt1" fill="currentColor"><EventPacket /></g>
        <g className="siem-evt2" fill="currentColor"><EventPacket /></g>
        <g className="siem-evt3" fill="currentColor"><EventPacket /></g>

        {/* ══ Progress bar ══ */}
        <ProgressBar y={310} width={560} className="siem-progress" />
      </svg>
    </div>
  )
}
