import "server-only";

import { withRelatedProject } from "@vercel/related-projects";

import { getEnvPublicConfig } from "@/config/env.public";
import { getEnvSecrets } from "@/config/env.secrets";
import {
  getCoreRelatedProjectName,
  normalizeCoreApiBaseUrl,
} from "@/lib/clients/utils/core-api-base-url.shared";

export function getServerCoreApiBaseUrl(): string {
  const resolvedCoreApiHost = withRelatedProject({
    projectName: getCoreRelatedProjectName(
      getEnvPublicConfig().NEXT_PUBLIC_NETWORK,
    ),
    defaultHost: getEnvSecrets().CORE_APP_BASE_URL,
  });

  return normalizeCoreApiBaseUrl(resolvedCoreApiHost);
}

export const getCoreApiBaseUrl = getServerCoreApiBaseUrl;
