const LOCAL_AUTH_COOKIE_DOMAIN = "localhost";

function normalizeCookieDomain(domain: string): string {
  return domain.replace(/^\./, "").toLowerCase();
}

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1";
}

/**
 * Domain Better Auth uses when issuing cookies (core `crossSubDomainCookies`).
 * Development always uses `localhost` so copied production env values do not
 * break local sign-in.
 */
export function resolveBetterAuthIssuerCookieDomain(
  configuredDomain: string,
  nodeEnv: string | undefined,
): string {
  if (nodeEnv === "development") {
    return LOCAL_AUTH_COOKIE_DOMAIN;
  }

  return normalizeCookieDomain(configuredDomain);
}

export interface ResolveBetterAuthRequestCookieDomainParams {
  hostname: string;
  configuredDomain: string | undefined;
}

/**
 * Shared cookie domain for a browser request (web proxy shim, cookie relay).
 * Returns `undefined` when the host cannot safely receive domain-scoped auth
 * cookies (e.g. unrelated Vercel preview URLs).
 */
export function resolveBetterAuthRequestCookieDomain(
  params: ResolveBetterAuthRequestCookieDomainParams,
): string | undefined {
  const hostname = params.hostname.toLowerCase();

  if (isLocalHostname(hostname)) {
    return LOCAL_AUTH_COOKIE_DOMAIN;
  }

  if (!params.configuredDomain) {
    return undefined;
  }

  const domain = normalizeCookieDomain(params.configuredDomain);
  if (hostname === domain || hostname.endsWith(`.${domain}`)) {
    return domain;
  }

  return undefined;
}

/** Host-only duplicate clearing is unsafe on localhost (sign-in race). */
export function shouldClearHostOnlyAuthCookieDuplicate(
  domain: string | undefined,
): boolean {
  if (!domain) {
    return false;
  }

  return !isLocalHostname(normalizeCookieDomain(domain));
}
