import "server-only";

import { resolveBetterAuthProductionUrl } from "@sokosumi/utils";

import { getEnvSecrets } from "@/config/env.secrets";

export function getBetterAuthProductionUrl(): string {
  const env = getEnvSecrets();

  return resolveBetterAuthProductionUrl({
    vercelProductionUrl: env.VERCEL_PROJECT_PRODUCTION_URL,
    fallbackUrl: env.BETTER_AUTH_URL,
  });
}
