import {
  oauthProviderAuthServerMetadata,
  oauthProviderOpenIdConfigMetadata,
} from "@better-auth/oauth-provider";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { TIME } from "@/config/constants";
import { resolveCorsAllowOrigin } from "@/config/cors-allow-origin";
import { auth } from "@/lib/auth.js";
import { withClientSecretPostShim } from "@/routes/auth/oauth2-token-secret-shim.js";
import { handleSetPassword } from "@/routes/auth/set-password.route.js";

const oauthAuthServerMetadataHandler = oauthProviderAuthServerMetadata(auth);
const oauthOpenIdConfigHandler = oauthProviderOpenIdConfigMetadata(auth);

function isBrowserNavigation(request: Request): boolean {
  const secFetchMode = request.headers.get("sec-fetch-mode")?.toLowerCase();
  const accept = request.headers.get("accept")?.toLowerCase() ?? "";
  return (
    secFetchMode === "navigate" ||
    (!secFetchMode &&
      (accept.includes("text/html") ||
        accept.includes("application/xhtml+xml")))
  );
}

function resolveOAuthRedirectUrl(
  payload: unknown,
  requestUrl: string,
): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const candidate = payload as {
    redirect?: unknown;
    url?: unknown;
    data?: {
      redirect?: unknown;
      url?: unknown;
    };
  };
  const redirect = candidate.redirect ?? candidate.data?.redirect;
  const url = candidate.url ?? candidate.data?.url;
  if (redirect !== true || typeof url !== "string" || !url.trim()) {
    return null;
  }

  try {
    const resolvedUrl = new URL(url, requestUrl);
    return ["http:", "https:"].includes(resolvedUrl.protocol)
      ? resolvedUrl.href
      : null;
  } catch {
    return null;
  }
}

function redirectWithResponseHeaders(
  response: Response,
  redirectUrl: string,
): Response {
  const headers = new Headers(response.headers);
  const setCookies = response.headers.getSetCookie?.() ?? [];
  if (setCookies.length > 0) {
    headers.delete("set-cookie");
    for (const setCookie of setCookies) {
      headers.append("set-cookie", setCookie);
    }
  }
  headers.set("location", redirectUrl);
  return new Response(null, { headers, status: 302 });
}

const app = new Hono();

// CORS for auth routes
app.use(
  "*",
  cors({
    origin: (origin) => resolveCorsAllowOrigin(origin),
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["POST", "GET", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: TIME.CORS_MAX_AGE,
    credentials: true,
  }),
);

// Better Auth's setPassword is server-only (no HTTP route). Web's server auth
// client calls POST /auth/set-password when linking a credential account.
app.post("/set-password", handleSetPassword);

// OAuth issuer metadata (mounted under /auth). Must register before the catch-all.
app.get("/.well-known/oauth-authorization-server", (c) =>
  oauthAuthServerMetadataHandler(c.req.raw),
);
app.get("/.well-known/openid-configuration", (c) =>
  oauthOpenIdConfigHandler(c.req.raw),
);

// Better Auth returns OAuth authorization redirects as JSON for API clients.
// Browser navigation needs an HTTP redirect; other auth responses stay JSON.
app.get("/oauth2/authorize", async (c) => {
  if (!isBrowserNavigation(c.req.raw)) {
    return auth.handler(c.req.raw);
  }

  const response = await auth.handler(c.req.raw);
  if (!response.ok) return response;

  let payload: unknown;
  try {
    payload = await response.clone().json();
  } catch {
    return response;
  }

  const redirectUrl = resolveOAuthRedirectUrl(payload, c.req.url);
  return redirectUrl
    ? redirectWithResponseHeaders(response, redirectUrl)
    : response;
});

// Mount Auth routes. The token-endpoint shim (temporary) rewrites
// client_secret_post requests into the client_secret_basic form Better Auth
// requires — see oauth2-token-secret-shim.ts.
app.on(["POST", "GET"], "*", async (c) => {
  return auth.handler(await withClientSecretPostShim(c.req.raw));
});

export default app;
