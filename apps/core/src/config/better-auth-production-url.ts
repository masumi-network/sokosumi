import { resolveBetterAuthProductionUrl } from "@sokosumi/utils";

import { getEnv } from "@/config/env";

export function getBetterAuthProductionUrl(): string {
  const env = getEnv();

  return resolveBetterAuthProductionUrl({
    vercelProductionUrl: env.VERCEL_PROJECT_PRODUCTION_URL,
    fallbackUrl: env.BETTER_AUTH_URL,
  });
}
