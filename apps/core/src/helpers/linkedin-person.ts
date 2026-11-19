const LINKEDIN_PERSON_URN_PREFIX = "urn:li:person:";
export const LINKEDIN_ORGANIZATION_URN_PREFIX = "urn:li:organization:";

/** A LinkedIn connection whose account id is a company Page, not a person. */
export function isLinkedInPage(externalAccountId: string): boolean {
  return externalAccountId.startsWith(LINKEDIN_ORGANIZATION_URN_PREFIX);
}

/**
 * Bare LinkedIn member id. Composio returns the full person URN, and rows saved
 * before the bare id was stored still hold it.
 */
export function linkedInPersonId(value: string): string {
  return value.startsWith(LINKEDIN_PERSON_URN_PREFIX)
    ? value.slice(LINKEDIN_PERSON_URN_PREFIX.length)
    : value;
}

/** Person URN for a bare id or an already prefixed URN. */
export function linkedInPersonUrn(value: string): string {
  return `${LINKEDIN_PERSON_URN_PREFIX}${linkedInPersonId(value)}`;
}

/**
 * Who a LinkedIn post or comment is from: the company Page a connection
 * holds, or the person. A Page needs organization scopes on the sign-in.
 */
export function linkedInAuthorUrn(externalAccountId: string): string {
  return isLinkedInPage(externalAccountId)
    ? externalAccountId
    : linkedInPersonUrn(externalAccountId);
}

/** A connection that posts as a person where a company Page could post: LinkedIn's profile. */
export function postsAsPerson(
  provider: string,
  externalAccountId: string,
): boolean {
  return provider === "linkedin" && !isLinkedInPage(externalAccountId);
}
