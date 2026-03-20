export interface ResolveBetterAuthPublicBaseUrlParams {
  vercelEnv: string | undefined;
  vercelUrl: string | undefined;
  vercelBranchUrl: string | undefined;
  configuredBaseUrl: string;
}

/**
 * Resolves the public Better Auth base URL for Vercel Preview vs production/local.
 * On Vercel Preview, prefers the deployment URL, then the branch URL, then the configured default.
 */
export function resolveBetterAuthPublicBaseUrl(
  params: ResolveBetterAuthPublicBaseUrlParams,
): string {
  const { vercelEnv, vercelUrl, vercelBranchUrl, configuredBaseUrl } = params;

  const raw =
    vercelEnv === "preview"
      ? (vercelUrl ?? vercelBranchUrl ?? configuredBaseUrl)
      : configuredBaseUrl;

  return raw.replace(/\/+$/, "");
}
