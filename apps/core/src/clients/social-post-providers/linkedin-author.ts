import { linkedInPersonUrn } from "@/helpers/linkedin-person";

const ORGANIZATION_URN_PREFIX = "urn:li:organization:";

/**
 * True for a company page row. Organization rows always store the full
 * `urn:li:organization:<id>`, so a bare person id never matches.
 */
export function isLinkedInOrganization(externalAccountId: string): boolean {
  return externalAccountId.trim().startsWith(ORGANIZATION_URN_PREFIX);
}

/** Numeric organization id from an organization URN or a bare id. */
export function linkedInOrganizationId(value: string): string {
  let id = value.trim();
  while (id.startsWith(ORGANIZATION_URN_PREFIX)) {
    id = id.slice(ORGANIZATION_URN_PREFIX.length);
  }
  return id;
}

/**
 * Author URN for a stored LinkedIn account id: the organization URN for a
 * company page, otherwise the person URN. Accepts bare ids, full URNs and
 * legacy doubled prefixes; applying it to its own output changes nothing.
 */
export function linkedInAuthorUrn(externalAccountId: string): string {
  if (isLinkedInOrganization(externalAccountId)) {
    return `${ORGANIZATION_URN_PREFIX}${linkedInOrganizationId(externalAccountId)}`;
  }
  return linkedInPersonUrn(externalAccountId);
}

/** `accountType` of a connection DTO: LinkedIn rows only, null elsewhere. */
export function socialConnectionAccountType(
  provider: string,
  externalAccountId: string,
): "personal" | "organization" | null {
  if (provider !== "linkedin") return null;
  return isLinkedInOrganization(externalAccountId)
    ? "organization"
    : "personal";
}
