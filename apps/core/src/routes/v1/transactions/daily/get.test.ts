import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import mount from "./get";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const { prismaQueryRawMock } = vi.hoisted(() => ({
  prismaQueryRawMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $queryRaw: prismaQueryRawMock,
    agent: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

function createApp() {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: "user_123",
      organizationId: "org_123",
      role: "user",
    });
    c.set("workspaceContext", {
      workspaceId: "11111111-1111-7111-8111-111111111111",
      userId: null,
      organizationId: "org_123",
    });
    return await next();
  });
  mount(app);
  return app;
}

describe("GET /transactions/daily", () => {
  beforeEach(() => {
    prismaQueryRawMock.mockReset();
  });

  it("returns one entry per day, zero where nothing was spent", async () => {
    prismaQueryRawMock.mockResolvedValue([
      { day: "2026-09-02", spent: 5_000_000_000n },
    ]);

    const response = await createApp().request(
      "/daily?from=2026-09-01&to=2026-09-03",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual([
      { date: "2026-09-01", credits: 0 },
      { date: "2026-09-02", credits: 0.5 },
      { date: "2026-09-03", credits: 0 },
    ]);
  });

  it("defaults to the last 30 days", async () => {
    prismaQueryRawMock.mockResolvedValue([]);

    const body = await (await createApp().request("/daily")).json();

    expect(body.data).toHaveLength(30);
  });

  it("refuses a range longer than a year", async () => {
    const response = await createApp().request(
      "/daily?from=2024-01-01&to=2026-01-01",
    );

    expect(response.status).toBe(400);
  });
});
