import type { SocialPostStatus } from "@sokosumi/core-client";

/**
 * Lean copy for a Failed or Missed publish: outcome / errorKind first.
 * Never the raw provider error.
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

export interface PublishFailureSource {
  status: SocialPostStatus;
  lastAttempt?: {
    outcome?: string | null;
    errorKind?: string | null;
  } | null;
}

export function publishFailureCopy(
  post: PublishFailureSource,
  t: (key: string) => string,
): string {
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
  return t("failures.generic");
}
