import { createMCPClient } from "@ai-sdk/mcp";
import { Hono } from "hono";
import { requestId } from "hono/request-id";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import mcpRouter from "@/routes/mcp/index";

import type { McpTokenVerification } from "./auth";
import { coreV1 } from "./dispatch";
import { MCP_TOOLS } from "./tools";

/**
 * One fixture per tool in `MCP_TOOLS`: the arguments an agent would send.
 * Each runs through a real MCP client, and the `/v1` request it makes must be
 * the tool's operation (docs/agents/agent-surface.md). Add a fixture with
 * every new tool.
 */
const FIXTURES: Record<string, Record<string, unknown>> = {
  users_get: { id: "me" },
  workspaces_list: { id: "me" },
  tasks_list: { workspace: "acme", status: ["READY", "RUNNING"], limit: 5 },
  tasks_get: { id: "SOK-123", workspace: "acme" },
};

const CORE = "https://core.example.test";

vi.mock("@/lib/auth", () => ({
  auth: {
    $context: Promise.resolve({ baseURL: "https://core.example.test/auth" }),
  },
}));
vi.mock("./auth", () => ({
  verifyMcpAccessToken: async (): Promise<McpTokenVerification> => ({
    status: "active",
    authContext: {
      actor: "user",
      userId: "user_mcp",
      organizationId: null,
      role: "user",
      authenticationMethod: "oauth",
    },
  }),
}));

/** `GET /tasks/{id}` → /^\/tasks\/[^/]+$/ */
function pathPattern(path: string): RegExp {
  return new RegExp(`^${path.replace(/\{[^}]+\}/g, "[^/]+")}$`);
}

let client: Awaited<ReturnType<typeof createMCPClient>>;

beforeAll(async () => {
  const app = new Hono();
  app.use(requestId());
  app.onError(errorHandler);
  app.route("/mcp", mcpRouter);
  client = await createMCPClient({
    transport: {
      type: "http",
      url: `${CORE}/mcp`,
      headers: { Authorization: "Bearer mcp-token" },
      fetch: async (input, init) => app.request(input, init),
    },
  });
});

afterAll(async () => {
  await client.close();
});

describe("MCP tool surface", () => {
  it("has a fixture for every tool, and no other", () => {
    expect(Object.keys(FIXTURES).sort()).toEqual(
      MCP_TOOLS.map((tool) => tool.name).sort(),
    );
  });

  it.each(MCP_TOOLS)(
    "$name calls $operation",
    async (tool) => {
      const fetch = vi
        .spyOn(coreV1, "fetch")
        .mockResolvedValue(Response.json({ data: {} }));

      const result = await client.callTool({
        name: tool.name,
        arguments: FIXTURES[tool.name],
      });

      expect(result.isError).toBeFalsy();
      expect(fetch).toHaveBeenCalledOnce();
      const request = fetch.mock.calls[0]?.[0] as Request;
      const [method = "", path = ""] = tool.operation.split(" ");
      expect(request.method).toBe(method);
      expect(new URL(request.url).pathname).toMatch(pathPattern(path));
      fetch.mockRestore();
    },
    15_000,
  );
});
