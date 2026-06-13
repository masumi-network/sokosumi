import "server-only";

import { withRelatedProject } from "@vercel/related-projects";

import { getEnvPublicConfig } from "@/config/env.public";
import { getEnvSecrets } from "@/config/env.secrets";
import {
  getCoreRelatedProjectName,
  normalizeCoreApiBaseUrl,
  stripCoreApiVersionSuffix,
} from "@/lib/clients/utils/core-api-base-url.shared";

function resolveServerCoreHost(): string {
  return withRelatedProject({
    projectName: getCoreRelatedProjectName(
      getEnvPublicConfig().NEXT_PUBLIC_NETWORK,
    ),
    defaultHost: getEnvSecrets().CORE_APP_BASE_URL,
  });
}

export function getServerCoreAppBaseUrl(): string {
  return stripCoreApiVersionSuffix(resolveServerCoreHost());
}

export function getServerCoreApiBaseUrl(): string {
  return normalizeCoreApiBaseUrl(resolveServerCoreHost());
}

export const getCoreApiBaseUrl = getServerCoreApiBaseUrl;
