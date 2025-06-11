import { getEmailDomain } from "@/lib/utils";
import { Organization } from "@/prisma/generated/client";

import { OrganizationWithRelations } from "./types";

export function isEmailAllowedByOrganization(
  email: string,
  organization: Organization,
) {
  const emailDomain = getEmailDomain(email);
  if (!emailDomain) {
    return false;
  }

  const { requiredEmailDomains } = organization;
  if (requiredEmailDomains.length === 0) {
    return true;
  }

  return requiredEmailDomains.some(
    (domain) => domain.toLowerCase() === emailDomain.toLowerCase(),
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
    ({ requiredEmailDomains }) =>
      requiredEmailDomains.length === 0 ||
      requiredEmailDomains.some(
        (domain) => domain.toLowerCase() === emailDomain.toLowerCase(),
      ),
  );
}
