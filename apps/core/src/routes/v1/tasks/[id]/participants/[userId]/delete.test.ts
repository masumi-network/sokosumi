import { beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";

import mountDeleteTaskParticipant from "./delete";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const { requireTaskCommentAccessMock, deleteManyMock, findManyMock } =
  vi.hoisted(() => ({
    requireTaskCommentAccessMock: vi.fn(),
    deleteManyMock: vi.fn(),
    findManyMock: vi.fn(),
  }));

vi.mock("@/helpers/access-control", () => ({
  requireTaskCommentAccess: requireTaskCommentAccessMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        taskParticipant: {
          deleteMany: deleteManyMock,
          findMany: findManyMock,
        },
      }),
  },
}));

const auth = {
  actor: "user",
  userId: "user_123",
  organizationId: "org_123",
  role: "user",
} as AuthenticationContext;

describe("DELETE /{id}/participants/{userId}", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireTaskCommentAccessMock.mockResolvedValue({ id: "tsk_123" });
    deleteManyMock.mockResolvedValue({ count: 1 });
    findManyMock.mockResolvedValue([
      {
        id: "tp_1",
        createdAt: new Date("2026-09-24T12:00:00.000Z"),
        userId: "user_bob",
        user: { id: "user_bob", name: "Bob", image: null },
      },
    ]);
  });

  it("returns the remaining participants after a remove", async () => {
    const app = new OpenAPIHonoWithAuth();
    app.use("*", async (c, next) => {
      c.set("authContext", auth);
      c.set("isAuthenticated", true);
      return await next();
    });
    mountDeleteTaskParticipant(app);

    const response = await app.request(
      "http://localhost/tsk_123/participants/user_alice",
      { method: "DELETE" },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        participants: [
          {
            user: { id: "user_bob", name: "Bob", image: null },
            addedAt: "2026-09-24T12:00:00.000Z",
          },
        ],
      },
    });
    expect(deleteManyMock).toHaveBeenCalledWith({
      where: { taskId: "tsk_123", userId: "user_alice" },
    });
  });
});
