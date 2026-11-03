const LINKEDIN_PERSON_URN_PREFIX = "urn:li:person:";

/**
 * Bare LinkedIn member id. Composio returns the full person URN, and rows saved
 * before the bare id was stored still hold it (some with a doubled prefix).
 */
export function linkedInPersonId(value: string): string {
  let id = value.trim();
  while (id.startsWith(LINKEDIN_PERSON_URN_PREFIX)) {
    id = id.slice(LINKEDIN_PERSON_URN_PREFIX.length);
  }
  return id;
}

/** Person URN for a bare id or an already prefixed URN. */
export function linkedInPersonUrn(value: string): string {
  return `${LINKEDIN_PERSON_URN_PREFIX}${linkedInPersonId(value)}`;
}
