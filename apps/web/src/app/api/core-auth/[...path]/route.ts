import type { NextRequest } from "next/server";

import {
  fetchCoreAuth,
  getCoreAuthBaseUrl,
} from "@/lib/auth/auth.server.client";
import { joinCoreApiPath } from "@/lib/clients/utils/core-api-base-url.shared";

const FORWARDED_REQUEST_HEADERS = [
  "accept",
  "authorization",
  "content-type",
] as const;

const STRIPPED_RESPONSE_HEADERS = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "keep-alive",
  "transfer-encoding",
]);

interface CoreAuthProxyContext {
  params: Promise<{
    path: string[];
  }>;
}

function buildForwardHeaders(requestHeaders: Headers): Headers {
  const headers = new Headers();

  for (const headerName of FORWARDED_REQUEST_HEADERS) {
    const value = requestHeaders.get(headerName);
    if (value) {
      headers.set(headerName, value);
    }
  }

  return headers;
}

function buildResponseHeaders(responseHeaders: Headers): Headers {
  const headers = new Headers();

  responseHeaders.forEach((value, key) => {
    if (!STRIPPED_RESPONSE_HEADERS.has(key.toLowerCase())) {
      headers.append(key, value);
    }
  });

  return headers;
}

async function proxyCoreAuthRequest(
  request: NextRequest,
  context: CoreAuthProxyContext,
): Promise<Response> {
  const { path } = await context.params;
  const corePath = path.map((segment) => encodeURIComponent(segment)).join("/");
  const coreUrl = `${joinCoreApiPath(
    getCoreAuthBaseUrl(),
    corePath,
  )}${request.nextUrl.search}`;
  const hasBody = request.method !== "GET" && request.method !== "HEAD";

  const response = await fetchCoreAuth(coreUrl, {
    method: request.method,
    headers: buildForwardHeaders(request.headers),
    body: hasBody ? await request.arrayBuffer() : undefined,
  });

  return new Response(response.body, {
    status: response.status,
    headers: buildResponseHeaders(response.headers),
  });
}

export const GET = proxyCoreAuthRequest;
export const POST = proxyCoreAuthRequest;
export const PUT = proxyCoreAuthRequest;
export const PATCH = proxyCoreAuthRequest;
export const DELETE = proxyCoreAuthRequest;
