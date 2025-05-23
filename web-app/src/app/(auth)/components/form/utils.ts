import { z } from "zod";

import { OrganizationWithRelations } from "@/lib/db";

export function getEmailDomain(email: string): string {
  const emailSchema = z.string().email();
  const result = emailSchema.safeParse(email);
  if (!result.success) {
    return "";
  }
  return result.data.split("@")[1];
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
