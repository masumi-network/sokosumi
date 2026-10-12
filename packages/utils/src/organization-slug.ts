import slugify from "slugify";

const SUFFIX_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const SUFFIX_LENGTH = 6;

/**
 * A new organization's slug: the slugified name plus a random six-character
 * suffix, so two organizations with the same name almost never collide.
 */
export function createOrganizationSlug(name: string): string {
  return [slugify(name, { lower: true, strict: true }), randomSuffix()]
    .filter(Boolean)
    .join("-");
}

/**
 * Uniform over the alphabet: bytes at or above the largest multiple of its
 * length are drawn again, so `byte % length` favors no character.
 */
function randomSuffix(): string {
  const limit = 256 - (256 % SUFFIX_ALPHABET.length);
  let suffix = "";
  while (suffix.length < SUFFIX_LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(SUFFIX_LENGTH))) {
      if (byte < limit && suffix.length < SUFFIX_LENGTH) {
        suffix += SUFFIX_ALPHABET[byte % SUFFIX_ALPHABET.length];
      }
    }
  }
  return suffix;
}
