const DEFAULT_COOKIE_PREFIX = "sokosumi";
const PREPROD_COOKIE_PREFIX = "sokosumi-preprod";
const PREPROD_HOST = "preprod.sokosumi.com";
const PREVIEW_COOKIE_PREFIX = "sokosumi-preview";
const PREVIEW_HOST = "preview.sokosumi.com";
const SOKOSUMI_ROOT_DOMAIN = "sokosumi.com";
const SHARED_COOKIE_HOST_PREFIXES = ["api.", "app."] as const;
const VERCEL_APP_HOST_SUFFIX = ".vercel.app";
const GIT_HOST_SEGMENT = "-git-";

export interface ResolveBetterAuthCookiePrefixParams {
  baseUrl: string;
  vercelBranchUrl?: string;
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
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || undefined;
}

function getGitHostSuffix(value: string): string | undefined {
  const gitSegmentIndex = value.indexOf(GIT_HOST_SEGMENT);

  if (gitSegmentIndex < 0) {
    return undefined;
  }

  return value.slice(gitSegmentIndex + GIT_HOST_SEGMENT.length);
}

function getPreviewKeyFromLabel(value: string): string | undefined {
  const normalizedValue = stripSharedCookieHostPrefix(value);

  return sanitizeCookieSegment(
    getGitHostSuffix(normalizedValue) ?? normalizedValue,
  );
}

function getPreviewKeyFromHostname(hostname: string): string | undefined {
  const normalizedHostname = stripSharedCookieHostPrefix(hostname);

  if (normalizedHostname === PREVIEW_HOST) {
    return undefined;
  }

  const previewSuffix = `.${PREVIEW_HOST}`;
  if (!normalizedHostname.endsWith(previewSuffix)) {
    return undefined;
  }

  return getPreviewKeyFromLabel(
    normalizedHostname.slice(0, -previewSuffix.length),
  );
}

function getVercelBranchKeyFromHostname(hostname: string): string | undefined {
  if (!hostname.endsWith(VERCEL_APP_HOST_SUFFIX)) {
    return undefined;
  }

  const branchHost = hostname.slice(0, -VERCEL_APP_HOST_SUFFIX.length);
  const gitHostSuffix = getGitHostSuffix(branchHost);

  if (!gitHostSuffix) {
    return undefined;
  }

  return sanitizeCookieSegment(gitHostSuffix);
}

function resolvePreviewKey(
  baseHostname?: string,
  vercelBranchHostname?: string,
): string | undefined {
  if (baseHostname) {
    const basePreviewKey =
      getPreviewKeyFromHostname(baseHostname) ??
      getVercelBranchKeyFromHostname(baseHostname);

    if (basePreviewKey) {
      return basePreviewKey;
    }
  }

  if (vercelBranchHostname) {
    return getVercelBranchKeyFromHostname(vercelBranchHostname);
  }

  return undefined;
}

export function resolveBetterAuthCookiePrefix(
  params: ResolveBetterAuthCookiePrefixParams,
): string {
  const baseHostname = getHostname(params.baseUrl);
  const normalizedBaseHostname = baseHostname
    ? stripSharedCookieHostPrefix(baseHostname)
    : undefined;
  const vercelBranchHostname = getHostname(params.vercelBranchUrl);

  if (normalizedBaseHostname === SOKOSUMI_ROOT_DOMAIN) {
    return DEFAULT_COOKIE_PREFIX;
  }

  if (normalizedBaseHostname === PREPROD_HOST) {
    return PREPROD_COOKIE_PREFIX;
  }

  const previewKey = resolvePreviewKey(baseHostname, vercelBranchHostname);
  if (previewKey) {
    return `${PREVIEW_COOKIE_PREFIX}-${previewKey}`;
  }

  if (normalizedBaseHostname === PREVIEW_HOST) {
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
