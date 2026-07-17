function stripTrailingSlashes(value: string): string {
  let out = value;
  while (out.endsWith("/")) {
    out = out.slice(0, -1);
  }
  return out;
}

function ensureAbsoluteUrl(value: string): string {
  if (value.startsWith("https://") || value.startsWith("http://")) {
    return value;
  }
  return `https://${value}`;
}

/**
 * True when the URL host is sokosumi.com or a subdomain.
 * Preview auth (magic links, session cookies with Domain=sokosumi.com) must
 * use these hosts — browsers reject Domain=sokosumi.com cookies set from
 * *.vercel.app.
 */
export function isSokosumiAuthHost(url: string): boolean {
  try {
    const { hostname } = new URL(ensureAbsoluteUrl(url));
    return hostname === "sokosumi.com" || hostname.endsWith(".sokosumi.com");
  } catch {
    return false;
  }
}

function firstNonEmpty(
  ...candidates: Array<string | undefined>
): string | undefined {
  for (const candidate of candidates) {
    if (candidate) {
      return candidate;
    }
  }
  return undefined;
}

function pickPreferredPreviewUrl(
  candidates: Array<string | undefined>,
): string | undefined {
  const present = candidates.filter((candidate): candidate is string =>
    Boolean(candidate),
  );
  if (present.length === 0) {
    return undefined;
  }

  return present.find(isSokosumiAuthHost) ?? present[0];
}

export interface ResolveBetterAuthPublicBaseUrlParams {
  vercelEnv: string | undefined;
  vercelUrl: string | undefined;
  vercelBranchUrl: string | undefined;
  vercelProductionUrl: string | undefined;
  /**
   * Optional constructed preview host (e.g. branch alias on
   * *.preview.sokosumi.com). Preferred over Vercel system URLs when set.
   */
  preferredPreviewUrl?: string | undefined;
  fallbackUrl: string;
}

export interface ResolveBetterAuthProductionUrlParams {
  vercelProductionUrl: string | undefined;
  fallbackUrl: string;
}

/**
 * Resolves the public Better Auth base URL for Vercel Preview vs production/local.
 *
 * On Vercel Preview, prefers a sokosumi-hosted URL (custom preview domain /
 * branch alias) over the per-deployment `VERCEL_URL` (usually *.vercel.app).
 * Magic-link verify URLs and session cookies with `BETTER_AUTH_COOKIE_DOMAIN`
 * require a *.sokosumi.com host.
 *
 * On Vercel Production, prefers `vercelProductionUrl`, then the fallback.
 */
export function resolveBetterAuthPublicBaseUrl(
  params: ResolveBetterAuthPublicBaseUrlParams,
): string {
  const {
    vercelEnv,
    vercelUrl,
    vercelBranchUrl,
    vercelProductionUrl,
    preferredPreviewUrl,
    fallbackUrl,
  } = params;

  let raw: string;
  switch (vercelEnv) {
    case "preview":
      raw =
        pickPreferredPreviewUrl([
          preferredPreviewUrl,
          vercelBranchUrl,
          vercelUrl,
        ]) || fallbackUrl;
      break;
    case "production":
      raw = firstNonEmpty(vercelProductionUrl, fallbackUrl) ?? fallbackUrl;
      break;
    default:
      raw = fallbackUrl;
      break;
  }

  return stripTrailingSlashes(raw);
}

/**
 * Resolves the canonical Better Auth production URL used by OAuth proxying.
 * This always points at the production host, never a preview deployment.
 */
export function resolveBetterAuthProductionUrl(
  params: ResolveBetterAuthProductionUrlParams,
): string {
  const { vercelProductionUrl, fallbackUrl } = params;

  return stripTrailingSlashes(vercelProductionUrl || fallbackUrl);
}
