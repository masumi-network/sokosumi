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
import { handleSetPassword } from "@/routes/auth/set-password.route.js";

const app = new Hono();

// CORS for auth routes
app.use(
  "*",
  cors({
    origin: (origin) => resolveCorsAllowOrigin(origin),
    allowHeaders: ["Content-Type", "Authorization", AUTH_CAPTCHA_HEADER],
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
  handleOAuthAuthServerMetadata(c.req.raw),
);
app.get("/.well-known/openid-configuration", (c) =>
  handleOpenIdConfiguration(c.req.raw),
);

// Token requests are adjusted before Better Auth reads them.
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

app.on(["POST", "GET"], "*", (c) => auth.handler(c.req.raw));

export default app;
