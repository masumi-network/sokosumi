import { getEmailDomain } from "@/lib/utils";
import { Organization } from "@/prisma/generated/client";

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
