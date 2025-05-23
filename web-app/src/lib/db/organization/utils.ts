import { OrganizationWithRelations } from "./types";

export function isEmailAllowedByOrganization(
  email: string,
  organization: OrganizationWithRelations,
) {
  const { allowedDomains } = organization;
  if (allowedDomains.length === 0) {
    return true;
  }

  return allowedDomains.some(({ domain }) => email.endsWith(domain));
}
