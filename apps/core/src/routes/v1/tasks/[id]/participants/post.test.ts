import { beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";

import mountPostTaskParticipant from "./post";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  requireTaskCommentAccessMock,
  addSelfAsTaskParticipantMock,
  findManyMock,
  notifyTaskParticipantsAddedMock,
  waitUntilMock,
} = vi.hoisted(() => ({
  requireTaskCommentAccessMock: vi.fn(),
  addSelfAsTaskParticipantMock: vi.fn(),
  findManyMock: vi.fn(),
  notifyTaskParticipantsAddedMock: vi.fn(),
  waitUntilMock: vi.fn((promise: Promise<unknown>) => promise),
}));

vi.mock("@vercel/functions", () => ({
  waitUntil: waitUntilMock,
}));

vi.mock("@/helpers/access-control", () => ({
  requireTaskCommentAccess: requireTaskCommentAccessMock,
}));

vi.mock("@/helpers/task-participants", () => ({
  addSelfAsTaskParticipant: addSelfAsTaskParticipantMock,
}));

vi.mock("@/helpers/task-notifications", () => ({
  notifyTaskParticipantsAdded: notifyTaskParticipantsAddedMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        taskParticipant: {
          findMany: findManyMock,
        },
      }),
  },
}));

const auth = {
  actor: "user",
  userId: "user_alice",
  organizationId: "org_123",
  role: "user",
} as AuthenticationContext;

function mountApp() {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("authContext", auth);
    c.set("isAuthenticated", true);
    return await next();
  });
  mountPostTaskParticipant(app);
  return app;
}

const remaining = [
  {
    id: "tp_1",
    createdAt: new Date("2026-09-24T12:00:00.000Z"),
    userId: "user_alice",
    user: { id: "user_alice", name: "Alice", image: null },
  },
];

describe("POST /{id}/participants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireTaskCommentAccessMock.mockResolvedValue({
      id: "tsk_123",
      workspaceId: "ws_1",
      visibility: "PUBLIC",
      ownerId: "user_owner",
    });
    addSelfAsTaskParticipantMock.mockResolvedValue({ added: true });
    findManyMock.mockResolvedValue(remaining);
    notifyTaskParticipantsAddedMock.mockResolvedValue(undefined);
  });

  it("adds only the authenticated viewer and notifies once", async () => {
    const app = mountApp();

    const response = await app.request(
      "http://localhost/tsk_123/participants",
      { method: "POST" },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        participants: [
          {
            user: { id: "user_alice", name: "Alice", image: null },
            addedAt: "2026-09-24T12:00:00.000Z",
          },
        ],
      },
    });
    expect(addSelfAsTaskParticipantMock).toHaveBeenCalledWith(
      expect.anything(),
      {
        taskId: "tsk_123",
        workspaceId: "ws_1",
        visibility: "PUBLIC",
        ownerId: "user_owner",
        userId: "user_alice",
      },
    );
    expect(waitUntilMock).toHaveBeenCalled();
    expect(notifyTaskParticipantsAddedMock).toHaveBeenCalledWith(
      "tsk_123",
      expect.any(String),
      ["user_alice"],
    );
  });

  it("is a no-op when the viewer is already a participant", async () => {
    addSelfAsTaskParticipantMock.mockResolvedValue({ added: false });
    const app = mountApp();

    const response = await app.request(
      "http://localhost/tsk_123/participants",
      { method: "POST" },
    );

    expect(response.status).toBe(200);
    expect(notifyTaskParticipantsAddedMock).not.toHaveBeenCalled();
    expect(waitUntilMock).not.toHaveBeenCalled();
  });

  it("forbids a viewer who cannot comment", async () => {
    const { forbidden } = await import("@/helpers/error");
    requireTaskCommentAccessMock.mockImplementation(() => {
      throw forbidden("No comment access");
    });
    const app = mountApp();

    const response = await app.request(
      "http://localhost/tsk_123/participants",
      { method: "POST" },
    );

    expect(response.status).toBe(403);
    expect(addSelfAsTaskParticipantMock).not.toHaveBeenCalled();
  });

  it("forbids coworker auth even with X-Context-User-Id", async () => {
    const app = new OpenAPIHonoWithAuth();
    app.use("*", async (c, next) => {
      c.set("authContext", {
        actor: "coworker",
        coworkerId: "cw_1",
        vendorId: "vnd_1",
        context: { userId: "user_alice", organizationId: "org_123" },
      } as AuthenticationContext);
      c.set("isAuthenticated", true);
      return await next();
    });
    mountPostTaskParticipant(app);

    const response = await app.request(
      "http://localhost/tsk_123/participants",
      { method: "POST" },
    );

    expect(response.status).toBe(403);
    expect(addSelfAsTaskParticipantMock).not.toHaveBeenCalled();
  });
});
