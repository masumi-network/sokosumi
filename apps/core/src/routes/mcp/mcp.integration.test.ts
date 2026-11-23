import { createMCPClient } from "@ai-sdk/mcp";
import { Hono } from "hono";
import { requestId } from "hono/request-id";
import { afterEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import type { McpTokenVerification } from "@/lib/sokosumi-mcp/auth";
import { MCP_TOOLS } from "@/lib/sokosumi-mcp/tools";

import mcpRouter from "./index";

/**
 * A real MCP client against `/mcp` over `app.request`: the handshake, the tool
 * list, a tool call that runs a `/v1` route in process, and the sign-in
 * challenge. Token verification and the database are the only fakes.
 */

const { CORE, USER } = vi.hoisted(() => ({
  CORE: "https://core.example.test",
  USER: {
    id: "user_mcp",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    name: "Ada",
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@example.com",
    emailVerified: true,
    image: null,
    role: "user",
  },
}));

vi.mock("@/lib/auth", () => ({
  auth: { $context: Promise.resolve({ baseURL: `${CORE}/auth` }) },
}));
vi.mock("@/lib/sokosumi-mcp/auth", () => ({
  verifyMcpAccessToken: async (token: string): Promise<McpTokenVerification> =>
    token === "mcp-token"
      ? {
          status: "active",
          authContext: {
            actor: "user",
            userId: USER.id,
            organizationId: null,
            role: "user",
            authenticationMethod: "oauth",
            oauthClientId: "mcp-client",
          },
        }
      : { status: "invalid_token" },
}));
vi.mock("@/lib/db/prisma", () => ({
  default: { user: { findUnique: async () => USER } },
}));

const app = new Hono();
app.use(requestId());
app.onError(errorHandler);
app.route("/mcp", mcpRouter);

const clients: { close(): Promise<void> }[] = [];

async function connect(headers: Record<string, string>) {
  const client = await createMCPClient({
    transport: {
      type: "http",
      url: `${CORE}/mcp`,
      headers,
      fetch: async (input, init) => app.request(input, init),
    },
  });
  clients.push(client);
  return client;
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe("Sokosumi MCP server", () => {
  it("serves its tools to a signed-in MCP client", async () => {
    const client = await connect({ Authorization: "Bearer mcp-token" });

    expect(client.serverInfo).toMatchObject({ name: "sokosumi" });
    expect(client.instructions).toContain("workspaces_list");

    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual(
      MCP_TOOLS.map((tool) => tool.name),
    );
    expect(tools.find((tool) => tool.name === "tasks_get")).toMatchObject({
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" }, workspace: { type: "string" } },
        required: ["id"],
      },
      annotations: { readOnlyHint: true },
    });

    const me = await client.callTool({
      name: "users_get",
      arguments: { id: "me" },
    });
    expect(me.isError).toBeFalsy();
    expect(me.structuredContent).toEqual({
      data: expect.objectContaining({ id: USER.id, email: USER.email }),
    });

    const missing = await client.callTool({
      name: "tasks_get",
      arguments: {},
    });
    expect(missing).toMatchObject({
      isError: true,
      structuredContent: { status: 422, message: 'Missing argument "id".' },
    });
  }, 15_000);

  it("challenges a client without a token to sign in", async () => {
    await expect(connect({})).rejects.toThrow();

    const response = await app.request(`${CORE}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe(
      `Bearer resource_metadata="${CORE}/.well-known/oauth-protected-resource/mcp", scope="sokosumi:mcp"`,
    );
  });
});
