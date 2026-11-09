/**
 * `/design-system` is for local and preview deploys only. Production (Vercel
 * production, or any non-Vercel `NODE_ENV=production` host) must 404 it.
 */
export function isDesignSystemPublic(env: {
  VERCEL_ENV?: string;
  NODE_ENV?: string;
}): boolean {
  if (env.VERCEL_ENV !== undefined && env.VERCEL_ENV !== "") {
    return env.VERCEL_ENV !== "production";
  }
  return env.NODE_ENV !== "production";
}
