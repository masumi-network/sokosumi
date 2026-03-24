const DEFAULT_COOKIE_PREFIX = "sokosumi";
const PREPROD_COOKIE_PREFIX = "sokosumi-preprod";
const PREPROD_HOST = "preprod.sokosumi.com";
const PREVIEW_COOKIE_PREFIX = "sokosumi-preview";
const PREVIEW_HOST = "preview.sokosumi.com";
const SOKOSUMI_ROOT_DOMAIN = "sokosumi.com";
const SHARED_COOKIE_HOST_PREFIXES = ["api.", "app."] as const;

export interface ResolveBetterAuthCookiePrefixParams {
  baseUrl: string;
  vercelEnv?: string;
  vercelGitCommitRef?: string;
}

function parseUrl(value?: string): URL | undefined {
  if (!value) {
    return undefined;
  }

  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function getHostname(value?: string): string | undefined {
  return parseUrl(value)?.hostname.toLowerCase();
}

function stripSharedCookieHostPrefix(hostname: string): string {
  for (const prefix of SHARED_COOKIE_HOST_PREFIXES) {
    if (hostname.startsWith(prefix) && hostname.length > prefix.length) {
      return hostname.slice(prefix.length);
    }
  }

  return hostname;
}

function sanitizeCookieSegment(value: string): string | undefined {
  let normalized = "";
  let previousWasSeparator = false;

  for (const character of value.toLowerCase()) {
    const isAlphaNumeric =
      (character >= "a" && character <= "z") ||
      (character >= "0" && character <= "9");

    if (isAlphaNumeric) {
      normalized += character;
      previousWasSeparator = false;
      continue;
    }

    if (normalized === "" || previousWasSeparator) {
      continue;
    }

    normalized += "-";
    previousWasSeparator = true;
  }

  if (normalized.endsWith("-")) {
    normalized = normalized.slice(0, -1);
  }

  return normalized || undefined;
}

function isPreviewHostname(hostname: string): boolean {
  const normalizedHostname = stripSharedCookieHostPrefix(hostname);

  return (
    normalizedHostname === PREVIEW_HOST ||
    normalizedHostname.endsWith(`.${PREVIEW_HOST}`)
  );
}

export function resolveBetterAuthCookiePrefix(
  params: ResolveBetterAuthCookiePrefixParams,
): string {
  const baseHostname = getHostname(params.baseUrl);
  const normalizedBaseHostname = baseHostname
    ? stripSharedCookieHostPrefix(baseHostname)
    : undefined;

  if (normalizedBaseHostname === SOKOSUMI_ROOT_DOMAIN) {
    return DEFAULT_COOKIE_PREFIX;
  }

  if (normalizedBaseHostname === PREPROD_HOST) {
    return PREPROD_COOKIE_PREFIX;
  }

  if (params.vercelEnv === "preview") {
    const previewKey = sanitizeCookieSegment(params.vercelGitCommitRef ?? "");

    if (previewKey) {
      return `${PREVIEW_COOKIE_PREFIX}-${previewKey}`;
    }

    return PREVIEW_COOKIE_PREFIX;
  }

  if (baseHostname && isPreviewHostname(baseHostname)) {
    return PREVIEW_COOKIE_PREFIX;
  }

  return DEFAULT_COOKIE_PREFIX;
}

export function getBetterAuthCookieName(
  cookiePrefix: string,
  cookieName: string,
): string {
  return `${cookiePrefix}.${cookieName}`;
}
