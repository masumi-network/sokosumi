import { OrganizationWithInclude } from "@/lib/db/types";
import { getEmailDomain } from "@/lib/utils";

export function filterAllowedOrganizations(
  email: string,
  organizations: OrganizationWithInclude[],
): OrganizationWithInclude[] {
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
