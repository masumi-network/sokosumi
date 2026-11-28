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

const { prismaQueryRawMock, taskFindFirstMock } = vi.hoisted(() => ({
  prismaQueryRawMock: vi.fn(),
  taskFindFirstMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  networkPrisma: () => ({ $queryRaw: prismaQueryRawMock, agent: {} }),
  default: {
    $queryRaw: prismaQueryRawMock,
    task: { findFirst: taskFindFirstMock },
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

/** The values bound into the raw SQL tagged template. */
function boundValues(): unknown[] {
  return prismaQueryRawMock.mock.calls[0]?.slice(1).flat(Infinity) ?? [];
}

describe("GET /transactions/total", () => {
  beforeEach(() => {
    prismaQueryRawMock.mockReset();
    taskFindFirstMock.mockReset();
    taskFindFirstMock.mockResolvedValue({ id: "task_123" });
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
    // Only a Task the member may open in this workspace.
    expect(taskFindFirstMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: "task_123",
        archivedAt: null,
        workspaceId: "11111111-1111-7111-8111-111111111111",
        OR: [
          { visibility: "PUBLIC" },
          { visibility: "PRIVATE", ownerId: "user_123" },
        ],
      }),
    });
  });

  it("refuses a Task the member may not open without reading the ledger", async () => {
    taskFindFirstMock.mockResolvedValue(null);

    const response = await createApp().request("/total?taskId=task_123");

    expect(response.status).toBe(404);
    expect(prismaQueryRawMock).not.toHaveBeenCalled();
  });

  it("returns zero when nothing matches", async () => {
    prismaQueryRawMock.mockResolvedValue([{ count: 0n, net: null }]);

    const body = await (
      await createApp().request("/total?taskId=task_123")
    ).json();

    expect(body.data).toEqual({ credits: 0, count: 0 });
  });
});
