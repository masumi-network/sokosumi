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
  default: { $queryRaw: prismaQueryRawMock },
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

/** The values bound into the raw SQL tagged template. */
function boundValues(): unknown[] {
  return prismaQueryRawMock.mock.calls[0]?.slice(1).flat(Infinity) ?? [];
}

describe("GET /transactions/total", () => {
  beforeEach(() => {
    prismaQueryRawMock.mockReset();
  });

  it("returns the net credits and row count for one Task", async () => {
    // 1.5 credits spent, 0.5 refunded.
    prismaQueryRawMock.mockResolvedValue([{ count: 2n, net: 10_000_000_000n }]);

    const response = await createApp().request(
      "/total?taskId=task_123&scope=workspace",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({ credits: 1, count: 2 });
    expect(JSON.stringify(boundValues())).toContain("task_123");
  });

  it("returns zero when nothing matches", async () => {
    prismaQueryRawMock.mockResolvedValue([{ count: 0n, net: null }]);

    const body = await (
      await createApp().request("/total?taskId=task_123")
    ).json();

    expect(body.data).toEqual({ credits: 0, count: 0 });
  });
});
