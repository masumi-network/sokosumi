import { getEnvPublicConfig } from "@/config/env.public";

import {
  getDefaultCoreApiBaseUrl,
  normalizeCoreApiBaseUrl,
  normalizeCoreAuthBaseUrl,
} from "./core-api-base-url.shared";

export function getBrowserCoreApiBaseUrl(): string {
  const { NEXT_PUBLIC_CORE_APP_BASE_URL, NEXT_PUBLIC_NETWORK } =
    getEnvPublicConfig();

  return normalizeCoreApiBaseUrl(
    NEXT_PUBLIC_CORE_APP_BASE_URL ??
      getDefaultCoreApiBaseUrl(NEXT_PUBLIC_NETWORK),
  );
}

/**
 * Base URL of core's Better Auth handler for the browser auth client (same
 * host as the core API, path /auth instead of /v1).
 */
export function getBrowserCoreAuthBaseUrl(): string {
  const { NEXT_PUBLIC_CORE_APP_BASE_URL, NEXT_PUBLIC_NETWORK } =
    getEnvPublicConfig();

  return normalizeCoreAuthBaseUrl(
    NEXT_PUBLIC_CORE_APP_BASE_URL ??
      getDefaultCoreApiBaseUrl(NEXT_PUBLIC_NETWORK),
  );
}
