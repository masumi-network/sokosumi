import { withRelatedProject } from "@vercel/related-projects";

import { getEnvPublicConfig } from "@/config/env.public";

export function buildAuthHeaders(requestHeaders: Headers): HeadersInit {
  const authHeaders: HeadersInit = {};
  const cookie = requestHeaders.get("cookie");

  if (cookie) authHeaders.cookie = cookie;

  return authHeaders;
}

export function normalizeCoreApiBaseUrl(baseUrl: string): string {
  const withoutTrailingSlash = baseUrl.replace(/\/+$/, "");
  return withoutTrailingSlash.endsWith("/v1")
    ? withoutTrailingSlash
    : `${withoutTrailingSlash}/v1`;
}

export const coreApiBaseUrl = withRelatedProject({
  projectName:
    getEnvPublicConfig().NEXT_PUBLIC_NETWORK === "Preprod"
      ? "sokosumi-core-preprod"
      : "sokosumi-core-mainnet",
  defaultHost: getEnvPublicConfig().NEXT_PUBLIC_CORE_API_URL,
});
