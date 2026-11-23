import { createMcpHandler } from "@modelcontextprotocol/server";
import { CORE_API_ERROR_KINDS, OAUTH_SCOPE_MCP } from "@sokosumi/utils";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { RequestIdVariables } from "hono/request-id";

import { TIME } from "@/config/constants.js";
import { forbidden, unauthorized } from "@/helpers/error.js";
import { auth } from "@/lib/auth.js";
import { verifyMcpAccessToken } from "@/lib/sokosumi-mcp/auth.js";
import { createSokosumiMcpServer } from "@/lib/sokosumi-mcp/server.js";

/**
 * Core's MCP server (`{origin}/mcp`, ADR 0076): Streamable HTTP, stateless,
 * POST only, JSON responses. Each request verifies its MCP token and builds a
 * fresh server that runs tool calls through `/v1` in process.
 */
const app = new Hono<{ Variables: RequestIdVariables }>();

// Bearer tokens, no cookies, so any origin may call it.
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["POST"],
    allowHeaders: [
      "Authorization",
      "Content-Type",
      "MCP-Protocol-Version",
      // Sent by 2026-07-28 clients.
      "Mcp-Method",
      "Mcp-Name",
    ],
    exposeHeaders: ["WWW-Authenticate"],
    maxAge: TIME.CORS_MAX_AGE,
  }),
);

app.post("/", async (c) => {
  const issuer = (await auth.$context).baseURL;
  const token = /^Bearer\s+(\S+)\s*$/i.exec(
    c.req.header("authorization") ?? "",
  )?.[1];
  const verification = token
    ? await verifyMcpAccessToken(token, auth)
    : undefined;

  if (verification?.status !== "active") {
    if (verification?.status === "insufficient_scope") {
      throw forbidden(`The access token lacks the ${OAUTH_SCOPE_MCP} scope`, {
        kind: CORE_API_ERROR_KINDS.INSUFFICIENT_SCOPE,
        wwwAuthenticate: bearerChallenge(issuer, "insufficient_scope"),
      });
    }
    throw unauthorized("Sign in to use the Sokosumi MCP server", {
      wwwAuthenticate: bearerChallenge(issuer, token && "invalid_token"),
    });
  }

  const caller = {
    authContext: verification.authContext,
    origin: new URL(c.req.url).origin,
    requestId: c.var.requestId,
  };
  // The default response mode answers JSON while a handler sends no
  // notification before its result, which ours never do.
  return createMcpHandler(() => createSokosumiMcpServer(caller)).fetch(
    c.req.raw,
  );
});

// Stateless: no SSE stream to open (GET) and no session to end (DELETE).
app.all("/", (c) => c.body(null, 405, { Allow: "POST" }));

/**
 * RFC 6750 §3 with RFC 9728 §5.1: where the client finds the authorization
 * server, and the scope to ask for.
 */
function bearerChallenge(issuer: string, error?: string): string {
  const metadata = new URL("/.well-known/oauth-protected-resource/mcp", issuer)
    .href;
  const params = [
    ...(error ? [`error="${error}"`] : []),
    `resource_metadata="${metadata}"`,
    `scope="${OAUTH_SCOPE_MCP}"`,
  ];
  return `Bearer ${params.join(", ")}`;
}

export default app;
