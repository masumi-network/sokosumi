import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { formatZodErrorMessage, unprocessableEntity } from "@/helpers/error";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";

import mountGetCoworkers from "./get";

const { coworkerFindManyMock } = vi.hoisted(() => ({
  coworkerFindManyMock: vi.fn(),
}));

const expectedOrderBy = [{ priority: "desc" }, { slug: "asc" }] as const;

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

const coworkerInclude = { vendor: true } as const;

const sampleVendor = {
  id: "01960001-0001-7001-8001-000000000001",
  createdAt: new Date("2026-02-25T10:00:00.000Z"),
  updatedAt: new Date("2026-02-25T10:00:00.000Z"),
  name: "Serviceplan",
  slug: "serviceplan",
  logoLight: null,
  logoDark: null,
};

function createApp(
  authContext: AuthenticationContext = {
    actor: "user",
    userId: "user_123",
    organizationId: null,
    role: "user",
  },
) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables;
  }>({
    defaultHook: (result) => {
      if (!result.success && result.error) {
        throw unprocessableEntity(formatZodErrorMessage(result.error));
      }
    },
  });

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  mountGetCoworkers(app as unknown as OpenAPIHonoWithAuth);
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
});
