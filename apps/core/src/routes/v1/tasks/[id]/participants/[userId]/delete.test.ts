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

const {
  requireTaskReadForRouteVarsMock,
  deleteManyMock,
  findManyMock,
  markTaskParticipantRemovedReadMock,
} = vi.hoisted(() => ({
  requireTaskReadForRouteVarsMock: vi.fn(),
  deleteManyMock: vi.fn(),
  findManyMock: vi.fn(),
  markTaskParticipantRemovedReadMock: vi.fn(),
}));

vi.mock("@/helpers/access-control", () => ({
  requireTaskReadForRouteVars: requireTaskReadForRouteVarsMock,
}));

vi.mock("@/helpers/task-notifications", () => ({
  markTaskParticipantRemovedRead: markTaskParticipantRemovedReadMock,
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

const ownerAuth = {
  actor: "user",
  userId: "user_owner",
  organizationId: "org_123",
  role: "user",
} as AuthenticationContext;

const participantAuth = {
  actor: "user",
  userId: "user_alice",
  organizationId: "org_123",
  role: "user",
} as AuthenticationContext;

const commenterAuth = {
  actor: "user",
  userId: "user_commenter",
  organizationId: "org_123",
  role: "user",
} as AuthenticationContext;

function mountApp(auth: AuthenticationContext) {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("authContext", auth);
    c.set("isAuthenticated", true);
    return await next();
  });
  mountDeleteTaskParticipant(app);
  return app;
}

describe("DELETE /{id}/participants/{userId}", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireTaskReadForRouteVarsMock.mockResolvedValue({
      id: "tsk_123",
      ownerId: "user_owner",
    });
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

  it("lets a participant remove only themselves", async () => {
    const app = mountApp(participantAuth);

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
    expect(markTaskParticipantRemovedReadMock).toHaveBeenCalledWith(
      "user_alice",
      "tsk_123",
    );
  });

  it("forbids the Task owner from removing another participant", async () => {
    const app = mountApp(ownerAuth);

    const response = await app.request(
      "http://localhost/tsk_123/participants/user_alice",
      { method: "DELETE" },
    );

    expect(response.status).toBe(403);
    expect(deleteManyMock).not.toHaveBeenCalled();
    expect(markTaskParticipantRemovedReadMock).not.toHaveBeenCalled();
  });

  it("forbids a commenter from removing another participant", async () => {
    const app = mountApp(commenterAuth);

    const response = await app.request(
      "http://localhost/tsk_123/participants/user_alice",
      { method: "DELETE" },
    );

    expect(response.status).toBe(403);
    expect(deleteManyMock).not.toHaveBeenCalled();
    expect(markTaskParticipantRemovedReadMock).not.toHaveBeenCalled();
  });

  it("forbids a participant from removing someone else", async () => {
    const app = mountApp(participantAuth);

    const response = await app.request(
      "http://localhost/tsk_123/participants/user_bob",
      { method: "DELETE" },
    );

    expect(response.status).toBe(403);
    expect(deleteManyMock).not.toHaveBeenCalled();
  });

  it("lets a participant leave without comment access (read is enough)", async () => {
    const app = mountApp(participantAuth);

    const response = await app.request(
      "http://localhost/tsk_123/participants/user_alice",
      { method: "DELETE" },
    );

    expect(response.status).toBe(200);
    expect(requireTaskReadForRouteVarsMock).toHaveBeenCalled();
    expect(deleteManyMock).toHaveBeenCalledWith({
      where: { taskId: "tsk_123", userId: "user_alice" },
    });
  });

  it("treats a missing participant row as a no-op", async () => {
    deleteManyMock.mockResolvedValue({ count: 0 });
    findManyMock.mockResolvedValue([]);
    const app = mountApp(participantAuth);

    const response = await app.request(
      "http://localhost/tsk_123/participants/user_alice",
      { method: "DELETE" },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { participants: [] },
    });
    expect(markTaskParticipantRemovedReadMock).toHaveBeenCalledWith(
      "user_alice",
      "tsk_123",
    );
  });

  it("forbids coworker auth even with X-Context-User-Id", async () => {
    const app = new OpenAPIHonoWithAuth();
    app.use("*", async (c, next) => {
      c.set("authContext", {
        actor: "coworker",
        coworkerId: "cw_1",
        vendorId: "vnd_1",
        context: { userId: "user_owner", organizationId: "org_123" },
      } as AuthenticationContext);
      c.set("isAuthenticated", true);
      return await next();
    });
    mountDeleteTaskParticipant(app);

    const response = await app.request(
      "http://localhost/tsk_123/participants/user_owner",
      { method: "DELETE" },
    );

    expect(response.status).toBe(403);
    expect(deleteManyMock).not.toHaveBeenCalled();
  });
});
