/**
 * Attacker icon SVG path data (fedora-wearing silhouette over a laptop).
 *
 * Used in PromptInjectionAnimation as the "attacker" entity. ViewBox is
 * 0 0 480 480 and all paths share the same coordinate space.
 *
 * Split into two arrays so consumers can render the body in a threat color
 * (e.g. translucent red) and the highlights in a contrasting color
 * (e.g. white) for the hat band, V-collar notches, screen surface, and
 * keyboard space bar.
 */

/** Body / silhouette paths - rendered in the attacker's threat color. */
export const ATTACKER_BODY_PATHS = [
  // Round head + soft body
  'M185 222 Q185 142 240 142 Q295 142 295 222 Q295 247 285 262 Q370 287 370 350 Q370 358 240 358 Q110 358 110 350 Q110 287 195 262 Q185 247 185 222 Z',
  // Rounded fedora crown
  'M170 178 Q170 95 215 90 Q235 95 240 110 Q245 95 265 90 Q310 95 310 178 Z',
  // Wider brim
  'M70 184 Q240 158 410 184 Q410 200 240 216 Q70 200 70 184 Z',
  // Trapezoid laptop screen (outer bezel)
  'M60 335 L420 335 L395 455 L85 455 Z',
  // Webcam dot on the screen
  'M234 395 a6 6 0 1 0 12 0 a6 6 0 1 0 -12 0 Z',
  // Keyboard base
  'M85 455 L395 455 L395 478 L85 478 Z'
] as const

/** Highlight paths - rendered in a contrasting color (typically white). */
export const ATTACKER_HIGHLIGHT_PATHS = [
  // Hat band
  'M172 178 Q240 168 308 178 L306 186 Q240 175 174 186 Z',
  // V-collar notch (left)
  'M198 264 L220 310 L240 272 Z',
  // V-collar notch (right)
  'M282 264 L260 310 L240 272 Z',
  // Trapezoid laptop screen (inner / display surface)
  'M78 348 L402 348 L380 442 L100 442 Z',
  // Space bar
  'M223 463 H257 a3 3 0 0 1 3 3 v1 a3 3 0 0 1 -3 3 H223 a3 3 0 0 1 -3 -3 v-1 a3 3 0 0 1 3 -3 Z'
] as const

export const ATTACKER_SVG_VIEWBOX = '0 0 480 480'
