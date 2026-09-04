import { beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";

import { mountSokoBotEventRoutes } from "./events";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const { findManyMock, countMock, transactionMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  countMock: vi.fn(),
  transactionMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    taskEvent: { findMany: findManyMock, count: countMock },
    $transaction: transactionMock,
  },
}));

const BOT_ID = "01960001-0001-7001-8001-000000000099";
const WORKSPACE_ID = "01960001-0001-7001-8001-000000000010";

function createApp(actor: "sokoBot" | "user") {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set(
      "authContext",
      actor === "sokoBot"
        ? {
            actor,
            sokoBotId: BOT_ID,
            userId: "owner_1",
            workspaceId: WORKSPACE_ID,
            organizationId: null,
          }
        : {
            actor,
            userId: "owner_1",
            organizationId: null,
            role: "user",
          },
    );
    return await next();
  });
  mountSokoBotEventRoutes(app);
  return app;
}

describe("Soko Bot task events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findManyMock.mockReturnValue("events-query");
    countMock.mockReturnValue("count-query");
    transactionMock.mockResolvedValue([[], 0]);
  });

  it("lists only non-draft events for tasks assigned to the authenticated bot", async () => {
    const response = await createApp("sokoBot").request(
      "http://localhost/me/events?limit=10",
    );

    expect(response.status).toBe(200);
    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          task: {
            assigneeSokoBotId: BOT_ID,
            workspaceId: WORKSPACE_ID,
            status: { not: "DRAFT" },
          },
        },
        take: 11,
      }),
    );
  });

  it("rejects a user session", async () => {
    const response = await createApp("user").request(
      "http://localhost/me/events",
    );

    expect(response.status).toBe(403);
    expect(findManyMock).not.toHaveBeenCalled();
  });
});
