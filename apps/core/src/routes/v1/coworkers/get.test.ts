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

  it("filters archived coworkers out", async () => {
    coworkerFindManyMock.mockResolvedValue([]);
    const app = createApp();

    const response = await app.request("http://localhost/");
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
});
