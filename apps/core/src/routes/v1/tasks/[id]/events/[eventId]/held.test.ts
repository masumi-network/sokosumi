import { OpenAPIHono } from "@hono/zod-openapi";
import { TaskEventOrigin } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { notFound } from "@/helpers/error";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";

import mountDeleteHeldTaskEvent from "./delete";
import mountPatchHeldTaskEvent from "./patch";

const {
  requireTaskOwnershipMock,
  taskEventDeleteManyMock,
  taskEventFindFirstMock,
  taskEventUpdateManyMock,
} = vi.hoisted(() => ({
  requireTaskOwnershipMock: vi.fn(),
  taskEventDeleteManyMock: vi.fn(),
  taskEventFindFirstMock: vi.fn(),
  taskEventUpdateManyMock: vi.fn(),
}));

vi.mock("@/helpers/access-control", () => ({
  requireTaskOwnership: requireTaskOwnershipMock,
}));

vi.mock("@/lib/db/prisma", () => {
  const tx = {
    taskEvent: {
      findFirst: taskEventFindFirstMock,
      updateMany: taskEventUpdateManyMock,
      deleteMany: taskEventDeleteManyMock,
    },
  };
  return {
    default: {
      $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(tx),
    },
  };
});

const TASK_ID = "tsk_123";
const EVENT_ID = "te_123";
const USER_ID = "user_123";

const userAuthContext: AuthenticationContext = {
  actor: "user",
  userId: USER_ID,
  organizationId: null,
} as AuthenticationContext;

const delegatedCoworkerAuthContext: AuthenticationContext = {
  actor: "coworker",
  coworkerId: "cow_123",
  delegation: { userId: USER_ID, organizationId: null },
} as unknown as AuthenticationContext;

const releasedEventRecord = {
  id: EVENT_ID,
  taskId: TASK_ID,
  createdAt: new Date("2026-07-01T10:00:00Z"),
  updatedAt: new Date("2026-07-01T10:00:00Z"),
  status: null,
  comment: "Hello from a coworker",
  authenticationUrl: null,
  origin: TaskEventOrigin.SOKOSUMI,
  userId: null,
  user: null,
  coworkerId: "cow_123",
  coworker: {
    id: "cow_123",
    name: "Hannah",
    image: null,
    slug: "hannah",
  },
  transactionId: null,
  cents: null,
  heldByGrantId: null,
};

function createApp(authContext: AuthenticationContext) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables;
  }>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  mountPatchHeldTaskEvent(app as unknown as OpenAPIHonoWithAuth);
  mountDeleteHeldTaskEvent(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

function patchRequest(app: OpenAPIHono<{ Variables: AuthVariables }>) {
  return app.request(`/${TASK_ID}/events/${EVENT_ID}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ held: false }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireTaskOwnershipMock.mockResolvedValue({ id: TASK_ID, userId: USER_ID });
  taskEventUpdateManyMock.mockResolvedValue({ count: 1 });
  taskEventDeleteManyMock.mockResolvedValue({ count: 1 });
});

describe("PATCH /tasks/:id/events/:eventId", () => {
  it("releases a held comment for the task owner", async () => {
    taskEventFindFirstMock.mockResolvedValue(releasedEventRecord);

    const app = createApp(userAuthContext);
    const response = await patchRequest(app);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.held).toBe(false);
    // Conditional update: only rows that are still held may be released.
    expect(taskEventUpdateManyMock).toHaveBeenCalledWith({
      where: { id: EVENT_ID, taskId: TASK_ID, heldByGrantId: { not: null } },
      data: { heldByGrantId: null },
    });
  });

  it("is idempotent when the comment was already released", async () => {
    taskEventUpdateManyMock.mockResolvedValue({ count: 0 });
    taskEventFindFirstMock.mockResolvedValue(releasedEventRecord);

    const app = createApp(userAuthContext);
    const response = await patchRequest(app);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.held).toBe(false);
  });

  it("returns 404 when the event does not exist on this task", async () => {
    taskEventUpdateManyMock.mockResolvedValue({ count: 0 });
    taskEventFindFirstMock.mockResolvedValue(null);

    const app = createApp(userAuthContext);
    const response = await patchRequest(app);

    expect(response.status).toBe(404);
    expect(taskEventFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: EVENT_ID, taskId: TASK_ID },
      }),
    );
  });

  it("returns 404 when the caller does not own the task", async () => {
    requireTaskOwnershipMock.mockRejectedValue(notFound("Task not found"));

    const app = createApp(userAuthContext);
    const response = await patchRequest(app);

    expect(response.status).toBe(404);
    expect(taskEventUpdateManyMock).not.toHaveBeenCalled();
  });

  it("rejects delegated coworker contexts", async () => {
    const app = createApp(delegatedCoworkerAuthContext);
    const response = await patchRequest(app);

    expect(response.status).toBe(403);
    expect(taskEventUpdateManyMock).not.toHaveBeenCalled();
  });
});

describe("DELETE /tasks/:id/events/:eventId", () => {
  it("discards a held comment for the task owner", async () => {
    taskEventFindFirstMock.mockResolvedValue({ heldByGrantId: "grant_123" });

    const app = createApp(userAuthContext);
    const response = await app.request(`/${TASK_ID}/events/${EVENT_ID}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual({ deleted: true });
    // Conditional delete: a comment that has become public must survive.
    expect(taskEventDeleteManyMock).toHaveBeenCalledWith({
      where: { id: EVENT_ID, heldByGrantId: { not: null } },
    });
  });

  it("rejects events that are not held", async () => {
    taskEventFindFirstMock.mockResolvedValue({ heldByGrantId: null });

    const app = createApp(userAuthContext);
    const response = await app.request(`/${TASK_ID}/events/${EVENT_ID}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(400);
    expect(taskEventDeleteManyMock).not.toHaveBeenCalled();
  });

  it("rejects the delete when the comment was released concurrently", async () => {
    taskEventFindFirstMock.mockResolvedValue({ heldByGrantId: "grant_123" });
    taskEventDeleteManyMock.mockResolvedValue({ count: 0 });

    const app = createApp(userAuthContext);
    const response = await app.request(`/${TASK_ID}/events/${EVENT_ID}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(400);
  });

  it("returns 404 when the event does not exist on this task", async () => {
    taskEventFindFirstMock.mockResolvedValue(null);

    const app = createApp(userAuthContext);
    const response = await app.request(`/${TASK_ID}/events/${EVENT_ID}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(404);
    expect(taskEventDeleteManyMock).not.toHaveBeenCalled();
  });

  it("rejects delegated coworker contexts", async () => {
    const app = createApp(delegatedCoworkerAuthContext);
    const response = await app.request(`/${TASK_ID}/events/${EVENT_ID}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(403);
    expect(taskEventDeleteManyMock).not.toHaveBeenCalled();
  });
});
