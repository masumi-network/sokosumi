/**
 * Filters browser errors from marketing/analytics scripts (GTM, LinkedIn Insight,
 * Plausible, etc.) that fail when blocked by ad blockers, consent, or network issues.
 * These are not actionable application defects.
 */
export const THIRD_PARTY_BROWSER_IGNORE_ERRORS: RegExp[] = [
  // LinkedIn Insight Tag loaded via GTM (SOKOSUMI-P2)
  /^TypeError: Failed to fetch \(px\.ads\.linkedin\.com\)$/,
  // Plausible analytics (often loaded via GTM)
  /^TypeError: Failed to fetch \(plausible\.io\)$/,
  // Google ads / syndication scripts
  /^TypeError: Failed to fetch \(pagead2\.googlesyndication\.com\)$/,
];

export const THIRD_PARTY_BROWSER_DENY_URLS: RegExp[] = [
  /\/li\.lms-analytics\//i,
  /px\.ads\.linkedin\.com/i,
  /plausible\.io/i,
  /googletagmanager\.com/i,
  /googlesyndication\.com/i,
];

export function isIgnoredThirdPartyBrowserErrorMessage(
  message: string,
): boolean {
  return THIRD_PARTY_BROWSER_IGNORE_ERRORS.some((pattern) =>
    pattern.test(message),
  );
}
