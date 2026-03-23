function stripTrailingSlashes(value: string): string {
  let out = value;
  while (out.endsWith("/")) {
    out = out.slice(0, -1);
  }
  return out;
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
 * On Vercel Preview, prefers the deployment URL, then the branch URL, then the fallback.
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
      raw = vercelUrl || vercelBranchUrl || fallbackUrl;
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
