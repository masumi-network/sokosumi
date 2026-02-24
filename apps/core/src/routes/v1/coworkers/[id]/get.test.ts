import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountGetCoworkerById from "./get";

const { coworkerFindFirstMock } = vi.hoisted(() => ({
  coworkerFindFirstMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    coworker: {
      findFirst: coworkerFindFirstMock,
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

  mountGetCoworkerById(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

describe("GET /coworkers/{id}", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when coworker is archived or missing", async () => {
    coworkerFindFirstMock.mockResolvedValue(null);
    const app = createApp();

    const response = await app.request("http://localhost/cow_123");
    expect(response.status).toBe(404);
    expect(coworkerFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: "cow_123",
        archivedAt: null,
      },
    });
  });
});
