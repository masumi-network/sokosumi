/** Organization slugs for features that are still in beta. */
export const BETA_ORGANIZATION_SLUGS = {
  social: "utxo",
  newsletter: "utxo",
} as const;

export const NEWSLETTER_BETA_ORGANIZATION_SLUG =
  BETA_ORGANIZATION_SLUGS.newsletter;

export function isBetaOrganizationSlug(
  feature: keyof typeof BETA_ORGANIZATION_SLUGS,
  slug: string | null | undefined,
): boolean {
  return slug === BETA_ORGANIZATION_SLUGS[feature];
}
