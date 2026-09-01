import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildCoworkerUsableInWorkspaceWhere } from "@/helpers/access-control";
import { coworkerInclude } from "@/helpers/coworker";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import type { WorkspaceContext } from "@/middleware/workspace";

import mountGetCoworkers from "./get";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const { coworkerFindManyMock } = vi.hoisted(() => ({
  coworkerFindManyMock: vi.fn(),
}));

const expectedOrderBy = [{ priority: "desc" }, { slug: "asc" }] as const;

const personalWorkspaceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const personalWorkspaceContext: WorkspaceContext = {
  workspaceId: personalWorkspaceId,
  userId: "user_123",
  organizationId: null,
};

vi.mock("@/lib/db/prisma", () => ({
  default: {
    coworker: {
      findMany: coworkerFindManyMock,
    },
  },
}));

const coworkerAuth: AuthenticationContext = {
  actor: "coworker",
  coworkerId: "cow_456",
  vendorId: "01960001-0001-7001-8001-000000000001",
};

const sampleVendor = {
  id: "01960001-0001-7001-8001-000000000001",
  createdAt: new Date("2026-02-25T10:00:00.000Z"),
  updatedAt: new Date("2026-02-25T10:00:00.000Z"),
  name: "Serviceplan",
  slug: "serviceplan",
  logoLight: null,
  logoDark: null,
};

const usableInWorkspaceWhere =
  buildCoworkerUsableInWorkspaceWhere(personalWorkspaceId);

function createApp(
  authContext: AuthenticationContext = {
    actor: "user",
    userId: "user_123",
    organizationId: null,
    role: "user",
  },
  workspaceContext: WorkspaceContext | null = null,
) {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    c.set("workspaceContext", workspaceContext);
    return await next();
  });

  mountGetCoworkers(app);
  return app;
}

