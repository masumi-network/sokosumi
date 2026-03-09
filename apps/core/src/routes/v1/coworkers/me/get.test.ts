import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountGetCoworkerMe from "./get";

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
      actor: "coworker",
      coworkerId: "cow_123",
    });
    return await next();
  });

  mountGetCoworkerMe(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

describe("GET /coworkers/me", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns baseURL for the current coworker", async () => {
    coworkerFindFirstMock.mockResolvedValue({
      id: "cow_123",
      createdAt: new Date("2026-02-25T10:00:00.000Z"),
      updatedAt: new Date("2026-02-25T10:00:00.000Z"),
      archivedAt: null,
      isWhitelisted: true,
      capabilities: ["tasks"],
      slug: "ops-agent",
      name: "Ops Agent",
      email: "ops@example.com",
      baseURL: null,
    });

    const app = createApp();
    const response = await app.request("http://localhost/me");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.capabilities).toEqual(["tasks"]);
    expect(body.data.baseURL).toBeNull();
  });

  it("returns 404 when current coworker is archived or missing", async () => {
    coworkerFindFirstMock.mockResolvedValue(null);
    const app = createApp();

    const response = await app.request("http://localhost/me");
    expect(response.status).toBe(404);
    expect(coworkerFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: "cow_123",
        archivedAt: null,
      },
    });
  });
});
