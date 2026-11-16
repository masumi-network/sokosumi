import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

import mountDeleteAgentStar from "./[id]/star/delete.js";
import mountPostAgentStar from "./[id]/star/post.js";
import mountGetStarredAgents from "./starred/get.js";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const { agentFindFirstMock, upsertMock, deleteManyMock, findManyMock } =
  vi.hoisted(() => ({
    agentFindFirstMock: vi.fn(),
    upsertMock: vi.fn(),
    deleteManyMock: vi.fn(),
    findManyMock: vi.fn(),
  }));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    agent: { findFirst: agentFindFirstMock },
    agentStar: {
      upsert: upsertMock,
      deleteMany: deleteManyMock,
      findMany: findManyMock,
    },
  },
}));

const USER: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

const COWORKER: AuthenticationContext = {
  actor: "coworker",
  coworkerId: "coworker_123",
  vendorId: TEST_VENDOR_ID,
};

const AGENT_ID = "agent_1";
const STARRED_AT = new Date("2026-11-16T10:00:00.000Z");

function request(
  method: "GET" | "POST" | "DELETE",
  path: string,
  authContext: AuthenticationContext = USER,
) {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });
  mountGetStarredAgents(app);
  mountPostAgentStar(app);
  mountDeleteAgentStar(app);
  return app.request(`http://localhost${path}`, { method });
}

beforeEach(() => {
  vi.clearAllMocks();
  agentFindFirstMock.mockResolvedValue({ id: AGENT_ID });
  upsertMock.mockResolvedValue({ starredAt: STARRED_AT });
  deleteManyMock.mockResolvedValue({ count: 1 });
  findManyMock.mockResolvedValue([{ agentId: AGENT_ID }]);
});

describe("GET /agents/starred", () => {
  it("lists only the caller's own stars", async () => {
    const res = await request("GET", "/starred");

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ agentIds: [AGENT_ID] });
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user_123" } }),
    );
  });

  it("refuses a coworker, because a star belongs to a person", async () => {
    const res = await request("GET", "/starred", COWORKER);

    expect(res.status).toBe(403);
    expect(findManyMock).not.toHaveBeenCalled();
  });
});

describe("POST /agents/{id}/star", () => {
  it("stars a shown Agent and keeps the first starredAt", async () => {
    const res = await request("POST", `/${AGENT_ID}/star`);

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({
      agentId: AGENT_ID,
      starredAt: STARRED_AT.toISOString(),
    });
    expect(agentFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: AGENT_ID, isShown: true } }),
    );
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_agentId: { userId: "user_123", agentId: AGENT_ID } },
        create: { userId: "user_123", agentId: AGENT_ID },
        update: {},
      }),
    );
  });

  it("is a 404 for an Agent not in the catalog", async () => {
    agentFindFirstMock.mockResolvedValue(null);

    const res = await request("POST", "/missing/star");

    expect(res.status).toBe(404);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("refuses a coworker", async () => {
    const res = await request("POST", `/${AGENT_ID}/star`, COWORKER);

    expect(res.status).toBe(403);
    expect(upsertMock).not.toHaveBeenCalled();
  });
});

describe("DELETE /agents/{id}/star", () => {
  it("removes only the caller's star, even when it was never there", async () => {
    deleteManyMock.mockResolvedValue({ count: 0 });

    const res = await request("DELETE", `/${AGENT_ID}/star`);

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({
      agentId: AGENT_ID,
      starredAt: null,
    });
    expect(deleteManyMock).toHaveBeenCalledWith({
      where: { userId: "user_123", agentId: AGENT_ID },
    });
  });

  it("refuses a coworker", async () => {
    const res = await request("DELETE", `/${AGENT_ID}/star`, COWORKER);

    expect(res.status).toBe(403);
    expect(deleteManyMock).not.toHaveBeenCalled();
  });
});
