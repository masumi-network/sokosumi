import "server-only";

import type { NextRequest } from "next/server";

import {
  fetchCoreAuth,
  getCoreAuthBaseUrl,
} from "@/lib/auth/auth.server.client";

function buildLegacyCoreAuthUrl(
  request: NextRequest,
  pathSegments: string[],
): string {
  const coreAuthBaseUrl = getCoreAuthBaseUrl().replace(/\/$/, "");
  const suffix = pathSegments.map(encodeURIComponent).join("/");
  const url = new URL(
    suffix.length > 0 ? `${coreAuthBaseUrl}/${suffix}` : coreAuthBaseUrl,
  );
  url.search = new URL(request.url).search;

  return url.toString();
}

function getSetCookieHeaderValues(response: Response): string[] {
  if (typeof response.headers.getSetCookie === "function") {
    const cookies = response.headers.getSetCookie();
    if (cookies.length > 0) {
      return cookies;
    }
  }

  const singleCookie = response.headers.get("set-cookie");
  return singleCookie ? [singleCookie] : [];
}

function buildProxiedResponseHeaders(coreResponse: Response): Headers {
  const headers = new Headers();
  const contentType = coreResponse.headers.get("content-type");

  if (contentType) {
    headers.set("content-type", contentType);
  }

  for (const cookie of getSetCookieHeaderValues(coreResponse)) {
    headers.append("set-cookie", cookie);
  }

  return headers;
}

/**
 * Forwards legacy web `/api/auth/*` traffic to Core Better Auth at `/auth/*`.
 * Web removed its local Better Auth handler in #3194; bots and stale clients
 * still hit the old path (SOKOSUMI-Q0).
 */
export async function proxyLegacyCoreAuthRequest(
  request: NextRequest,
  pathSegments: string[],
): Promise<Response> {
  const contentType = request.headers.get("content-type");
  const coreResponse = await fetchCoreAuth(
    buildLegacyCoreAuthUrl(request, pathSegments),
    {
      method: request.method,
      body:
        request.method === "GET" || request.method === "HEAD"
          ? undefined
          : await request.arrayBuffer(),
      headers: contentType ? { "Content-Type": contentType } : undefined,
    },
  );

  return new Response(coreResponse.body, {
    status: coreResponse.status,
    statusText: coreResponse.statusText,
    headers: buildProxiedResponseHeaders(coreResponse),
  });
}
