import {
  oauthProviderAuthServerMetadata,
  oauthProviderOpenIdConfigMetadata,
} from "@better-auth/oauth-provider";
import { AUTH_CAPTCHA_HEADER } from "@sokosumi/utils";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { TIME } from "@/config/constants";
import { resolveCorsAllowOrigin } from "@/config/cors-allow-origin";
import { auth } from "@/lib/auth.js";
import {
  handleOAuthTokenRequest,
  isRefreshTokenRotating,
  OAUTH_REFRESH_TOKEN_PREFIX,
} from "@/lib/auth-oauth-provider.js";
import prisma from "@/lib/db/prisma";
import { handleSetPassword } from "@/routes/auth/set-password.route.js";

const oauthAuthServerMetadataHandler = oauthProviderAuthServerMetadata(auth);
const oauthOpenIdConfigHandler = oauthProviderOpenIdConfigMetadata(auth);

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
  oauthAuthServerMetadataHandler(c.req.raw),
);
app.get("/.well-known/openid-configuration", (c) =>
  oauthOpenIdConfigHandler(c.req.raw),
);

// Mount Auth routes. Token requests are adjusted first: see
// `handleOAuthTokenRequest`.
app.on(["POST", "GET"], "*", async (c) => {
  return handleOAuthTokenRequest(
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
  );
});

export default app;
