import "server-only";

import { withRelatedProject } from "@vercel/related-projects";

import { getEnvPublicConfig } from "@/config/env.public";
import { getEnvSecrets } from "@/config/env.secrets";

export function getCoreApiBaseUrl(): string {
  const resolvedCoreApiHost = withRelatedProject({
    projectName:
      getEnvPublicConfig().NEXT_PUBLIC_NETWORK === "Preprod"
        ? "sokosumi-core-preprod"
        : "sokosumi-core-mainnet",
    defaultHost: getEnvSecrets().CORE_API_URL,
  });

  const withoutTrailingSlash = resolvedCoreApiHost.replace(/\/+$/, "");

  return withoutTrailingSlash.endsWith("/v1")
    ? withoutTrailingSlash
    : `${withoutTrailingSlash}/v1`;
}
