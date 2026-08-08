/**
 * Compares two hex-encoded Masumi protocol values (input hashes, agent
 * identifiers, blockchain identifiers, seller vkeys).
 *
 * Casing never carries meaning in these fields — they are hex — but the two
 * sides cross a boundary we do not control: we send one spelling, the payment
 * node stores and echoes back whatever it likes. Comparing raw makes casing
 * decide a money outcome.
 *
 * Both current callers treat a mismatch as "this purchase is not ours":
 * `doesPurchaseMatchRequest` classifies the claim as `mismatch`, which refunds
 * the buyer while the remote purchase stays live, and the job-sync backfill
 * refuses to attach the purchase to the job, leaving a funded escrow that the
 * local refund path may later compensate a second time. Neither is a cosmetic
 * failure, which is why this comparison is shared rather than restated.
 *
 * An absent value never matches: without it there is nothing to verify
 * against, and adopting an unverifiable purchase is worse than refusing it.
 */
export function doHexValuesMatch(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  return (
    left != null && right != null && left.toLowerCase() === right.toLowerCase()
  );
}
