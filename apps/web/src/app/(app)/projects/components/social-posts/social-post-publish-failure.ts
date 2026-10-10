import type { SocialPost } from "@sokosumi/core-client";

/**
 * Lean copy for a publish failure: kind / outcome first, raw `lastError`
 * only when the kind is unknown.
 */
const PUBLISH_FAILURE_KIND_COPY = {
  rate_limited: "failures.rateLimited",
  timeout: "failures.timeout",
  unauthorized: "failures.unauthorized",
  provider_unavailable: "failures.unavailable",
  rejected: "failures.rejected",
  provider_rejected: "failures.rejected",
  media_missing: "failures.mediaMissing",
  media_type_mismatch: "failures.mediaType",
} as const;

type PublishFailureKind = keyof typeof PUBLISH_FAILURE_KIND_COPY;

function isPublishFailureKind(kind: string): kind is PublishFailureKind {
  return Object.hasOwn(PUBLISH_FAILURE_KIND_COPY, kind);
}

export function publishFailureCopy(
  post: Pick<SocialPost, "status" | "lastError" | "lastAttempt">,
  t: (key: string) => string,
): string | null {
  const outcome = post.lastAttempt?.outcome;
  if (outcome === "authorization_revoked") {
    return t("outcomes.authorizationRevoked");
  }
  if (outcome === "connection_inactive") {
    return t("outcomes.connectionInactive");
  }
  if (post.status === "MISSED" || outcome === "missed") {
    return t("outcomes.missed");
  }
  const kind = post.lastAttempt?.errorKind;
  if (kind && isPublishFailureKind(kind)) {
    return t(PUBLISH_FAILURE_KIND_COPY[kind]);
  }
  return post.lastError;
}
