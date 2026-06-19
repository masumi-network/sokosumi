/**
 * Formats credits for user-facing display by removing decimal precision.
 */
export function formatCreditsForDisplay(credits: number): number {
  return Math.trunc(credits);
}
