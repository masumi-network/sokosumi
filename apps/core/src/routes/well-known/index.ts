import { Hono } from "hono";

import { auth } from "@/lib/auth.js";
import { handleOAuthAuthServerMetadata } from "@/lib/auth-issuer-metadata.js";
import { mcpProtectedResourceMetadata } from "@/lib/sokosumi-mcp/resource.js";

const app = new Hono();

// RFC 8414 path for issuer `{baseURL}/auth` (root-level; not under /auth mount).
app.get("/.well-known/oauth-authorization-server/auth", (c) =>
  handleOAuthAuthServerMetadata(c.req.raw),
);

// RFC 9728 metadata for the MCP server at `{origin}/mcp` (ADR 0076): the
// path-suffixed URL its 401 names, and the root URL MCP clients fall back to.
// The issuer is read from Better Auth, so it always matches the RFC 8414 doc.
for (const path of [
  "/.well-known/oauth-protected-resource/mcp",
  "/.well-known/oauth-protected-resource",
]) {
  app.get(path, async (c) =>
    c.json(mcpProtectedResourceMetadata((await auth.$context).baseURL)),
  );
}

export default app;
