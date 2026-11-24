import { createMCPClient } from "@ai-sdk/mcp";
import { Hono } from "hono";
import { requestId } from "hono/request-id";
import { afterEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import type { McpTokenVerification } from "@/lib/sokosumi-mcp/auth";
import {
  DEFAULT_TOOLSETS,
  MCP_TOOLS,
  toolsetOf,
} from "@/lib/sokosumi-mcp/tools";

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

async function connect(headers: Record<string, string>, query = "") {
  const client = await createMCPClient({
    transport: {
      type: "http",
      url: `${CORE}/mcp${query}`,
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

  it("lists the default toolsets, under 80 tools, unless the URL picks others", async () => {
    const auth = { Authorization: "Bearer mcp-token" };
    const listed = async (query?: string) =>
      (await (await connect(auth, query)).listTools()).tools.map(
        (tool) => tool.name,
      );

    const defaults = await listed();
    expect(defaults).toEqual(
      MCP_TOOLS.map((tool) => tool.name).filter((name) =>
        (DEFAULT_TOOLSETS as readonly string[]).includes(toolsetOf(name)),
      ),
    );
    expect(defaults.length).toBeLessThan(80);
    expect(new Set(defaults.map(toolsetOf))).toEqual(new Set(DEFAULT_TOOLSETS));

    expect(await listed("?toolsets=vendors,organizations")).toEqual([
      "vendors_me",
      "vendors_create",
      "organizations_list",
      "organizations_seat",
    ]);

    const client = await connect(auth, "?toolsets=tasks");
    expect(client.instructions).toContain("Toolsets on: tasks.");
    await expect(
      client.callTool({ name: "users_get", arguments: { id: "me" } }),
    ).rejects.toThrow("Unknown tool: users_get");
  }, 15_000);

  it("refuses an unknown toolset by name", async () => {
    await expect(
      connect({ Authorization: "Bearer mcp-token" }, "?toolsets=tasks,nope"),
    ).rejects.toThrow();

    const response = await app.request(`${CORE}/mcp?toolsets=tasks,nope`, {
      method: "POST",
      headers: {
        Authorization: "Bearer mcp-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      message:
        'Unknown toolset "nope". Toolsets: users, workspaces, tasks, jobs, agents, coworkers, vendors, organizations.',
    });
  });

  it("answers a 2026-07-28 request with JSON, and opens no subscription stream", async () => {
    const post = (method: string, params: Record<string, unknown>) =>
      app.request(`${CORE}/mcp`, {
        method: "POST",
        headers: {
          Authorization: "Bearer mcp-token",
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "MCP-Protocol-Version": "2026-07-28",
          "Mcp-Method": method,
          ...(typeof params.name === "string"
            ? { "Mcp-Name": params.name }
            : {}),
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method,
          params: {
            ...params,
            _meta: {
              "io.modelcontextprotocol/protocolVersion": "2026-07-28",
              "io.modelcontextprotocol/clientInfo": {
                name: "test",
                version: "1",
              },
              "io.modelcontextprotocol/clientCapabilities": {},
            },
          },
        }),
      });

    const call = await post("tools/call", {
      name: "users_get",
      arguments: { id: "me" },
    });
    expect(call.headers.get("Content-Type")).toContain("application/json");
    expect(await call.json()).toMatchObject({
      result: { structuredContent: { data: { id: USER.id } } },
    });

    const listen = await post("subscriptions/listen", {
      notifications: { toolsListChanged: true },
    });
    expect(listen.headers.get("Content-Type")).toContain("application/json");
    expect(await listen.json()).toMatchObject({ error: { code: -32601 } });
  });

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
