const SOKOSUMI_ROOT_DOMAIN = "sokosumi.com";
const PREVIEW_COOKIE_DOMAIN = "preview.sokosumi.com";
const SHARED_COOKIE_HOST_PREFIXES = ["api.", "app."] as const;

/**
 * Resolves the shared cookie domain for Better Auth deployments that need
 * cookies to flow between sibling web/core hosts inside the same Sokosumi
 * environment.
 */
export function resolveCrossSubdomainCookieDomain(
  baseUrl: string,
): string | undefined {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return undefined;
  }

  if (url.protocol !== "https:") {
    return undefined;
  }

  const hostname = url.hostname.toLowerCase();

  if (
    hostname === SOKOSUMI_ROOT_DOMAIN ||
    hostname.endsWith(`.${SOKOSUMI_ROOT_DOMAIN}`)
  ) {
    if (
      hostname === PREVIEW_COOKIE_DOMAIN ||
      hostname.endsWith(`.${PREVIEW_COOKIE_DOMAIN}`)
    ) {
      return PREVIEW_COOKIE_DOMAIN;
    }

    for (const prefix of SHARED_COOKIE_HOST_PREFIXES) {
      if (hostname.startsWith(prefix) && hostname.length > prefix.length) {
        return hostname.slice(prefix.length);
      }
    }

    return hostname;
  }

  return undefined;
}
