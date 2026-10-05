import { SOCIAL_BETA_ORGANIZATION_SLUG } from "@sokosumi/utils";

interface SocialBetaMembership {
  organization: { slug: string };
}

export function hasSocialBetaAccess(
  memberships: readonly SocialBetaMembership[],
): boolean {
  return memberships.some(
    ({ organization }) => organization.slug === SOCIAL_BETA_ORGANIZATION_SLUG,
  );
}
