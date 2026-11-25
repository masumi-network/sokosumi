import { Hono } from "hono";
import { requestId } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import type { McpTokenVerification } from "@/lib/sokosumi-mcp/auth";

import mcpRouter from "./index";

const { verifyMock } = vi.hoisted(() => ({ verifyMock: vi.fn() }));

vi.mock("@/lib/auth", () => ({
  auth: {
    $context: Promise.resolve({ baseURL: "https://core.example.test/auth" }),
  },
}));
vi.mock("@/lib/sokosumi-mcp/auth", () => ({
  verifyMcpAccessToken: verifyMock,
}));

const METADATA =
  'resource_metadata="https://core.example.test/.well-known/oauth-protected-resource/mcp"';

function createApp() {
  const app = new Hono();
  app.use(requestId());
  app.onError(errorHandler);
  app.route("/mcp", mcpRouter);
  return app;
}

function post(headers: Record<string, string> = {}) {
  return createApp().request("https://core.example.test/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
}

describe("/mcp", () => {
  beforeEach(() => {
    verifyMock.mockReset();
  });

  it("challenges a request without a token to sign in", async () => {
    const response = await post();

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe(
      `Bearer ${METADATA}, scope="sokosumi:mcp"`,
    );
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it("answers an invalid token with invalid_token", async () => {
    verifyMock.mockResolvedValue({
      status: "invalid_token",
    } satisfies McpTokenVerification);

    const response = await post({ Authorization: "Bearer sokosumi_api_key" });

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe(
      `Bearer error="invalid_token", ${METADATA}, scope="sokosumi:mcp"`,
    );
    expect(verifyMock).toHaveBeenCalledWith(
      "sokosumi_api_key",
      expect.anything(),
    );
  });

  it("answers a token without sokosumi:mcp with 403 insufficient_scope", async () => {
    verifyMock.mockResolvedValue({
      status: "insufficient_scope",
    } satisfies McpTokenVerification);

    const response = await post({ Authorization: "Bearer narrow" });

    expect(response.status).toBe(403);
    expect(response.headers.get("WWW-Authenticate")).toBe(
      `Bearer error="insufficient_scope", ${METADATA}, scope="sokosumi:mcp"`,
    );
    expect(await response.json()).toMatchObject({ kind: "insufficient_scope" });
  });

  it.each(["GET", "DELETE"])(
    "answers %s with 405: it keeps no session",
    async (method) => {
      const response = await createApp().request(
        "https://core.example.test/mcp",
        {
          method,
        },
      );

      expect(response.status).toBe(405);
      expect(response.headers.get("Allow")).toBe("POST");
    },
  );

  it("lets a browser client from any origin send its token and protocol version", async () => {
    const response = await createApp().request(
      "https://core.example.test/mcp",
      {
        method: "OPTIONS",
        headers: {
          Origin: "https://inspector.example.test",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers":
            "authorization,mcp-protocol-version",
        },
      },
    );

    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain(
      "MCP-Protocol-Version",
    );
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe("POST");
  });
});
