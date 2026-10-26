import {
  ProjectSocialProvider,
  type SocialPostStatus,
} from "@sokosumi/core-client";
import { socialPostProviderLabel } from "@sokosumi/utils";

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
type PublishFailureCopyKey =
  | (typeof PUBLISH_FAILURE_KIND_COPY)[PublishFailureKind]
  | "failures.providerComingSoon"
  | "failures.generic"
  | "outcomes.authorizationRevoked"
  | "outcomes.connectionInactive"
  | "outcomes.missed";

function isPublishFailureKind(kind: string): kind is PublishFailureKind {
  return Object.hasOwn(PUBLISH_FAILURE_KIND_COPY, kind);
}

export interface PublishFailureSource {
  status: SocialPostStatus;
  provider?: string;
  lastError?: string | null;
  lastAttempt?: {
    outcome?: string | null;
    errorKind?: string | null;
  } | null;
}

export function publishFailureCopy(
  post: PublishFailureSource,
  t: (key: PublishFailureCopyKey, values?: Record<string, string>) => string,
  formatList: (values: string[]) => string,
  enabledProviders: readonly ProjectSocialProvider[],
): string {
  const unavailableProvider = post.lastAttempt?.errorKind?.startsWith(
    "provider_coming_soon:",
  )
    ? post.lastAttempt.errorKind.slice("provider_coming_soon:".length)
    : null;
  const provider = Object.values(ProjectSocialProvider).find((provider) =>
    unavailableProvider
      ? provider === unavailableProvider
      : post.lastError?.startsWith(
          `${socialPostProviderLabel(provider)} is coming soon.`,
        ),
  );
  if (provider) {
    return t("failures.providerComingSoon", {
      provider: socialPostProviderLabel(provider),
      providers: formatList(enabledProviders.map(socialPostProviderLabel)),
    });
  }
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
  // This message is authored by Core's length guard, without provider error text.
  if (kind === "text_limit" && post.lastError) return post.lastError;
  if (kind && isPublishFailureKind(kind)) {
    return t(PUBLISH_FAILURE_KIND_COPY[kind]);
  }
  return t("failures.generic");
}
