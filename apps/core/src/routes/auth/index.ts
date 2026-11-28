import { AUTH_CAPTCHA_HEADER } from "@sokosumi/utils";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { TIME } from "@/config/constants";
import { resolveCorsAllowOrigin } from "@/config/cors-allow-origin";
import { auth } from "@/lib/auth.js";
import {
  handleOAuthAuthServerMetadata,
  handleOpenIdConfiguration,
} from "@/lib/auth-issuer-metadata.js";
import {
  handleOAuthTokenRequest,
  isRefreshTokenRotating,
} from "@/lib/auth-oauth-provider.js";
import { OAUTH_REFRESH_TOKEN_PREFIX } from "@/lib/auth-oauth-token-prefixes.js";
import prisma from "@/lib/db/prisma";
import { requireMainnetOnlyFeatureForMethods } from "@/middleware/mainnet-only-feature";
import {
  NETWORK_HEADER,
  requestNetworkMiddleware,
} from "@/middleware/network-scope";
import { handleSetPassword } from "@/routes/auth/set-password.route.js";

const app = new Hono();

// CORS for auth routes
app.use(
  "*",
  cors({
    origin: (origin) => resolveCorsAllowOrigin(origin),
    allowHeaders: [
      "Content-Type",
      "Authorization",
      AUTH_CAPTCHA_HEADER,
      NETWORK_HEADER,
    ],
    allowMethods: ["POST", "GET", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: TIME.CORS_MAX_AGE,
    credentials: true,
  }),
);
// After CORS, so a browser can read the 400.
app.use("*", requestNetworkMiddleware);

// Better Auth's setPassword is server-only (no HTTP route). Web's server auth
// client calls POST /auth/set-password when linking a credential account.
app.post("/set-password", handleSetPassword);

// OAuth issuer metadata (mounted under /auth). Must register before the catch-all.
app.get("/.well-known/oauth-authorization-server", (c) =>
  handleOAuthAuthServerMetadata(c.req.raw),
);
app.get("/.well-known/openid-configuration", (c) =>
  handleOpenIdConfiguration(c.req.raw),
);

// Refresh-rotation retry wraps Better Auth's token handler.
app.post("/oauth2/token", (c) =>
  handleOAuthTokenRequest(
    c.req.raw,
    auth.handler,
    (body, request) =>
      auth.api.oauth2Token({
        body,
        request,
        headers: request.headers,
        asResponse: true,
      }),
    (refreshToken) =>
      isRefreshTokenRotating(
        refreshToken,
        OAUTH_REFRESH_TOKEN_PREFIX,
        (token) =>
          prisma.oauthRefreshToken.findUnique({
            where: { token },
            select: { rotatedAt: true, rotationReplayExpiresAt: true },
          }),
      ),
  ),
);

// Better Auth authenticates inside its handler, so subscription billing routes
// refuse Preprod before Better Auth runs (signed in or not, zero session reads).
app.use(
  "/subscription/*",
  requireMainnetOnlyFeatureForMethods(["GET", "POST"]),
);

app.on(["POST", "GET"], "*", (c) => auth.handler(c.req.raw));

export default app;
