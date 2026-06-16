import { oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider";
import { Hono } from "hono";

import { auth } from "@/lib/auth.js";

const oauthAuthServerMetadataHandler = oauthProviderAuthServerMetadata(auth);

const app = new Hono();

// RFC 8414 path for issuer `{baseURL}/auth` (root-level; not under /auth mount).
app.get("/.well-known/oauth-authorization-server/auth", (c) =>
  oauthAuthServerMetadataHandler(c.req.raw),
);

export default app;
