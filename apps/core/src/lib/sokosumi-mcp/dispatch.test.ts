// Before `@/middleware/auth` loads `@sokosumi/utils`: zod 4 gives a schema
// `.openapi` only if `@hono/zod-openapi` loaded before the schema was built.
import "@hono/zod-openapi";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type AuthVariables,
  preAuthenticatedRequests,
} from "@/middleware/auth";

import { callTool, coreV1, type ToolCaller } from "./dispatch";
import {
  deriveToolInput,
  type OpenApiDocument,
  type ToolInput,
} from "./tool-schema";

// `/users/{id}` routes look the user up before the handler runs.
vi.mock("@/lib/db/prisma", () => ({
  default: { user: { findUnique: async () => ({ id: "user_mcp" }) } },
}));

const caller: ToolCaller = {
  authContext: {
    actor: "user",
    userId: "user_mcp",
    organizationId: null,
    role: "user",
    authenticationMethod: "oauth",
  },
  origin: "https://core.example.test",
  requestId: "req-mcp-1",
};

const doc: OpenApiDocument = {
  paths: {
    "/things/{id}": {
      patch: {
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
          { name: "status", in: "query", schema: { type: "array" } },
          { name: "limit", in: "query", schema: { type: "integer" } },
        ],
        requestBody: {
          content: { "application/json": { schema: { type: "object" } } },
        },
      },
    },
  },
};
const patchThing = deriveToolInput(doc, "PATCH /things/{id}");

