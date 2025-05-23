import { getEmailDomain } from "@/lib/utils";

import { OrganizationWithRelations } from "./types";

export function isEmailAllowedByOrganization(
  email: string,
  organization: OrganizationWithRelations,
) {
  const { allowedDomains } = organization;
  if (allowedDomains.length === 0) {
    return true;
  }

  return allowedDomains.some(({ domain }) =>
    email.toLowerCase().endsWith(domain.toLowerCase()),
  );
}

export function filterAllowedOrganizations(
  email: string,
  organizations: OrganizationWithRelations[],
): OrganizationWithRelations[] {
  const emailDomain = getEmailDomain(email);

  if (!emailDomain) {
    return [];
  }

  return organizations.filter(
    ({ allowedDomains }) =>
      allowedDomains.length === 0 ||
      allowedDomains.some(({ domain }) => domain === emailDomain),
  );
}
