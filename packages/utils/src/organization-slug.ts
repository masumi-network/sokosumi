import slugify from "slugify";

const SUFFIX_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const SUFFIX_LENGTH = 6;

/**
 * A new organization's slug: the slugified name plus a random six-character
 * suffix, so two organizations with the same name never collide.
 */
export function createOrganizationSlug(name: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(SUFFIX_LENGTH));
  const suffix = Array.from(
    bytes,
    (byte) => SUFFIX_ALPHABET[byte % SUFFIX_ALPHABET.length],
  ).join("");
  return [slugify(name, { lower: true, strict: true }), suffix]
    .filter(Boolean)
    .join("-");
}
