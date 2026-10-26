import { SOCIAL_BETA_ORGANIZATION_SLUG } from "@sokosumi/utils";

interface SocialBetaMembership {
  organization: { slug: string };
}

/** Ads-only beta check; Social scheduling is public. Name retained for compatibility. */
export function hasSocialBetaAccess(
  memberships: readonly SocialBetaMembership[],
): boolean {
  return memberships.some(
    ({ organization }) => organization.slug === SOCIAL_BETA_ORGANIZATION_SLUG,
  );
}
