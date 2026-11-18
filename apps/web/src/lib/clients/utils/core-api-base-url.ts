import "server-only";

import { withRelatedProject } from "@vercel/related-projects";

import { getEnvPublicConfig } from "@/config/env.public";
import { getEnvSecrets } from "@/config/env.secrets";
import {
  getCoreRelatedProjectName,
  normalizeCoreApiBaseUrl,
  resolveCoreRelatedProjectFallbackHost,
  stripCoreApiVersionSuffix,
} from "@/lib/clients/utils/core-api-base-url.shared";

function resolveServerCoreHost(): string {
  const network = getEnvPublicConfig().NEXT_PUBLIC_NETWORK;
  return withRelatedProject({
    projectName: getCoreRelatedProjectName(network),
    defaultHost: resolveCoreRelatedProjectFallbackHost({
      network,
      configuredCoreAppBaseUrl: getEnvSecrets().CORE_APP_BASE_URL,
      vercelEnv: process.env.VERCEL_ENV,
      vercelGitCommitRef: process.env.VERCEL_GIT_COMMIT_REF,
    }),
  });
}

export function getServerCoreAppBaseUrl(): string {
  return stripCoreApiVersionSuffix(resolveServerCoreHost());
}

export function getServerCoreApiBaseUrl(): string {
  return normalizeCoreApiBaseUrl(resolveServerCoreHost());
}

export const getCoreApiBaseUrl = getServerCoreApiBaseUrl;
