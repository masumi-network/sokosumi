import { getEnvPublicConfig } from "@/config/env.public";

export function normalizeCoreApiBaseUrl(baseUrl: string): string {
  const withoutTrailingSlash = baseUrl.replace(/\/+$/, "");
  return withoutTrailingSlash.endsWith("/v1")
    ? withoutTrailingSlash
    : `${withoutTrailingSlash}/v1`;
}

export const coreApiBaseUrl = getEnvPublicConfig().NEXT_PUBLIC_CORE_API_URL;
