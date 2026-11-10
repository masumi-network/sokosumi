/** Core refuses an Audit name longer than this. */
export const SEO_AUDIT_NAME_MAX = 100;

/**
 * The typed Audit name, or the page host when the name is empty.
 * Returns "" when both are missing, so Core still refuses the request.
 */
export function seoAuditName(name: string, url: string): string {
  const typed = name.trim();
  if (typed) return typed;
  const host = URL.parse(url.trim())?.hostname ?? "";
  return host.replace(/^www\./, "").slice(0, SEO_AUDIT_NAME_MAX);
}
