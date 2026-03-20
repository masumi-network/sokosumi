import "server-only";

import { resolveBetterAuthPublicBaseUrl } from "@sokosumi/utils";

import { getEnvSecrets } from "@/config/env.secrets";

export function getBetterAuthPublicBaseUrl(): string {
  const env = getEnvSecrets();

  return resolveBetterAuthPublicBaseUrl({
    vercelEnv: env.VERCEL_ENV,
    vercelUrl: env.VERCEL_URL,
    vercelBranchUrl: env.VERCEL_BRANCH_URL,
    vercelProductionUrl: env.VERCEL_PROJECT_PRODUCTION_URL,
    fallbackUrl: env.BETTER_AUTH_URL,
  });
}
