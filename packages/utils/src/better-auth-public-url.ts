function stripTrailingSlashes(value: string): string {
  let out = value;
  while (out.endsWith("/")) {
    out = out.slice(0, -1);
  }
  return out;
}

/**
 * True when the absolute URL host is sokosumi.com or a subdomain.
 * Preview auth (magic links, session cookies with Domain=sokosumi.com) must
 * use these hosts — browsers reject Domain=sokosumi.com cookies set from
 * *.vercel.app.
 */
export function isSokosumiAuthHost(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === "sokosumi.com" || hostname.endsWith(".sokosumi.com");
  } catch {
    return false;
  }
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
  fallbackUrl: string;
}

export interface ResolveBetterAuthProductionUrlParams {
  vercelProductionUrl: string | undefined;
  fallbackUrl: string;
}

/**
 * Resolves the public Better Auth base URL for Vercel Preview vs production/local.
 *
 * On Vercel Preview, prefers `VERCEL_BRANCH_URL` (stable branch alias) over
 * `VERCEL_URL` (per-deployment hash). When only one of those is on a
 * `*.sokosumi.com` host (Preview Deployment Suffix), that one wins regardless
 * of order — needed for magic-link cookies with `BETTER_AUTH_COOKIE_DOMAIN`.
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
    fallbackUrl,
  } = params;

  let raw: string;
  switch (vercelEnv) {
    case "preview":
      // Branch URL first (stable alias). Prefer a sokosumi host if either
      // Vercel system URL already uses the preview deployment suffix.
      raw =
        pickPreferredPreviewUrl([vercelBranchUrl, vercelUrl]) || fallbackUrl;
      break;
    case "production":
      raw = vercelProductionUrl || fallbackUrl;
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
