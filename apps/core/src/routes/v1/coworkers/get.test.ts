import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountGetCoworkers from "./get";

const { coworkerFindManyMock } = vi.hoisted(() => ({
  coworkerFindManyMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    coworker: {
      findMany: coworkerFindManyMock,
    },
  },
}));

function createApp() {
  const app = new OpenAPIHono<{
    Variables: AuthVariables;
  }>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: "user_123",
      organizationId: null,
    });
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
      orderBy: {
        createdAt: "desc",
      },
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
        capabilities: ["chat", "tasks"],
        slug: "ops-agent",
        name: "Ops Agent",
        baseURL: null,
      },
    ]);

    const app = createApp();
    const response = await app.request("http://localhost/");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data[0].isWhitelisted).toBe(true);
    expect(body.data[0].capabilities).toEqual(["chat", "tasks"]);
    expect(body.data[0].baseURL).toBeNull();
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
      orderBy: {
        createdAt: "desc",
      },
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
      orderBy: {
        createdAt: "desc",
      },
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
      orderBy: {
        createdAt: "desc",
      },
    });
  });
});
