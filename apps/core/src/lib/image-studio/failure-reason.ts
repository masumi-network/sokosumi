/**
 * Why a generation did not produce an image, as something a person can read.
 *
 * Two things come out of here, and they are for two different readers.
 *
 * `ImageJobFailureReason` is a **stable code**, and it is the field a client
 * should branch on and translate. The studio is offered in three languages, so an
 * English sentence from a server is a sentence two thirds of the audience cannot
 * read — which is the actual reason this module exists rather than a `switch` on
 * error text somewhere in the composer.
 *
 * `imageJobFailureMessage` is the English fallback, in the same register as
 * `blob-store.ts`'s storage refusal: it says what happened, it says nothing about
 * which provider or which HTTP status was involved, and it leaves the money
 * sentence to the caller — the job row already carries `credits` and `refunded`,
 * and a hard-coded "nothing was charged" here would be a claim this module cannot
 * actually check.
 *
 * The provider's own text is not in either of them. "Unexpected status code: 422"
 * reached a person's screen on a preview deployment, and a raw transport string is
 * not a thing anybody can act on. It goes to the server log, beside the job id.
 */

export const IMAGE_JOB_FAILURE_REASONS = [
  /** fal answered and refused the request. Nothing was enqueued. */
  "provider_rejected",
  /** fal accepted it and its runner then reported an error. */
  "provider_error",
  /** fal says it no longer has the request, and no image is coming. */
  "provider_lost_request",
  /** One dependency was unreachable long enough that we stopped waiting. */
  "provider_unreachable",
  /** The request was sent and we never learned whether fal received it. */
  "submission_uncertain",
  /** A reference image could not be handed to the provider. */
  "reference_not_sendable",
  /** The model or the settings can no longer be expressed to the provider. */
  "request_not_supported",
  /** Somebody asked for it to stop, and fal confirmed nothing was produced. */
  "cancelled",
  /** Reserved but never sent, and old enough that nobody is still waiting. */
  "abandoned_before_send",
  /** The project, or the requester's access to it, went away mid-flight. */
  "access_revoked",
  /** The image exists at the provider but the studio could not store it. */
  "storage_unavailable",
  /** A stored code this build does not recognise. Never written, only read. */
  "unknown",
] as const;

export type ImageJobFailureReason = (typeof IMAGE_JOB_FAILURE_REASONS)[number];

const MESSAGES: Record<ImageJobFailureReason, string> = {
  provider_rejected: "The image provider refused this request.",
  provider_error: "The image provider could not finish this image.",
  provider_lost_request:
    "The image provider no longer has this request, so no image is coming.",
  provider_unreachable:
    "The image provider could not be reached for long enough that the studio stopped waiting.",
  submission_uncertain:
    "The image provider did not confirm it received this request, so it may or may not have run.",
  reference_not_sendable:
    "A reference image could not be sent to the image provider.",
  request_not_supported:
    "This model, or these settings, are no longer available from the image provider.",
  cancelled: "Cancelled before an image was produced.",
  abandoned_before_send:
    "This request was abandoned before it reached the image provider.",
  access_revoked:
    "The image was discarded because the project, or access to it, is gone.",
  storage_unavailable:
    "The image was generated but the studio could not store it.",
  unknown: "This generation did not finish.",
};

export function imageJobFailureMessage(reason: ImageJobFailureReason): string {
  return MESSAGES[reason];
}

/**
 * Read a stored code back, defensively.
 *
 * A row written by a newer build carries a code this one has never heard of, and
 * a history or studio read must not fail over that — so an unrecognised value
 * becomes `unknown` rather than a rejected response.
 */
export function readImageJobFailureReason(
  stored: string | null,
): ImageJobFailureReason | null {
  if (stored === null) return null;
  return (
    IMAGE_JOB_FAILURE_REASONS.find((reason) => reason === stored) ?? "unknown"
  );
}
