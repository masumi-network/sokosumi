const LINKEDIN_PERSON_URN_PREFIX = "urn:li:person:";

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
