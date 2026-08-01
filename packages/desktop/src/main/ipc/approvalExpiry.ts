/**
 * How long the desktop keeps one approval prompt alive.
 *
 * The single definition of that window on this side of the wire. It used to be
 * two constants - one driving the expiry sweep in approvalsHandler.ts, one
 * driving the countdown bar in dialogs/approvalDialogView.ts - held together by
 * a comment on each pointing at the other. Both said 30s because that was once
 * the only value the backend could use.
 *
 * It no longer is: a policy rule sets its own approval window, so the backend
 * states the effective one per approval on the wire (`approval_timeout_s` on
 * `mcp_pre_block`). A fixed 30s here does not merely mis-draw the countdown -
 * the sweep deletes the pending approval and closes the dialog while the server
 * is still holding the call, so the user is denied a decision they were never
 * shown. Read the window off the event; treat the constant as the fallback for
 * an event that omits it.
 */

/** Used only when an approval event carries no window of its own. */
export const DEFAULT_APPROVAL_EXPIRY_MS = 30_000

/** Hold window for one approval in ms, from the backend's seconds. */
export function approvalWindowMs(approvalTimeoutS?: number | null): number {
  if (typeof approvalTimeoutS !== 'number' || !Number.isFinite(approvalTimeoutS)) {
    return DEFAULT_APPROVAL_EXPIRY_MS
  }
  if (approvalTimeoutS <= 0) return DEFAULT_APPROVAL_EXPIRY_MS
  return approvalTimeoutS * 1000
}

/** Whether an approval shown at `timestamp` is past its own window by `now`. */
export function hasExpired(
  approval: { timestamp: number; timeoutMs: number },
  now: number
): boolean {
  return now - approval.timestamp >= approval.timeoutMs
}
