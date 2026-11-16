/** Core refuses an Audit name longer than this. */
export const SEO_AUDIT_NAME_MAX = 100;

/**
 * The typed Audit name, or the page host when the name is empty.
 * Returns "" when both are missing, so Core still refuses the request.
 */
export function seoAuditName(name: string, url: string): string {
  const typed = name.trim();
  if (typed) return typed;
  let host = "";
  try {
    // Not URL.parse: Next still supports Safari 16.4, which lacks it.
    host = new URL(url.trim()).hostname;
  } catch {
    return "";
  }
  return host.replace(/^www\./, "").slice(0, SEO_AUDIT_NAME_MAX);
}
