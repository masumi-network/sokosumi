const PERSON_URN_PREFIX = "urn:li:person:";
const ORGANIZATION_URN_PREFIX = "urn:li:organization:";

/** Strips every leading copy of `prefix`, so legacy doubled URNs collapse. */
function stripPrefix(value: string, prefix: string): string {
  let id = value.trim();
  while (id.startsWith(prefix)) id = id.slice(prefix.length);
  return id;
}

/**
 * True for a company page row. Organization rows always store the full
 * `urn:li:organization:<id>`, so a bare person id never matches.
 */
export function isLinkedInOrganization(externalAccountId: string): boolean {
  return externalAccountId.trim().startsWith(ORGANIZATION_URN_PREFIX);
}

/** Numeric organization id from an organization URN or a bare id. */
export function linkedInOrganizationId(value: string): string {
  return stripPrefix(value, ORGANIZATION_URN_PREFIX);
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
  return `${PERSON_URN_PREFIX}${stripPrefix(externalAccountId, PERSON_URN_PREFIX)}`;
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
