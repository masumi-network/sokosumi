import { getEnvPublicConfig } from "@/config/env.public";

import {
  getDefaultCoreApiBaseUrl,
  normalizeCoreApiBaseUrl,
} from "./core-api-base-url.shared";

export function getBrowserCoreApiBaseUrl(): string {
  const { NEXT_PUBLIC_CORE_APP_BASE_URL, NEXT_PUBLIC_NETWORK } =
    getEnvPublicConfig();

  return normalizeCoreApiBaseUrl(
    NEXT_PUBLIC_CORE_APP_BASE_URL ??
      getDefaultCoreApiBaseUrl(NEXT_PUBLIC_NETWORK),
  );
}
