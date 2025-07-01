import { OrganizationWithRelations } from "@/lib/db/types";
import { getEmailDomain } from "@/lib/utils";

export function filterAllowedOrganizations(
  email: string,
  organizations: OrganizationWithRelations[],
): OrganizationWithRelations[] {
  const emailDomain = getEmailDomain(email);

  if (!emailDomain) {
    return [];
  }

  return organizations.filter(({ requiredEmailDomains }) =>
    requiredEmailDomains.some(
      (domain) => domain.toLowerCase() === emailDomain.toLowerCase(),
    ),
  );
}
