/**
 * Brand and semantic colors used across animations.
 *
 * Theme-aware colors stay as CSS variables (`var(--text-primary)`,
 * `var(--text-muted)`, `var(--accent)`) so the consuming app's palette
 * wins. The constants below are reserved for semantics the theme cannot
 * override.
 */

/** Brand orange used for "before Edison" / unencrypted / pre-trifecta state. */
export const ORANGE = '#da7756'
/** Saturated red used for attacker / corrupted-robot / unsafe visuals. */
export const RED = '#d94040'
/** Tailwind red-500 used for danger badges (eye-slash, X marks, quarantine). */
export const DANGER = '#ef4444'
/** Bright safe-green used for safe robots / allowed flow / taint-safe values. */
export const GREEN = '#3ddc84'
