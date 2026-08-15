import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { coworkerInclude } from "@/helpers/coworker";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";
import { testVendor } from "@/test-fixtures/vendor";
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

const coworkerAuth: AuthenticationContext = {
  actor: "coworker",
  coworkerId: "cow_456",
  vendorId: testVendor.id,
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
  }>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  mountGetCoworkerById(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

describe("GET /coworkers/{id}", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when coworker is missing", async () => {
    coworkerFindFirstMock.mockResolvedValue(null);
    const app = createApp();

    const response = await app.request("http://localhost/cow_123");
    expect(response.status).toBe(404);
    expect(coworkerFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: "cow_123",
      },
      include: coworkerInclude,
    });
  });

  it("returns isWhitelisted field in response", async () => {
    coworkerFindFirstMock.mockResolvedValue({
      id: "cow_123",
      createdAt: new Date("2026-02-25T10:00:00.000Z"),
      updatedAt: new Date("2026-02-25T10:00:00.000Z"),
      archivedAt: null,
      isWhitelisted: true,
      priority: 10,
      capabilities: ["chat"],
      slug: "ops-agent",
      name: "Ops Agent",
      baseURL: null,
      vendor: testVendor,
    });

    const app = createApp();
    const response = await app.request("http://localhost/cow_123");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.isWhitelisted).toBe(true);
    expect(body.data.priority).toBe(10);
    expect(body.data.capabilities).toEqual(["chat"]);
    expect(body.data.baseURL).toBeNull();
  });

  it("returns archived coworker when it exists", async () => {
    coworkerFindFirstMock.mockResolvedValue({
      id: "cow_123",
      createdAt: new Date("2026-02-25T10:00:00.000Z"),
      updatedAt: new Date("2026-02-25T10:00:00.000Z"),
      archivedAt: new Date("2026-02-25T11:00:00.000Z"),
      isWhitelisted: true,
      priority: 0,
      capabilities: ["chat", "tasks"],
      slug: "ops-agent",
      name: "Ops Agent",
      baseURL: "https://responses.example.com/v1",
      vendor: testVendor,
    });

    const app = createApp();
    const response = await app.request("http://localhost/cow_123");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.archivedAt).toBe("2026-02-25T11:00:00.000Z");
    expect(body.data.capabilities).toEqual(["chat", "tasks"]);
    expect(body.data.baseURL).toBe("https://responses.example.com/v1");
  });

  it("allows authenticated coworker API keys (same as session users)", async () => {
    coworkerFindFirstMock.mockResolvedValue({
      id: "cow_123",
      createdAt: new Date("2026-02-25T10:00:00.000Z"),
      updatedAt: new Date("2026-02-25T10:00:00.000Z"),
      archivedAt: null,
      isWhitelisted: true,
      priority: 10,
      capabilities: ["chat"],
      slug: "ops-agent",
      name: "Ops Agent",
      baseURL: null,
      vendor: testVendor,
    });

    const app = createApp(coworkerAuth);
    const response = await app.request("http://localhost/cow_123");

    expect(response.status).toBe(200);
    expect(coworkerFindFirstMock).toHaveBeenCalledWith({
      where: { id: "cow_123" },
      include: coworkerInclude,
    });
  });
});
