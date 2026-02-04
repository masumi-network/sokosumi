import "server-only";

import { headers } from "next/headers";

import { getEnvSecrets } from "@/config/env.secrets";

export interface CoreApiPagination {
  cursor: string | null;
  limit: number;
  total: number;
  nextCursor: string | null;
}

export interface CoreApiMeta {
  pagination?: CoreApiPagination;
}

export interface CoreApiResponse<T> {
  data: T;
  meta?: CoreApiMeta;
}

export function buildAuthHeaders(requestHeaders: Headers): HeadersInit {
  const authHeaders: HeadersInit = {};
  const cookie = requestHeaders.get("cookie");
  const apiKey = requestHeaders.get("x-api-key");
  const authorization = requestHeaders.get("authorization");
  const organizationSlug = requestHeaders.get("x-organization-slug");

  if (cookie) authHeaders.cookie = cookie;
  if (apiKey) authHeaders["x-api-key"] = apiKey;
  if (authorization) authHeaders.authorization = authorization;
  if (organizationSlug) {
    authHeaders["x-organization-slug"] = organizationSlug;
  }

  return authHeaders;
}

function mergeHeaders(
  baseHeaders: HeadersInit | undefined,
  authHeaders: HeadersInit,
): Headers {
  const merged = new Headers(baseHeaders);
  Object.entries(authHeaders).forEach(([key, value]) => {
    if (typeof value === "string") {
      merged.set(key, value);
    }
  });
  return merged;
}

export const coreClient = (() => {
  async function request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<CoreApiResponse<T>> {
    const requestHeaders = await headers();
    const authHeaders = buildAuthHeaders(requestHeaders);
    const mergedHeaders = mergeHeaders(options.headers, authHeaders);
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;

    const response = await fetch(
      `${getEnvSecrets().CORE_API_URL}${normalizedPath}`,
      {
        ...options,
        headers: mergedHeaders,
      },
    );

    if (!response.ok) {
      throw new Error("Failed to fetch from Core API");
    }

    return (await response.json()) as CoreApiResponse<T>;
  }

  return {
    request,
  };
})();
