import { Hono } from "hono";

import { handleOAuthAuthServerMetadata } from "@/lib/auth-issuer-metadata.js";

const app = new Hono();

// RFC 8414 path for issuer `{baseURL}/auth` (root-level; not under /auth mount).
app.get("/.well-known/oauth-authorization-server/auth", (c) =>
  handleOAuthAuthServerMetadata(c.req.raw),
);

export default app;
