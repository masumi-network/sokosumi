/**
 * One spelling per search query, shared by core and web: NFKC, trimmed,
 * lower case, single spaces. Search Console rows and tracked keywords that
 * differ only in case or spacing get the same key.
 */
export function normalizeSeoQuery(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}
