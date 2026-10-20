import type { EnvConfig } from "@/config/env";

/**
 * Vercel terminates TLS before the function and `@hono/node-server` reads the
 * scheme off the socket, so a deployment sees every request as plain HTTP.
 * Whatever compares the request URL to a public one then fails: an origin
 * check, the OAuth-proxy production URL, the URL reported to Sentry.
 * Better Auth 1.7.9 checks DPoP `htu` against `baseURL`, not `request.url`.
 *
 * The scheme is a constant here, not `x-forwarded-proto`. Vercel redirects
 * HTTP to HTTPS before a function runs, so a deployment is only ever reached
 * over HTTPS and no header has to be trusted. Off Vercel the socket is the
 * only honest signal, and a forwarded header is whatever the client sent.
 */
export function withPublicScheme(
  request: Request,
  vercelEnv: EnvConfig["VERCEL_ENV"],
): Request {
  if (vercelEnv !== "production" && vercelEnv !== "preview") {
    return request;
  }
  // `new Request` refuses TRACE. No route answers it, so it keeps its URL.
  if (!request.url.startsWith("http:") || request.method === "TRACE") {
    return request;
  }
  return new Request(request.url.replace("http:", "https:"), {
    method: request.method,
    headers: request.headers,
    body: request.body,
    signal: request.signal,
    // Node requires it for a streamed body; the DOM's RequestInit omits it.
    duplex: "half",
  } as RequestInit);
}
