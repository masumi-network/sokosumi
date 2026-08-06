/** Delay before the overlay may become visible. Fast nav (< this) shows nothing. */
export const MOBILE_TAB_PENDING_OVERLAY_DELAY_MS = 300 as const;

export interface ResolveDelayedOverlayVisibleInput {
  pending: boolean;
  pendingForMs: number;
}

/**
 * Pure policy for delayed pending overlay visibility.
 * True only while pending and the pending duration has reached the delay.
 */
export function resolveDelayedOverlayVisible({
  pending,
  pendingForMs,
}: ResolveDelayedOverlayVisibleInput): boolean {
  return pending && pendingForMs >= MOBILE_TAB_PENDING_OVERLAY_DELAY_MS;
}
