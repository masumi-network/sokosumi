import { OpenAPIHono } from "@hono/zod-openapi";
import { CoworkerGrantScope, CoworkerGrantStatus } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";

import mountResolveCoworkerGrant from "./[id]/patch";
import mountGetCoworkerGrants from "./get";

const {
  grantFindFirstMock,
  grantFindManyMock,
  grantFindUniqueOrThrowMock,
  grantUpdateMock,
  taskEventDeleteManyMock,
  taskEventUpdateManyMock,
} = vi.hoisted(() => ({
  grantFindFirstMock: vi.fn(),
  grantFindManyMock: vi.fn(),
  grantFindUniqueOrThrowMock: vi.fn(),
  grantUpdateMock: vi.fn(),
  taskEventDeleteManyMock: vi.fn(),
  taskEventUpdateManyMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    coworkerGrant: {
      findFirst: grantFindFirstMock,
      findMany: grantFindManyMock,
      findUniqueOrThrow: grantFindUniqueOrThrowMock,
      update: grantUpdateMock,
    },
    taskEvent: {
      updateMany: taskEventUpdateManyMock,
      deleteMany: taskEventDeleteManyMock,
    },
  },
}));

const USER_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

const DELEGATED_COWORKER_CONTEXT: AuthenticationContext = {
  actor: "coworker",
  coworkerId: "cow_123",
  delegation: { userId: "user_123", organizationId: null },
};

function createApp(authContext: AuthenticationContext) {
  const app = new OpenAPIHono<{ Variables: AuthVariables }>();
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });
  mountGetCoworkerGrants(app as unknown as OpenAPIHonoWithAuth);
  mountResolveCoworkerGrant(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

function grantRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "grant_1",
    scope: CoworkerGrantScope.TASK_COMMENT,
    status: CoworkerGrantStatus.PENDING,
    createdAt: new Date("2026-07-01T12:00:00.000Z"),
    resolvedAt: null,
    coworker: {
      id: "cow_123",
      slug: "hermes",
      name: "Hermes",
      image: null,
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /coworker-grants", () => {
  it("lists the session user's grants", async () => {
    grantFindManyMock.mockResolvedValueOnce([grantRow()]);

    const app = createApp(USER_CONTEXT);
    const response = await app.request("http://localhost/");

    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: Array<{ id: string }> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      id: "grant_1",
      scope: CoworkerGrantScope.TASK_COMMENT,
      status: CoworkerGrantStatus.PENDING,
      coworker: { slug: "hermes" },
    });
    expect(grantFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user_123" } }),
    );
  });

  it("rejects delegated coworkers — a coworker cannot inspect its own requests", async () => {
    const app = createApp(DELEGATED_COWORKER_CONTEXT);
    const response = await app.request("http://localhost/");

    expect(response.status).toBe(403);
    expect(grantFindManyMock).not.toHaveBeenCalled();
  });
});

describe("PATCH /coworker-grants/{id}", () => {
  it("approves a pending grant and stamps resolvedAt", async () => {
    grantFindFirstMock.mockResolvedValueOnce({
      id: "grant_1",
      status: CoworkerGrantStatus.PENDING,
    });
    grantUpdateMock.mockResolvedValueOnce(
      grantRow({
        status: CoworkerGrantStatus.GRANTED,
        resolvedAt: new Date("2026-07-05T12:00:00.000Z"),
      }),
    );

    const app = createApp(USER_CONTEXT);
    const response = await app.request("http://localhost/grant_1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: CoworkerGrantStatus.GRANTED }),
    });

    expect(response.status).toBe(200);
    expect(grantUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "grant_1" },
        data: expect.objectContaining({
          status: CoworkerGrantStatus.GRANTED,
          resolvedAt: expect.any(Date),
        }),
      }),
    );
    // Approval releases comments held under this grant into the thread.
    expect(taskEventUpdateManyMock).toHaveBeenCalledWith({
      where: { heldByGrantId: "grant_1" },
      data: { heldByGrantId: null },
    });
    expect(taskEventDeleteManyMock).not.toHaveBeenCalled();
  });

  it("denying a pending grant discards comments held under it", async () => {
    grantFindFirstMock.mockResolvedValueOnce({
      id: "grant_1",
      status: CoworkerGrantStatus.PENDING,
    });
    grantUpdateMock.mockResolvedValueOnce(
      grantRow({
        status: CoworkerGrantStatus.DENIED,
        resolvedAt: new Date("2026-07-05T12:00:00.000Z"),
      }),
    );

    const app = createApp(USER_CONTEXT);
    const response = await app.request("http://localhost/grant_1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: CoworkerGrantStatus.DENIED }),
    });

    expect(response.status).toBe(200);
    expect(taskEventDeleteManyMock).toHaveBeenCalledWith({
      where: { heldByGrantId: "grant_1" },
    });
    expect(taskEventUpdateManyMock).not.toHaveBeenCalled();
  });

  it("is idempotent when the grant already has the target status", async () => {
    grantFindFirstMock.mockResolvedValueOnce({
      id: "grant_1",
      status: CoworkerGrantStatus.GRANTED,
    });
    grantFindUniqueOrThrowMock.mockResolvedValueOnce(
      grantRow({ status: CoworkerGrantStatus.GRANTED }),
    );

    const app = createApp(USER_CONTEXT);
    const response = await app.request("http://localhost/grant_1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: CoworkerGrantStatus.GRANTED }),
    });

    expect(response.status).toBe(200);
    expect(grantUpdateMock).not.toHaveBeenCalled();
  });

  it("404s on another user's grant", async () => {
    grantFindFirstMock.mockResolvedValueOnce(null);

    const app = createApp(USER_CONTEXT);
    const response = await app.request("http://localhost/grant_other", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: CoworkerGrantStatus.DENIED }),
    });

    expect(response.status).toBe(404);
  });

  it("rejects PENDING as a user-set target status", async () => {
    const app = createApp(USER_CONTEXT);
    const response = await app.request("http://localhost/grant_1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: CoworkerGrantStatus.PENDING }),
    });

    expect(response.status).toBe(400);
    expect(grantFindFirstMock).not.toHaveBeenCalled();
  });

  it("rejects delegated coworkers — a coworker cannot approve its own request", async () => {
    const app = createApp(DELEGATED_COWORKER_CONTEXT);
    const response = await app.request("http://localhost/grant_1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: CoworkerGrantStatus.GRANTED }),
    });

    expect(response.status).toBe(403);
    expect(grantUpdateMock).not.toHaveBeenCalled();
  });
});