describe("GET /coworkers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns non-archived whitelisted coworkers by default", async () => {
    coworkerFindManyMock.mockResolvedValue([]);
    const app = createApp();

    const response = await app.request("http://localhost/");
    expect(response.status).toBe(200);
    expect(coworkerFindManyMock).toHaveBeenCalledWith({
      where: {
        archivedAt: null,
        isWhitelisted: true,
        sokoBotId: null,
      },
      orderBy: expectedOrderBy,
      include: coworkerInclude,
    });
  });

  it("returns isWhitelisted field in response", async () => {
    coworkerFindManyMock.mockResolvedValue([
      {
        id: "cow_123",
        createdAt: new Date("2026-02-25T10:00:00.000Z"),
        updatedAt: new Date("2026-02-25T10:00:00.000Z"),
        archivedAt: null,
        isWhitelisted: true,
        priority: 10,
        capabilities: ["chat", "tasks"],
        slug: "ops-agent",
        name: "Ops Agent",
        baseURL: null,
        vendor: sampleVendor,
      },
    ]);

    const app = createApp();
    const response = await app.request("http://localhost/");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data[0].isWhitelisted).toBe(true);
    expect(body.data[0].priority).toBe(10);
    expect(body.data[0].capabilities).toEqual(["chat", "tasks"]);
    expect(body.data[0].baseURL).toBeNull();
    expect(body.data[0].metadata).toBeNull();
  });

  it("can return all non-archived coworkers via scope=all", async () => {
    coworkerFindManyMock.mockResolvedValue([]);

    const app = createApp();
    const response = await app.request("http://localhost/?scope=all");

    expect(response.status).toBe(200);
    expect(coworkerFindManyMock).toHaveBeenCalledWith({
      where: {
        archivedAt: null,
        sokoBotId: null,
      },
      orderBy: expectedOrderBy,
      include: coworkerInclude,
    });
  });

  it("can return non-archived whitelisted coworkers via scope query", async () => {
    coworkerFindManyMock.mockResolvedValue([]);

    const app = createApp();
    const response = await app.request("http://localhost/?scope=whitelisted");

    expect(response.status).toBe(200);
    expect(coworkerFindManyMock).toHaveBeenCalledWith({
      where: {
        archivedAt: null,
        isWhitelisted: true,
        sokoBotId: null,
      },
      orderBy: expectedOrderBy,
      include: coworkerInclude,
    });
  });

  it("can return archived coworkers via scope query", async () => {
    coworkerFindManyMock.mockResolvedValue([]);

    const app = createApp();
    const response = await app.request("http://localhost/?scope=archived");

    expect(response.status).toBe(200);
    expect(coworkerFindManyMock).toHaveBeenCalledWith({
      where: {
        archivedAt: {
          not: null,
        },
      },
      orderBy: expectedOrderBy,
      include: coworkerInclude,
    });
  });

  it("filters coworkers by a single capability", async () => {
    coworkerFindManyMock.mockResolvedValue([]);

    const app = createApp();
    const response = await app.request("http://localhost/?capability=tasks");

    expect(response.status).toBe(200);
    expect(coworkerFindManyMock).toHaveBeenCalledWith({
      where: {
        archivedAt: null,
        isWhitelisted: true,
        sokoBotId: null,
        capabilities: {
          hasEvery: ["tasks"],
        },
      },
      orderBy: expectedOrderBy,
      include: coworkerInclude,
    });
  });

  it("parses repeated and comma-separated capability filters", async () => {
    coworkerFindManyMock.mockResolvedValue([]);

    const app = createApp();
    const response = await app.request(
      "http://localhost/?capability=tasks,chat&capability=tasks",
    );

    expect(response.status).toBe(200);
    expect(coworkerFindManyMock).toHaveBeenCalledWith({
      where: {
        archivedAt: null,
        isWhitelisted: true,
        sokoBotId: null,
        capabilities: {
          hasEvery: ["tasks", "chat"],
        },
      },
      orderBy: expectedOrderBy,
      include: coworkerInclude,
    });
  });

  it("rejects invalid capability filters", async () => {
    const app = createApp();
    const response = await app.request("http://localhost/?capability=search");

    expect(response.status).toBe(422);
    expect(coworkerFindManyMock).not.toHaveBeenCalled();
  });

  it("allows authenticated coworker API keys (same as session users)", async () => {
    coworkerFindManyMock.mockResolvedValue([]);
    const app = createApp(coworkerAuth);

    const response = await app.request("http://localhost/");

    expect(response.status).toBe(200);
    expect(coworkerFindManyMock).toHaveBeenCalled();
  });

  it("returns active coworkers accessible via membership via scope=owned", async () => {
    coworkerFindManyMock.mockResolvedValue([]);

    const app = createApp({
      actor: "user",
      userId: "user_123",
      organizationId: null,
      role: "user",
    });
    const response = await app.request("http://localhost/?scope=owned");

    expect(response.status).toBe(200);
    expect(coworkerFindManyMock).toHaveBeenCalledWith({
      where: {
        archivedAt: null,
        OR: [
          {
            vendor: {
              vendorMembers: {
                some: {
                  userId: "user_123",
                  role: "admin",
                },
              },
            },
          },
          {
            assignments: {
              some: {
                userId: "user_123",
              },
            },
          },
        ],
      },
      orderBy: expectedOrderBy,
      include: coworkerInclude,
    });
  });

  it("scopes owned coworkers to the authenticated user membership", async () => {
    coworkerFindManyMock.mockResolvedValue([]);

    const app = createApp({
      actor: "user",
      userId: "admin_456",
      organizationId: null,
      role: "admin",
    });
    const response = await app.request("http://localhost/?scope=owned");

    expect(response.status).toBe(200);
    expect(coworkerFindManyMock).toHaveBeenCalledWith({
      where: {
        archivedAt: null,
        OR: [
          {
            vendor: {
              vendorMembers: {
                some: {
                  userId: "admin_456",
                  role: "admin",
                },
              },
            },
          },
          {
            assignments: {
              some: {
                userId: "admin_456",
              },
            },
          },
        ],
      },
      orderBy: expectedOrderBy,
      include: coworkerInclude,
    });
  });

  it("rejects coworker actors for scope=owned with 403", async () => {
    const app = createApp(coworkerAuth);

    const response = await app.request("http://localhost/?scope=owned");

    expect(response.status).toBe(403);
    expect(coworkerFindManyMock).not.toHaveBeenCalled();
  });

  it("composes owned scope with capability filters", async () => {
    coworkerFindManyMock.mockResolvedValue([]);

    const app = createApp();
    const response = await app.request(
      "http://localhost/?scope=owned&capability=tasks",
    );

    expect(response.status).toBe(200);
    expect(coworkerFindManyMock).toHaveBeenCalledWith({
      where: {
        archivedAt: null,
        OR: [
          {
            vendor: {
              vendorMembers: {
                some: {
                  userId: "user_123",
                  role: "admin",
                },
              },
            },
          },
          {
            assignments: {
              some: {
                userId: "user_123",
              },
            },
          },
        ],
        capabilities: {
          hasEvery: ["tasks"],
        },
      },
      orderBy: expectedOrderBy,
      include: coworkerInclude,
    });
  });

  it("returns coworkers usable in active workspace via scope=available", async () => {
    coworkerFindManyMock.mockResolvedValue([]);

    const app = createApp(
      {
        actor: "user",
        userId: "user_123",
        organizationId: null,
        role: "user",
      },
      personalWorkspaceContext,
    );
    const response = await app.request("http://localhost/?scope=available");

    expect(response.status).toBe(200);
    expect(coworkerFindManyMock).toHaveBeenCalledWith({
      where: {
        ...usableInWorkspaceWhere,
        sokoBotId: null,
      },
      orderBy: expectedOrderBy,
      include: coworkerInclude,
    });
  });

  it("composes available scope with capability filters", async () => {
    coworkerFindManyMock.mockResolvedValue([]);

    const app = createApp(
      {
        actor: "user",
        userId: "user_123",
        organizationId: null,
        role: "user",
      },
      personalWorkspaceContext,
    );
    const response = await app.request(
      "http://localhost/?scope=available&capability=tasks",
    );

    expect(response.status).toBe(200);
    expect(coworkerFindManyMock).toHaveBeenCalledWith({
      where: {
        ...usableInWorkspaceWhere,
        sokoBotId: null,
        capabilities: {
          hasEvery: ["tasks"],
        },
      },
      orderBy: expectedOrderBy,
      include: coworkerInclude,
    });
  });

  it("rejects coworker actors for scope=available with 403", async () => {
    const app = createApp(coworkerAuth, personalWorkspaceContext);

    const response = await app.request("http://localhost/?scope=available");

    expect(response.status).toBe(403);
    expect(coworkerFindManyMock).not.toHaveBeenCalled();
  });

  it("rejects scope=available when workspace context is missing with 403", async () => {
    const app = createApp(
      {
        actor: "user",
        userId: "user_123",
        organizationId: null,
        role: "user",
      },
      null,
    );

    const response = await app.request("http://localhost/?scope=available");

    expect(response.status).toBe(403);
    expect(coworkerFindManyMock).not.toHaveBeenCalled();
  });
});
