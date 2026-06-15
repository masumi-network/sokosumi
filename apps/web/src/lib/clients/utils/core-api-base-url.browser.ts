import { getEnvPublicConfig } from "@/config/env.public";

import {
  getDefaultCoreApiBaseUrl,
  joinCoreApiPath,
  normalizeCoreApiBaseUrl,
  stripCoreApiVersionSuffix,
} from "./core-api-base-url.shared";

export function getBrowserCoreApiBaseUrl(): string {
  const { NEXT_PUBLIC_CORE_APP_BASE_URL, NEXT_PUBLIC_NETWORK } =
    getEnvPublicConfig();

  return normalizeCoreApiBaseUrl(
    NEXT_PUBLIC_CORE_APP_BASE_URL ??
      getDefaultCoreApiBaseUrl(NEXT_PUBLIC_NETWORK),
  );
}

/** Core Better Auth base URL for browser `authClient` when the Core flag is on. */
export function getBrowserCoreAuthBaseUrl(): string {
  return joinCoreApiPath(
    stripCoreApiVersionSuffix(getBrowserCoreApiBaseUrl()),
    "/auth",
  );
}