function answer(status: number, body?: unknown) {
  const fetch = vi
    .spyOn(coreV1, "fetch")
    .mockResolvedValue(
      body === undefined
        ? new Response(null, { status })
        : Response.json(body, { status }),
    );
  return () => fetch.mock.calls[0]?.[0] as Request;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("callTool", () => {
  it("builds the /v1 request from the arguments, pre-authenticated as the caller", async () => {
    const sent = answer(200, { data: {} });

    await callTool(
      patchThing,
      {
        id: "SOK 1/2",
        status: ["READY", "DONE"],
        limit: 5,
        workspace: "acme",
        body: { name: "New" },
      },
      caller,
    );

    const request = sent();
    expect(request.method).toBe("PATCH");
    expect(request.url).toBe(
      "https://core.example.test/things/SOK%201%2F2?status=READY&status=DONE&limit=5",
    );
    expect(request.headers.get("X-Organization-Slug")).toBe("acme");
    expect(request.headers.get("X-Request-Id")).toBe("req-mcp-1");
    expect(request.headers.get("Authorization")).toBeNull();
    expect(await request.json()).toEqual({ name: "New" });
    expect(preAuthenticatedRequests.get(request)).toEqual<AuthVariables>({
      isAuthenticated: true,
      authContext: caller.authContext,
    });
  });

  it("returns Core's data and pagination as structured content", async () => {
    const pagination = { cursor: null, limit: 1, total: 2, nextCursor: "t2" };
    answer(200, {
      data: [{ id: "t1" }],
      meta: {
        timestamp: "2026-11-23T00:00:00.000Z",
        requestId: "x",
        pagination,
      },
    });

    const result = await callTool(patchThing, { id: "t1" }, caller);

    const structuredContent = { data: [{ id: "t1" }], pagination };
    expect(result).toEqual({
      content: [{ type: "text", text: JSON.stringify(structuredContent) }],
      structuredContent,
    });
  });

  it("returns an empty answer as null data", async () => {
    answer(204);

    const result = await callTool(patchThing, { id: "t1" }, caller);

    expect(result.structuredContent).toEqual({ data: null });
  });

  it("returns a Core error as isError with its status, kind, message and details", async () => {
    answer(429, {
      error: "Too Many Requests",
      message: "Slow down",
      kind: "rate_limited",
      retryAfterSeconds: 30,
      meta: { requestId: "x" },
    });

    const result = await callTool(patchThing, { id: "t1" }, caller);

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      status: 429,
      kind: "rate_limited",
      message: "Slow down",
      details: { retryAfterSeconds: 30 },
    });
  });

  it("hides a server error behind a generic message and the request id", async () => {
    answer(500, { error: "Internal Server Error", message: "prisma said x" });

    const result = await callTool(patchThing, { id: "t1" }, caller);

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      status: 500,
      message: "Sokosumi could not complete this request.",
      requestId: "req-mcp-1",
    });
  });

  it("rejects an unknown or missing argument without calling Core", async () => {
    const fetch = vi.spyOn(coreV1, "fetch");

    const unknown = await callTool(patchThing, { id: "t1", nme: "x" }, caller);
    const missing = await callTool(patchThing, {}, caller);

    expect(fetch).not.toHaveBeenCalled();
    expect(unknown).toMatchObject({
      isError: true,
      structuredContent: {
        status: 422,
        message:
          'Unknown argument "nme". This tool takes: workspace, id, status, limit, body.',
      },
    });
    expect(missing.structuredContent).toEqual({
      status: 422,
      message: 'Missing argument "id".',
    });
  });

  it.each([
    [{ id: ".." }, 'Argument "id" must be an id.'],
    [{ id: "." }, 'Argument "id" must be an id.'],
    [{ id: { nested: true } }, 'Argument "id" must be an id.'],
    [
      { id: "t1", workspace: 7 },
      'Argument "workspace" must be a workspace slug.',
    ],
    [
      { id: "t1", workspace: "acme\nX-Admin: 1" },
      'Argument "workspace" must be a workspace slug.',
    ],
    [
      { id: "t1", workspace: "acme corp" },
      'Argument "workspace" must be a workspace slug.',
    ],
    [
      { id: "t1", workspace: "acme\u0101" },
      'Argument "workspace" must be a workspace slug.',
    ],
  ])(
    "rejects %j, which would reach another operation or workspace",
    async (args, message) => {
      const fetch = vi.spyOn(coreV1, "fetch");

      const result = await callTool(patchThing, args, caller);

      expect(fetch).not.toHaveBeenCalled();
      expect(result.structuredContent).toEqual({ status: 422, message });
    },
  );

  it("answers a fault before Core answers with the generic error", async () => {
    vi.spyOn(coreV1, "fetch").mockRejectedValue(new Error("boom"));
    const result = await callTool(patchThing, { id: "t1" }, caller);

    expect(result.structuredContent).toEqual({
      status: 500,
      message: "Sokosumi could not complete this request.",
      requestId: "req-mcp-1",
    });
  });

  it("answers a route /v1 does not serve with route_not_found", async () => {
    const gone: ToolInput = {
      ...patchThing,
      method: "GET",
      path: "/gone/{id}",
    };

    const result = await callTool(gone, { id: "x" }, caller);

    expect(result.structuredContent).toEqual({
      status: 404,
      kind: "route_not_found",
      message: "Not Found",
    });
  });

  it("keeps another user's data closed to an MCP caller", async () => {
    const usersGet: ToolInput = {
      method: "GET",
      path: "/users/{id}",
      pathParams: ["id"],
      queryParams: [],
      hasBody: false,
      inputSchema: { type: "object", properties: { id: { type: "string" } } },
    };

    const result = await callTool(usersGet, { id: "user_other" }, caller);

    expect(result.structuredContent).toMatchObject({ status: 403 });
  });

  it("keeps interactive-only routes closed to MCP callers", async () => {
    const sessions: ToolInput = {
      method: "GET",
      path: "/users/{id}/sessions",
      pathParams: ["id"],
      queryParams: [],
      hasBody: false,
      inputSchema: { type: "object", properties: { id: { type: "string" } } },
    };

    const result = await callTool(sessions, { id: "me" }, caller);

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      status: 403,
      message: "Interactive session required to manage credentials",
    });
  });
});
