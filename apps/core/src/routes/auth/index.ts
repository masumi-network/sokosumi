import {
  oauthProviderAuthServerMetadata,
  oauthProviderOpenIdConfigMetadata,
} from "@better-auth/oauth-provider";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { TIME } from "@/config/constants";
import { resolveCorsAllowOrigin } from "@/config/cors-allow-origin";
import { auth } from "@/lib/auth.js";
import { handleSetPassword } from "@/routes/auth/set-password.route.js";

const oauthAuthServerMetadataHandler = oauthProviderAuthServerMetadata(auth);
const oauthOpenIdConfigHandler = oauthProviderOpenIdConfigMetadata(auth);

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

// Mount Auth routes
app.on(["POST", "GET"], "*", (c) => {
  return auth.handler(c.req.raw);
});

export default app;
