import "server-only";

import { AUTH_CAPTCHA_HEADER } from "@sokosumi/utils";
import type { NextRequest } from "next/server";

import {
  fetchCoreAuth,
  getCoreAuthBaseUrl,
} from "@/lib/auth/auth.server.client";
import { appendProxiedSetCookies } from "@/lib/http/set-cookies";

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

function buildProxiedResponseHeaders(coreResponse: Response): Headers {
  const headers = new Headers();
  const contentType = coreResponse.headers.get("content-type");

  if (contentType) {
    headers.set("content-type", contentType);
  }

  appendProxiedSetCookies(headers, coreResponse);

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
  const headers = new Headers();
  for (const name of ["content-type", AUTH_CAPTCHA_HEADER]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const coreResponse = await fetchCoreAuth(
    buildLegacyCoreAuthUrl(request, pathSegments),
    {
      method: request.method,
      body:
        request.method === "GET" || request.method === "HEAD"
          ? undefined
          : await request.arrayBuffer(),
      headers,
    },
  );

  return new Response(coreResponse.body, {
    status: coreResponse.status,
    statusText: coreResponse.statusText,
    headers: buildProxiedResponseHeaders(coreResponse),
  });
}
